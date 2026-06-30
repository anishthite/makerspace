import test from 'node:test';
import assert from 'node:assert/strict';
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

test('thread list payload returns only the signed-in user sessions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'makerspace-thread-scope-'));
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
