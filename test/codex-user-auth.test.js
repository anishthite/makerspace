import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAuthService } from '../src/server/auth.js';

function testHttp() {
  return {
    sendJson() {},
    requestToken() { return ''; },
    originFor() { return 'https://app.example.test'; },
    clientError(message, statusCode = 400) {
      const error = new Error(message);
      error.statusCode = statusCode;
      return error;
    },
  };
}

function config(root) {
  return {
    rootDir: root,
    authFile: path.join(root, 'auth.json'),
    authSecret: 'test-secret',
    authRequired: true,
    authCookieName: 'spanner_auth',
    authSessionDays: 30,
  };
}

async function occupyClaudeCallbackPort() {
  const server = createServer((_, response) => response.end('busy'));
  return await new Promise((resolve) => {
    server.once('error', () => resolve(null));
    server.listen(53692, '127.0.0.1', () => resolve(server));
  });
}

test('hosted Codex and Claude Code auth are stored per user and formatted for Pi auth.json', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-codex-auth-'));
  try {
    const auth = createAuthService({ config: config(root), http: testHttp() });
    const user = await auth.authStore.upsertUser({ githubId: '1', login: 'octo' });
    const other = await auth.authStore.upsertUser({ githubId: '2', login: 'mona' });
    const credential = { type: 'oauth', access: 'access-token', refresh: 'refresh-token', expires: Date.now() + 60_000, accountId: 'acct' };
    const claudeCredential = { type: 'oauth', access: 'claude-access', refresh: 'claude-refresh', expires: Date.now() + 60_000 };

    await auth.authStore.writeUserSecret(user.id, 'openai-codex-auth', JSON.stringify(credential));
    await auth.authStore.writeUserSecret(user.id, 'claude-code-auth', JSON.stringify(claudeCredential));

    const status = await auth.codexAuthStatus(user);
    assert.equal(status.configured, true);
    assert.equal(status.source, 'user');
    assert.equal(status.expiresAt, credential.expires);
    assert.equal((await auth.codexAuthStatus(other)).configured, false);

    const claudeStatus = await auth.claudeCodeAuthStatus(user);
    assert.equal(claudeStatus.configured, true);
    assert.equal(claudeStatus.source, 'user');
    assert.equal(claudeStatus.expiresAt, claudeCredential.expires);
    assert.equal((await auth.claudeCodeAuthStatus(other)).configured, false);

    const authText = await auth.readPiAuthForSession({ ownerUserId: user.id });
    assert.deepEqual(JSON.parse(authText), { 'openai-codex': credential, anthropic: claudeCredential });
    assert.equal(await auth.readPiAuthForSession({ ownerUserId: other.id }), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hosted GitHub status ignores stale browser session auth', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-github-status-'));
  try {
    const auth = createAuthService({ config: config(root), http: testHttp() });
    auth.writeBrowserSession('browser-session-1234567890', {
      githubToken: 'other-token',
      githubUser: { login: 'other' },
    });

    const status = await auth.publicGitHubAuth(auth.readBrowserSession('browser-session-1234567890'));
    assert.equal(status.connected, false);
    assert.equal(status.user, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hosted Claude Code login uses copy-paste code flow without binding fixed callback port', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-claude-manual-auth-'));
  const blocker = await occupyClaudeCallbackPort();
  const previousFetch = globalThis.fetch;
  try {
    const auth = createAuthService({ config: config(root), http: testHttp() });
    const user = await auth.authStore.upsertUser({ githubId: '1', login: 'octo' });
    globalThis.fetch = async (url, options = {}) => {
      assert.equal(String(url), 'https://platform.claude.com/v1/oauth/token');
      const body = JSON.parse(String(options.body || '{}'));
      assert.equal(body.grant_type, 'authorization_code');
      assert.equal(body.redirect_uri, 'https://platform.claude.com/oauth/code/callback');
      assert.equal(body.state, body.code_verifier);
      assert.equal(body.code, 'claude-code');
      return new Response(JSON.stringify({ access_token: 'claude-access', refresh_token: 'claude-refresh', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const login = await auth.startClaudeCodeLogin(user);
    assert.equal(login.status, 'waiting');
    assert.equal(login.manual, true);
    assert.match(login.auth.url, /^https:\/\/claude\.ai\/oauth\/authorize\?/);

    const job = auth.getAuthLogin(login.id, user);
    assert.match(login.auth.url, /redirect_uri=https%3A%2F%2Fplatform\.claude\.com%2Foauth%2Fcode%2Fcallback/);

    auth.submitClaudeCodeLoginCode(login.id, user, { authorizationCode: `claude-code#${job.verifier}` });
    await job.exchangePromise;

    const authText = await auth.readPiAuthForSession({ ownerUserId: user.id });
    assert.equal(JSON.parse(authText).anthropic.access, 'claude-access');
  } finally {
    globalThis.fetch = previousFetch;
    await new Promise((resolve) => blocker?.close(resolve) || resolve());
    await rm(root, { recursive: true, force: true });
  }
});

test('local Claude Code login uses copy-paste code flow without binding fixed callback port', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-claude-local-auth-'));
  const blocker = await occupyClaudeCallbackPort();
  const previousFetch = globalThis.fetch;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = path.join(root, 'pi-agent');
  try {
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const localConfig = { ...config(root), authRequired: false };
    const auth = createAuthService({ config: localConfig, http: testHttp() });
    globalThis.fetch = async (url, options = {}) => {
      assert.equal(String(url), 'https://platform.claude.com/v1/oauth/token');
      const body = JSON.parse(String(options.body || '{}'));
      assert.equal(body.grant_type, 'authorization_code');
      assert.equal(body.redirect_uri, 'https://platform.claude.com/oauth/code/callback');
      assert.equal(body.state, body.code_verifier);
      assert.equal(body.code, 'local-claude-code');
      return new Response(JSON.stringify({ access_token: 'local-claude-access', refresh_token: 'local-claude-refresh', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const login = await auth.startClaudeCodeLogin();
    assert.equal(login.status, 'waiting');
    assert.equal(login.manual, true);
    assert.match(login.auth.url, /redirect_uri=https%3A%2F%2Fplatform\.claude\.com%2Foauth%2Fcode%2Fcallback/);

    const job = auth.getAuthLogin(login.id);
    auth.submitClaudeCodeLoginCode(login.id, null, { authorizationCode: `local-claude-code#${job.verifier}` });
    await job.exchangePromise;

    const authText = await readFile(path.join(agentDir, 'auth.json'), 'utf8');
    assert.equal(JSON.parse(authText).anthropic.access, 'local-claude-access');
    assert.equal((await auth.claudeCodeAuthStatus()).configured, true);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    globalThis.fetch = previousFetch;
    await new Promise((resolve) => blocker?.close(resolve) || resolve());
    await rm(root, { recursive: true, force: true });
  }
});

test('remote Pi auth back-sync updates hosted Codex credentials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-codex-auth-back-sync-'));
  try {
    const auth = createAuthService({ config: config(root), http: testHttp() });
    const user = await auth.authStore.upsertUser({ githubId: '1', login: 'octo' });
    const stale = { type: 'oauth', access: 'old-access', refresh: 'old-refresh', expires: Date.now() + 60_000, accountId: 'acct' };
    const fresh = { type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: Date.now() + 120_000, accountId: 'acct' };

    await auth.authStore.writeUserSecret(user.id, 'openai-codex-auth', JSON.stringify(stale));

    assert.equal(await auth.syncPiAuthForSession({ ownerUserId: user.id }, JSON.stringify({ 'openai-codex': fresh })), 1);
    assert.deepEqual(JSON.parse(await auth.readPiAuthForSession({ ownerUserId: user.id })), { 'openai-codex': fresh });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('readGitHubAuthForSession keeps GitHub tokens per user in multi-user mode', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-github-auth-'));
  const savedGhToken = process.env.GH_TOKEN;
  const savedGithubToken = process.env.GITHUB_TOKEN;
  process.env.GH_TOKEN = 'server-shared-token';
  delete process.env.GITHUB_TOKEN;

  try {
    const auth = createAuthService({ config: config(root), http: testHttp() });
    const user = await auth.authStore.upsertUser({ githubId: '1', login: 'octo', name: 'Octo Cat' });
    const other = await auth.authStore.upsertUser({ githubId: '2', login: 'mona' });
    await auth.authStore.upsertOAuthToken({ userId: user.id, provider: 'github', accessToken: 'octo-token', scopes: ['repo', 'read:user', 'workflow'] });

    const owned = await auth.readGitHubAuthForSession({ ownerUserId: user.id });
    assert.equal(owned.token, 'octo-token');
    assert.equal(owned.login, 'octo');
    assert.equal(owned.name, 'Octo Cat');
    assert.equal(owned.email, '1+octo@users.noreply.github.com');

    // A user without GitHub connected must not inherit the server token.
    assert.equal(await auth.readGitHubAuthForSession({ ownerUserId: other.id }), null);
    // Unowned sessions (e.g. warm bridges) get nothing in multi-user mode.
    assert.equal(await auth.readGitHubAuthForSession({}), null);
  } finally {
    if (savedGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = savedGhToken;
    if (savedGithubToken !== undefined) process.env.GITHUB_TOKEN = savedGithubToken;
    await rm(root, { recursive: true, force: true });
  }
});

test('readGitHubAuthForSession falls back to the server token in single-user mode', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-github-auth-single-'));
  const savedGhToken = process.env.GH_TOKEN;
  const savedGithubToken = process.env.GITHUB_TOKEN;
  process.env.GH_TOKEN = 'server-shared-token';
  delete process.env.GITHUB_TOKEN;

  try {
    const auth = createAuthService({ config: { ...config(root), authRequired: false }, http: testHttp() });
    const fallback = await auth.readGitHubAuthForSession({});
    assert.equal(fallback.token, 'server-shared-token');
  } finally {
    if (savedGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = savedGhToken;
    if (savedGithubToken !== undefined) process.env.GITHUB_TOKEN = savedGithubToken;
    await rm(root, { recursive: true, force: true });
  }
});

test('hosted Codex auth populates model picker defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-codex-models-'));
  try {
    const auth = createAuthService({ config: config(root), http: testHttp() });
    const user = await auth.authStore.upsertUser({ githubId: '1', login: 'octo' });
    const credential = { type: 'oauth', access: 'access-token', refresh: 'refresh-token', expires: Date.now() + 60_000, accountId: 'acct' };

    await auth.authStore.writeUserSecret(user.id, 'openai-codex-auth', JSON.stringify(credential));

    const defaults = await auth.loadPiDefaults(user);
    assert.ok(defaults.models.includes('openai-codex/gpt-5.5'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
