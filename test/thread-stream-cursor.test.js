import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createRunState } from '../src/server/run-state.js';

function makeRunState() {
  return createRunState({
    config: { sessionFile: '/tmp/spanner-missing-sessions.json' },
    provider: { info: () => ({ kind: 'test' }) },
    loadPiSdk: async () => ({}),
    loadPiAi: async () => ({}),
    canAccessSession: () => true,
  });
}

function fakeResponse() {
  return {
    writes: [],
    write(chunk) {
      this.writes.push(String(chunk));
      return true;
    },
    end() {},
    once() {},
  };
}

function sseIds(response) {
  return response.writes
    .join('')
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)).id);
}

test('stale SSE after cursor drops events after a local run reset', async () => {
  const name = 'local-thread';
  const runState = makeRunState();

  runState.resetRunState(name, 'running');
  for (let index = 0; index < 80; index += 1) runState.appendRunStatus(name, 'running');
  const staleAfter = runState.activeRuns.get(name).events.at(-1).id;

  runState.resetRunState(name, 'starting');
  const stale = fakeResponse();
  const staleSubscriber = runState.addRunSubscriber(name, stale, staleAfter, { name, localMode: true });
  runState.appendRunStatus(name, 'running');
  runState.appendRunStatus(name, 'completed', { done: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  runState.closeRunSubscriber(staleSubscriber);

  runState.resetRunState(name, 'starting');
  const fresh = fakeResponse();
  const freshSubscriber = runState.addRunSubscriber(name, fresh, 0, { name, localMode: true });
  runState.appendRunStatus(name, 'running');
  runState.appendRunStatus(name, 'completed', { done: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  runState.closeRunSubscriber(freshSubscriber);

  assert.deepEqual(sseIds(stale), []);
  assert.deepEqual(sseIds(fresh), [1, 2]);
});

test('thread page clears the SSE cursor before streaming a fresh run', async () => {
  const source = await readFile(new URL('../frontend/src/runtime/thread.js', import.meta.url), 'utf8');
  const helper = source.indexOf('function resetThreadStreamState()');
  const call = source.indexOf('if (!activeDelivery) resetThreadStreamState();');
  const stream = source.indexOf('streamRun();', call);

  assert.notEqual(helper, -1);
  assert.notEqual(call, -1);
  assert.notEqual(stream, -1);
  assert.ok(helper < call);
  assert.ok(call < stream);
});
