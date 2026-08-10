import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createRunState } from '../src/server/run-state.js';
import {
  appendStoredTraceEvent,
  flushStoredTraceEvents,
  mergeTraceEvents,
  readStoredTraceEvents,
  traceStoreFilePath,
} from '../src/trace-store.js';

async function withFileStateStore(fn) {
  const previous = {
    SPANNER_STATE_STORE: process.env.SPANNER_STATE_STORE,
    STATE_STORE: process.env.STATE_STORE,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.SPANNER_STATE_STORE = 'file';
  delete process.env.STATE_STORE;
  process.env.NODE_ENV = 'test';
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function tempConfig(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-trace-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { traceStoreDir: path.join(root, 'traces') };
}

async function withTraceStore(t, fn) {
  await withFileStateStore(async () => fn(await tempConfig(t)));
}

test('trace store writes Pi-style JSONL and reloads sanitized events', async (t) => {
  await withTraceStore(t, async (config) => {
    const name = 'agent one';
    await appendStoredTraceEvent(config, name, {
      id: 1,
      type: 'tool',
      timestamp: '2026-08-01T12:00:00.000Z',
      session: { name, status: 'running' },
      args: { path: 'src/app.js', token: 'secret-token' },
    });

    const filePath = traceStoreFilePath(config, name);
    const lines = (await readFile(filePath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(path.basename(filePath), 'agent%20one.jsonl');
    assert.equal(lines[0].type, 'session');
    assert.equal(lines[0].source, 'spanner-trace');
    assert.equal(lines[1].type, 'trace');

    const events = await readStoredTraceEvents(config, name);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'tool');
    assert.equal(events[0].session, undefined);
    assert.deepEqual(events[0].args, { path: 'src/app.js', token: '[redacted]' });
  });
});

test('trace store skips malformed JSONL lines on read', async (t) => {
  await withTraceStore(t, async (config) => {
    const name = 'corrupt-trace';
    await appendStoredTraceEvent(config, name, { id: 1, type: 'thinking', content: 'working' });
    await appendFile(traceStoreFilePath(config, name), '{not json}\n', 'utf8');

    const events = await readStoredTraceEvents(config, name);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'thinking');
  });
});

test('run-state persistence hook queues trace events', async (t) => {
  await withTraceStore(t, async (config) => {
    const state = createRunState({
      config,
      provider: { info: () => ({ kind: 'test' }) },
      loadPiSdk: async () => ({}),
      loadPiAi: async () => ({}),
      canAccessSession: () => true,
    });

    state.appendRunStatus('run-hook', 'running');
    await flushStoredTraceEvents(config, 'run-hook');

    const events = await readStoredTraceEvents(config, 'run-hook');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'status');
    assert.equal(events[0].runStatus, 'running');
  });
});

test('mergeTraceEvents marks only stored-only events as historical', () => {
  const merged = mergeTraceEvents(
    [
      { id: 1, timestamp: '2026-08-01T12:00:00.000Z', type: 'tool' },
      { id: 2, timestamp: '2026-08-01T12:00:01.000Z', type: 'tool' },
      { id: 1, timestamp: '2026-08-01T12:00:02.000Z', type: 'thinking' },
    ],
    [
      { id: 2, timestamp: '2026-08-01T12:00:01.000Z', type: 'tool', session: { status: 'running' } },
      { id: 3, timestamp: '2026-08-01T12:00:03.000Z', type: 'status' },
    ],
  );

  assert.deepEqual(merged.map((event) => [event.id, event.type, Boolean(event.historical)]), [
    [1, 'tool', true],
    [1, 'thinking', true],
    [2, 'tool', false],
    [3, 'status', false],
  ]);
});
