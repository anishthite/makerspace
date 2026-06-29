import test from 'node:test';
import assert from 'node:assert/strict';

import { appendRetainedOutput, pruneBrowserSessions, retainedOutputChunk } from '../src/resource-utils.js';

test('retained output keeps a tail with base and next offsets', () => {
  const run = { output: '', outputBaseOffset: 0 };

  appendRetainedOutput(run, 'abcdef', 4);
  assert.equal(run.output, 'cdef');
  assert.equal(run.outputBaseOffset, 2);
  assert.deepEqual(retainedOutputChunk(run, 3), {
    baseOffset: 2,
    nextOffset: 6,
    chunk: 'def',
    truncated: false,
  });
  assert.equal(retainedOutputChunk(run, 1).chunk, 'cdef');
  assert.equal(retainedOutputChunk(run, 1).truncated, true);
});

test('browser session pruning drops expired and oldest overflow entries', () => {
  const sessions = new Map([
    ['old', { updatedAt: '2026-06-25T00:00:00.000Z' }],
    ['keep-new', { updatedAt: '2026-06-26T00:00:03.000Z' }],
    ['keep-mid', { updatedAt: '2026-06-26T00:00:02.000Z' }],
    ['overflow', { updatedAt: '2026-06-26T00:00:01.000Z' }],
  ]);

  const pruned = pruneBrowserSessions(sessions, {
    now: Date.parse('2026-06-26T00:00:04.000Z'),
    ttlMs: 10_000,
    max: 2,
  });

  assert.deepEqual([...pruned.keys()], ['keep-new', 'keep-mid']);
});
