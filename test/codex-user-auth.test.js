import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
    authCookieName: 'workbench_auth',
    authSessionDays: 30,
  };
}

async function writeFakePiSdk(root) {
  const packageDir = path.join(root, 'fake-pi-sdk');
  const distDir = path.join(packageDir, 'dist');
  await mkdir(distDir, { recursive: true });
  const modulePath = path.join(distDir, 'index.js');
  await writeFile(modulePath, `
export const events = [];
function createStorage(initial = {}) {
  const data = { ...initial };
  return {
    async login(provider, callbacks) {
      const method = callbacks.onSelect ? await callbacks.onSelect({
        message: 'Select login method',
        options: [
          { id: 'browser', label: 'Browser login (default)' },
          { id: 'device_code', label: 'Device code login (headless)' },
        ],
      }) : 'browser';
      events.push({ provider, method });
      if (method === 'device_code') {
        callbacks.onDeviceCode({ userCode: '123-456', verificationUri: 'https://auth.openai.com/codex/device' });
        throw new Error('device code selected');
      }
      callbacks.onAuth({ url: 'https://auth.example.test/' + provider, instructions: 'Sign in.' });
      events.push({ provider, input: await callbacks.onManualCodeInput() });
      data[provider] = {
        type: 'oauth',
        access: provider + '-access',
        refresh: provider + '-refresh',
        expires: Date.now() + 60000,
        ...(provider === 'openai-codex' ? { accountId: 'acct' } : {}),
      };
    },
    get(provider) { return data[provider]; },
    getAuthStatus(provider) { return { configured: Boolean(data[provider]) }; },
    async getApiKey(provider) { return data[provider]?.access || ''; },
  };
}
export const AuthStorage = { create: () => createStorage(), inMemory: (initial) => createStorage(initial) };
export const ModelRegistry = { create: () => ({ getAvailable: () => [] }) };
`, 'utf8');
  return { packageDir, modulePath };
}

test('hosted Codex and Claude Code auth are stored per user and formatted for Pi auth.json', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-codex-auth-'));
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

test('hosted Codex login uses browser OAuth and pasted redirect URL', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-codex-browser-auth-'));
  try {
    const fakeSdk = await writeFakePiSdk(root);
    const auth = createAuthService({ config: { ...config(root), piSdkPackageDir: fakeSdk.packageDir }, http: testHttp() });
    const user = await auth.authStore.upsertUser({ githubId: '1', login: 'octo' });

    const login = await auth.startCodexLogin(user);
    assert.equal(login.auth.url, 'https://auth.example.test/openai-codex');
    assert.equal(login.device, null);
    assert.equal(login.manual, true);

    const submitted = auth.submitCodexLoginCode(login.id, user, { code: 'http://localhost:1455/auth/callback?code=abc' });
    assert.equal(submitted.status, 'exchanging');

    for (let i = 0; i < 20 && auth.getAuthLogin(login.id, user)?.status !== 'complete'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(auth.getAuthLogin(login.id, user)?.status, 'complete');
    const stored = await auth.authStore.readUserSecret(user.id, 'openai-codex-auth');
    assert.equal(JSON.parse(stored.value).access, 'openai-codex-access');

    const fakeModule = await import(pathToFileURL(fakeSdk.modulePath).href);
    assert.equal(fakeModule.events[0].method, 'browser');
    assert.ok(!fakeModule.events.some((event) => event.method === 'device_code'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('readGitHubAuthForSession keeps GitHub tokens per user in multi-user mode', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'makerspace-github-auth-'));
  const savedGhToken = process.env.GH_TOKEN;
  const savedGithubToken = process.env.GITHUB_TOKEN;
  process.env.GH_TOKEN = 'server-shared-token';
  delete process.env.GITHUB_TOKEN;

  try {
    const auth = createAuthService({ config: config(root), http: testHttp() });
    const user = await auth.authStore.upsertUser({ githubId: '1', login: 'octo', name: 'Octo Cat' });
    const other = await auth.authStore.upsertUser({ githubId: '2', login: 'mona' });
    await auth.authStore.upsertOAuthToken({ userId: user.id, provider: 'github', accessToken: 'octo-token', scopes: ['repo'] });

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
  const root = await mkdtemp(path.join(os.tmpdir(), 'makerspace-github-auth-single-'));
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-codex-models-'));
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
