import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAuthService } from '../src/server/auth.js';
import { createThreadService } from '../src/server/threads.js';

function httpStub() {
  return {
    sendJson(response, status, payload) {
      response.status = status;
      response.payload = payload;
    },
    requestToken(request, _url) {
      const authorization = String(request.headers?.authorization || '');
      if (authorization.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();
      return String(request.headers?.['x-api-token'] || '');
    },
    originFor() {
      return 'http://localhost:8787';
    },
    clientError(message, statusCode = 400) {
      const error = new Error(message);
      error.statusCode = statusCode;
      return error;
    },
  };
}

test('multi-user access requires matching owner unless trusted', () => {
  const auth = createAuthService({
    config: { authRequired: true, controlApiToken: 'admin', githubClientSecret: 'secret' },
    http: httpStub(),
  });
  const owned = { name: 'thread-a', ownerUserId: 'github-1' };

  assert.equal(auth.canAccessSession(owned, '', false, { id: 'github-1' }), true);
  assert.equal(auth.canAccessSession(owned, '', false, { id: 'github-2' }), false);
  assert.equal(auth.canAccessSession(owned, '', true, null), true);
  assert.equal(auth.canAccessSession({ name: 'legacy' }, '', false, { id: 'github-1' }), false);
});

test('CONTROL_API_TOKEN is optional user auth bypass when multi-user auth is on', () => {
  const auth = createAuthService({
    config: { authRequired: true, controlApiToken: 'admin', githubClientSecret: 'secret' },
    http: httpStub(),
  });
  const response = {};
  const blocked = auth.requireApiToken({ headers: {} }, response, new URL('http://localhost:8787/api/threads'));
  assert.equal(blocked, false);
});

test('GitHub App installation token wins for matching repo owner', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-github-app-token-'));
  const previousFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/app\/installations\/99\/access_tokens$/);
    return new Response(JSON.stringify({ token: 'app-token', expires_at: '2026-07-07T22:00:00Z' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const auth = createAuthService({
      config: {
        authRequired: true,
        authFile: path.join(root, 'auth.json'),
        githubClientSecret: 'secret',
        githubAppId: '123',
        githubAppPrivateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }),
      },
      http: httpStub(),
    });
    await auth.authStore.upsertUser({ id: 'github-1', githubId: '1', login: 'octo' });
    await auth.authStore.upsertOAuthToken({ userId: 'github-1', provider: 'github', accessToken: 'oauth-token' });
    await auth.authStore.writeUserKv('github-1', 'githubAppInstallations', { acme: { id: '99', accountLogin: 'acme' } });

    const github = await auth.readGitHubAuthForSession({
      ownerUserId: 'github-1',
      repoUrl: 'https://github.com/acme/private.git',
    });

    assert.equal(github.token, 'app-token');
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('signed-in user token authenticates pasted GitHub repo URLs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-github-enrich-'));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 1,
    name: 'private',
    full_name: 'acme/private',
    private: true,
    clone_url: 'https://github.com/acme/private.git',
    default_branch: 'main',
    owner: { login: 'acme' },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const auth = createAuthService({
      config: { authRequired: true, authFile: path.join(root, 'auth.json'), githubClientSecret: 'secret' },
      http: httpStub(),
    });
    await auth.authStore.upsertUser({ id: 'github-1', githubId: '1', login: 'octo' });
    await auth.authStore.upsertOAuthToken({ userId: 'github-1', provider: 'github', accessToken: 'user-token' });

    const session = await auth.enrichGitHubRepoSession({
      repoMode: 'git',
      repoUrl: 'git@github.com:acme/private.git',
    }, null, { id: 'github-1', githubId: '1', login: 'octo' });

    assert.equal(session.repoUrl, 'https://github.com/acme/private.git');
    assert.equal(session.repoProvider, 'github');
    assert.equal(session.branch, 'main');
    assert.match(session.repoAuthHeader, /^AUTHORIZATION: basic /);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('thread list payload returns only the signed-in user sessions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-thread-scope-'));
  try {
    const sessionFile = path.join(root, 'sessions.json');
    await writeFile(sessionFile, `${JSON.stringify([
      { name: 'u1-thread', threadBridge: true, ownerUserId: 'github-1', createdAt: '2026-06-30T00:00:00.000Z' },
      { name: 'u2-thread', threadBridge: true, ownerUserId: 'github-2', createdAt: '2026-06-30T00:00:01.000Z' },
      { name: 'legacy-thread', threadBridge: true, createdAt: '2026-06-30T00:00:02.000Z' },
    ])}\n`);
    const auth = createAuthService({
      config: { authRequired: true, githubClientSecret: 'secret' },
      http: httpStub(),
    });
    const threads = createThreadService({
      config: { authRequired: true, sessionFile },
      provider: { info: () => ({ kind: 'test' }) },
      http: httpStub(),
      auth: { ...auth, loadPiDefaults: async () => ({}) },
      runState: {
        activeRuns: new Map(),
        liveLocalRuns: new Set(),
        decorateLiveSession: (session) => session,
        mergeTrackedChanges: (...groups) => groups.flat(),
        MAX_CHANGE_FILES: 200,
      },
      bridge: {},
    });

    const payload = await threads.listThreadsPayload('', false, { id: 'github-1' });
    assert.deepEqual(payload.threads.map((thread) => thread.name), ['u1-thread']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
