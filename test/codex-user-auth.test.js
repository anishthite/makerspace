import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
    authCookieName: 'makerspace_auth',
    authSessionDays: 30,
  };
}

test('hosted Codex auth is stored per user and formatted for Pi auth.json', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'makerspace-codex-auth-'));
  try {
    const auth = createAuthService({ config: config(root), http: testHttp() });
    const user = await auth.authStore.upsertUser({ githubId: '1', login: 'octo' });
    const other = await auth.authStore.upsertUser({ githubId: '2', login: 'mona' });
    const credential = { type: 'oauth', access: 'access-token', refresh: 'refresh-token', expires: Date.now() + 60_000, accountId: 'acct' };

    await auth.authStore.writeUserSecret(user.id, 'openai-codex-auth', JSON.stringify(credential));

    const status = await auth.codexAuthStatus(user);
    assert.equal(status.configured, true);
    assert.equal(status.source, 'user');
    assert.equal(status.expiresAt, credential.expires);
    assert.equal((await auth.codexAuthStatus(other)).configured, false);

    const authText = await auth.readPiAuthForSession({ ownerUserId: user.id });
    assert.deepEqual(JSON.parse(authText), { 'openai-codex': credential });
    assert.equal(await auth.readPiAuthForSession({ ownerUserId: other.id }), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hosted Codex auth populates model picker defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'makerspace-codex-models-'));
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
