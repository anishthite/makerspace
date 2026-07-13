import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createRunState } from '../src/server/run-state.js';
import { createThreadService } from '../src/server/threads.js';
import { getStoredSession, upsertSession } from '../src/store.js';

function httpStub() {
  return {
    clientError(message, statusCode = 400) {
      const error = new Error(message);
      error.statusCode = statusCode;
      return error;
    },
  };
}

function createService(config, bridgeCalls) {
  const provider = { kind: 'cloudflare', info: () => ({ kind: 'cloudflare' }) };
  const runState = createRunState({
    config,
    provider,
    loadPiSdk: async () => ({}),
    loadPiAi: async () => ({}),
    canAccessSession: () => true,
  });

  return createThreadService({
    config,
    provider,
    http: httpStub(),
    auth: {
      canAccessSession: () => true,
      enrichGitHubRepoSession: async (session) => session,
      loadPiDefaults: async () => ({}),
    },
    runState,
    bridge: {
      fetchBridgeJson: async (session, bridgePath, options) => {
        bridgeCalls.push({ kind: 'fetch', session, path: bridgePath, options });
        return { ok: true };
      },
      refreshBridgeSessionIfNeeded: async (session) => session,
      startBridgeRun: async (session) => {
        bridgeCalls.push({ kind: 'start', session });
      },
    },
  });
}

test('bridge steering is held until the remote Pi session is running', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-steering-'));
  const sessionFile = path.join(root, 'sessions.json');
  const baseSession = {
    name: 'bridge-thread',
    provider: 'cloudflare',
    threadBridge: true,
    bridgeMode: true,
    bridgeClaimed: true,
    taskPrompt: 'initial task',
    bridgeUrl: 'https://bridge.example.test',
    bridgeRunId: 'run-1',
    bridgeToken: 'token',
    submittedAtMs: 1000,
    status: 'launching',
    runStatus: 'starting',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
  };

  try {
    await writeFile(sessionFile, `${JSON.stringify([baseSession])}\n`);
    const bridgeCalls = [];
    const service = createService({ sessionFile, settingsFile: path.join(root, 'settings.json') }, bridgeCalls);

    await assert.rejects(
      () => service.promptThreadSession('bridge-thread', { prompt: 'steer now', delivery: 'steer', submittedAtMs: 2000 }),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /starting/);
        return true;
      },
    );
    assert.equal(bridgeCalls.length, 0);
    assert.equal((await getStoredSession(sessionFile, 'bridge-thread')).threadMessages?.length || 0, 0);

    await upsertSession(sessionFile, { name: 'bridge-thread', status: 'running', runStatus: 'running' });
    const updated = await service.promptThreadSession('bridge-thread', { prompt: 'steer now', delivery: 'steer', submittedAtMs: 3000 });

    assert.equal(bridgeCalls.length, 1);
    assert.equal(bridgeCalls[0].kind, 'fetch');
    assert.equal(bridgeCalls[0].path, '/runs');
    assert.deepEqual(JSON.parse(bridgeCalls[0].options.body), {
      id: 'run-1',
      name: 'bridge-thread',
      prompt: 'steer now',
      delivery: 'steer',
      images: [],
    });
    assert.equal(updated.threadMessages.length, 1);
    assert.equal(updated.threadMessages[0].runId, 'run-1');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('completed claimed bridge starts the next follow-up instead of reporting startup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-followup-'));
  const sessionFile = path.join(root, 'sessions.json');
  const baseSession = {
    name: 'bridge-thread',
    provider: 'cloudflare',
    threadBridge: true,
    bridgeMode: true,
    bridgeClaimed: true,
    taskPrompt: 'old task',
    bridgeUrl: 'https://bridge.example.test',
    bridgeRunId: 'old-run',
    bridgeToken: 'token',
    submittedAtMs: 1000,
    status: 'completed',
    runStatus: 'completed',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
  };

  try {
    await writeFile(sessionFile, `${JSON.stringify([baseSession])}\n`);
    const bridgeCalls = [];
    const service = createService({ sessionFile, settingsFile: path.join(root, 'settings.json') }, bridgeCalls);
    const updated = await service.promptThreadSession('bridge-thread', { prompt: 'next task', submittedAtMs: 2000 });

    assert.equal(bridgeCalls.length, 1);
    assert.equal(bridgeCalls[0].kind, 'start');
    assert.equal(bridgeCalls[0].session.taskPrompt, 'next task');
    assert.notEqual(bridgeCalls[0].session.bridgeRunId, 'old-run');
    assert.equal(updated.runStatus, 'running');
    assert.equal(updated.threadMessages.length, 1);
    assert.equal(updated.threadMessages[0].text, 'next task');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
