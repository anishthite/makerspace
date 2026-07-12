import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { createBridgeService } from '../src/server/bridge.js';
import { createRunState } from '../src/server/run-state.js';
import { getStoredSession } from '../src/store.js';

function sseResponse(events) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

function makeRunState(config) {
  return createRunState({
    config,
    provider: { info: () => ({ kind: 'test' }) },
    loadPiSdk: async () => ({}),
    loadPiAi: async () => ({}),
    canAccessSession: () => true,
  });
}

test('bridge reattach seeds live run state from stored active session', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-bridge-reattach-'));
  const sessionFile = path.join(root, 'sessions.json');
  const previousFetch = globalThis.fetch;

  try {
    await writeFile(sessionFile, `${JSON.stringify([{
      name: 'bridge-thread',
      provider: 'cloudflare',
      threadBridge: true,
      bridgeMode: true,
      bridgeClaimed: true,
      bridgeUrl: 'https://bridge.test',
      bridgeRunId: 'run-1',
      bridgeToken: 'secret',
      taskPrompt: 'hello',
      status: 'running',
      runStatus: 'running',
    }])}\n`);

    globalThis.fetch = async () => { throw new Error('reattach should not fetch when follow is disabled'); };

    const config = { sessionFile, bridgeStreamStallMs: 5000 };
    const runState = makeRunState(config);
    const bridge = createBridgeService({
      config,
      provider: { kind: 'cloudflare', info: () => ({ kind: 'cloudflare' }) },
      auth: {},
      runState,
    });

    const run = await bridge.reattachBridgeRun((await getStoredSession(sessionFile, 'bridge-thread')), { follow: false });

    assert.equal(run.runStatus, 'running');
    assert.equal(runState.activeRuns.get('bridge-thread').runStatus, 'running');
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('bridge follower relays first-class chunk events without stdout reparsing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-bridge-chunks-'));
  const sessionFile = path.join(root, 'sessions.json');
  const now = '2026-07-12T00:00:00.000Z';
  const previousFetch = globalThis.fetch;

  try {
    await writeFile(sessionFile, `${JSON.stringify([{
      name: 'bridge-thread',
      provider: 'cloudflare',
      threadBridge: true,
      bridgeMode: true,
      bridgeClaimed: true,
      bridgeUrl: 'https://bridge.test',
      bridgeRunId: 'run-1',
      bridgeToken: 'secret',
      taskPrompt: 'hello',
      status: 'running',
      runStatus: 'running',
      submittedAtMs: Date.parse(now),
      createdAt: now,
      updatedAt: now,
      threadMessages: [{ role: 'user', text: 'hello', timestamp: now, runId: 'run-1' }],
    }])}\n`);

    globalThis.fetch = async (url, options = {}) => {
      assert.equal(String(url), 'https://bridge.test/runs/run-1/stream?after=0');
      assert.equal(options.headers.authorization, 'Bearer secret');
      return sseResponse([
        { index: 1, type: 'chunk', chunk: 'hello ', runStatus: 'running' },
        { index: 2, type: 'chunk', chunk: 'world', runStatus: 'running' },
        { index: 3, type: 'status', runStatus: 'failed', done: true, exitCode: 1 },
      ]);
    };

    const config = { sessionFile, bridgeStreamStallMs: 5000 };
    const runState = makeRunState(config);
    const bridge = createBridgeService({
      config,
      provider: { kind: 'cloudflare', info: () => ({ kind: 'cloudflare' }) },
      auth: {},
      runState,
    });

    await bridge.followBridgeRun('bridge-thread');

    const run = runState.activeRuns.get('bridge-thread');
    assert.deepEqual(run.events.filter((event) => event.type === 'chunk').map((event) => event.chunk), ['hello ', 'world']);
    assert.equal(run.output, 'hello world');
    assert.equal(run.events.some((event) => event.type === 'stdout'), false);

    const stored = await getStoredSession(sessionFile, 'bridge-thread');
    assert.equal(stored.threadMessages.at(-1).role, 'assistant');
    assert.equal(stored.threadMessages.at(-1).text, 'hello world');
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('remote bridge script emits assistant deltas as chunk events', async () => {
  const setupScript = await readFile(new URL('../src/setup-script.js', import.meta.url), 'utf8');

  assert.match(setupScript, /publish\(run, \{ type: "chunk", chunk: e\.delta, runStatus: "running" \}\)/);
  assert.match(setupScript, /publish\(run, \{ type: "chunk", chunk: finalText, runStatus: "running" \}\)/);
  assert.match(setupScript, /publish\(run, \{ type: "chunk", chunk: lastAssistantText, runStatus: "running" \}\)/);
  assert.doesNotMatch(setupScript, /type: "stdout", chunk: e\.delta/);
});
