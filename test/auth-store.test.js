import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAuthStore, hashAuthSessionId } from '../src/auth-store.js';

function config(root) {
  return {
    rootDir: root,
    authFile: path.join(root, 'auth.json'),
    authSecret: 'test-secret',
  };
}

test('auth store persists users, sessions, encrypted OAuth tokens, and user KV', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'makerspace-auth-store-'));
  try {
    const store = createAuthStore(config(root));
    const user = await store.upsertUser({ githubId: '123', login: 'octo', avatarUrl: 'https://example.test/a.png' });
    assert.equal(user.id, 'github-123');
    assert.equal((await store.getUserByGitHubId('123')).login, 'octo');

    await store.createAuthSession({ idHash: hashAuthSessionId('session-token'), userId: user.id, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    assert.equal((await store.getAuthSession(hashAuthSessionId('session-token'))).userId, user.id);

    await store.upsertOAuthToken({ userId: user.id, provider: 'github', accessToken: 'gho_secret', scopes: ['repo'] });
    assert.equal((await store.getOAuthToken(user.id, 'github')).accessToken, 'gho_secret');
    assert.ok(!(await readFile(path.join(root, 'auth.json'), 'utf8')).includes('gho_secret'));

    await store.writeUserKv(user.id, 'pi-profile-state', { syncToRemote: false });
    assert.deepEqual(await store.readUserKv(user.id, 'pi-profile-state'), { syncToRemote: false });

    await store.writeUserSecret(user.id, 'openai-codex-auth', '{"access":"codex-secret"}');
    assert.equal((await store.readUserSecret(user.id, 'openai-codex-auth')).value, '{"access":"codex-secret"}');
    assert.ok(!(await readFile(path.join(root, 'auth.json'), 'utf8')).includes('codex-secret'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
