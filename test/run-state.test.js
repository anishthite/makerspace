import test from 'node:test';
import assert from 'node:assert/strict';

import { createRunState } from '../src/server/run-state.js';

function runState() {
  return createRunState({
    config: {},
    provider: { info: () => ({ kind: 'test' }) },
    loadPiSdk: async () => ({}),
    loadPiAi: async () => ({}),
    canAccessSession: () => true,
  });
}

test('inactive remote launching sessions do not stay visibly stuck', () => {
  const state = runState();
  const decorated = state.decorateLiveSession({
    name: 'stuck-remote',
    threadBridge: true,
    bridgeMode: true,
    status: 'launching',
    runStatus: 'launching',
    createdAt: '2026-07-07T00:54:00.000Z',
    updatedAt: '2026-07-07T00:54:00.000Z',
  });

  assert.equal(decorated.status, 'failed');
  assert.equal(decorated.runStatus, 'failed');
  assert.match(decorated.warning, /connection is stale/);
});
