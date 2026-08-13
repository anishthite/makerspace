import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { createRunState } from '../src/server/run-state.js';
import { getStoredSession } from '../src/store.js';

function runState(config = {}) {
  return createRunState({
    config,
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

test('awaits terminal status persistence before local cleanup drops assistant chunks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-terminal-assistant-'));
  const sessionFile = path.join(root, 'sessions.json');
  const now = '2026-08-13T00:00:00.000Z';

  try {
    await writeFile(sessionFile, `${JSON.stringify([{
      name: 'local-thread',
      threadBridge: true,
      localMode: true,
      status: 'running',
      runStatus: 'running',
      submittedAtMs: Date.parse(now),
      createdAt: now,
      updatedAt: now,
      threadMessages: [{ role: 'user', text: 'hello', timestamp: now, runId: String(Date.parse(now)) }],
    }])}\n`);

    const state = runState({ sessionFile });
    state.recordRunEvent('local-thread', { type: 'chunk', chunk: 'Done.', runStatus: 'running' });

    await state.persistHostDispatchStatus('local-thread', 'completed', { done: true });
    state.activeRuns.delete('local-thread');

    const stored = await getStoredSession(sessionFile, 'local-thread');
    assert.equal(stored.threadMessages.at(-1).role, 'assistant');
    assert.equal(stored.threadMessages.at(-1).text, 'Done.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
