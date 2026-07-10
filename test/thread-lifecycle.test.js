import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createRunState } from '../src/server/run-state.js';
import { createThreadService } from '../src/server/threads.js';
import { getStoredSession } from '../src/store.js';

function httpStub() {
  return {
    clientError(message, statusCode = 400) {
      const error = new Error(message);
      error.statusCode = statusCode;
      return error;
    },
  };
}

function createService(config, provider, bridgeCalls = []) {
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
      readBrowserSession: async () => null,
    },
    runState,
    bridge: {
      fetchBridgeJson: async () => ({}),
      refreshBridgeSessionIfNeeded: async (session) => session,
      startBridgeRun: async () => {},
      waitForBridge: async (session) => bridgeCalls.push(['waitForBridge', session.bridgeUrl]),
      syncBridgeAuth: async (session) => bridgeCalls.push(['syncBridgeAuth', session.name]),
    },
  });
}

function baseSession(overrides = {}) {
  return {
    name: 'daytona-thread',
    provider: 'daytona',
    threadBridge: true,
    bridgeMode: true,
    status: 'ready',
    runStatus: 'ready',
    bridgeUrl: 'https://old.example.test',
    daytonaSandboxId: 'sandbox-1',
    daytonaSandboxName: 'daytona-thread',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

test('thread lifecycle service suspends, resumes, and snapshot-deletes idle Daytona sessions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-lifecycle-'));
  const sessionFile = path.join(root, 'sessions.json');
  const settingsFile = path.join(root, 'settings.json');
  const calls = [];
  const bridgeCalls = [];
  const provider = {
    kind: 'daytona',
    info: () => ({ kind: 'daytona' }),
    suspendSession: async (session) => {
      calls.push(['suspend', session.name]);
      return { daytonaState: 'stopped' };
    },
    resumeSession: async (session, settings) => {
      calls.push(['resume', session.name, settings.imageRef]);
      return { bridgeUrl: 'https://new.example.test/', httpsUrl: 'https://new.example.test/', previewToken: 'preview-token', daytonaState: 'started' };
    },
    deleteSessionWithSnapshot: async (session) => {
      calls.push(['delete', session.name]);
      return { snapshotName: 'snapshot-one', snapshotCreatedAt: '2026-07-10T01:00:00.000Z', daytonaSandboxId: 'sandbox-1', daytonaSandboxName: 'daytona-thread' };
    },
  };

  try {
    await writeFile(sessionFile, `${JSON.stringify([baseSession()])}\n`);
    await writeFile(settingsFile, `${JSON.stringify({ imageRef: 'image-one' })}\n`);
    const service = createService({ sessionFile, settingsFile }, provider, bridgeCalls);

    const suspended = await service.suspendThreadSession('daytona-thread');
    assert.equal(suspended.runStatus, 'suspended');
    assert.equal(suspended.daytonaState, 'stopped');

    const resumed = await service.resumeThreadSession('daytona-thread');
    assert.equal(resumed.runStatus, 'ready');
    assert.equal(resumed.bridgeUrl, 'https://new.example.test');
    assert.deepEqual(bridgeCalls, [['waitForBridge', 'https://new.example.test'], ['syncBridgeAuth', 'daytona-thread']]);

    const { thread, snapshot } = await service.deleteThreadSession('daytona-thread');
    assert.equal(snapshot.snapshotName, 'snapshot-one');
    assert.equal(thread.runStatus, 'deleted');
    assert.equal(thread.snapshotName, 'snapshot-one');
    assert.equal(thread.daytonaSandboxId, null);
    assert.equal(thread.deletedDaytonaSandboxId, 'sandbox-1');
    assert.deepEqual(calls.map((call) => call[0]), ['suspend', 'resume', 'delete']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('thread lifecycle rejects active runs and keeps sandbox when snapshot fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-lifecycle-fail-'));
  const sessionFile = path.join(root, 'sessions.json');
  const settingsFile = path.join(root, 'settings.json');
  const calls = [];
  const provider = {
    kind: 'daytona',
    info: () => ({ kind: 'daytona' }),
    suspendSession: async () => calls.push(['suspend']),
    resumeSession: async () => calls.push(['resume']),
    deleteSessionWithSnapshot: async () => {
      calls.push(['delete']);
      throw new Error('snapshot API unavailable');
    },
  };

  try {
    await writeFile(sessionFile, `${JSON.stringify([baseSession({ status: 'running', runStatus: 'running', bridgeClaimed: true })])}\n`);
    await writeFile(settingsFile, '{}\n');
    const service = createService({ sessionFile, settingsFile }, provider);

    await assert.rejects(() => service.suspendThreadSession('daytona-thread'), (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /Only idle/);
      return true;
    });
    assert.deepEqual(calls, []);

    await writeFile(sessionFile, `${JSON.stringify([baseSession()])}\n`);
    await assert.rejects(() => service.resumeThreadSession('daytona-thread'), (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /Only suspended/);
      return true;
    });
    assert.deepEqual(calls, []);

    await assert.rejects(() => service.deleteThreadSession('daytona-thread'), /snapshot API unavailable/);
    const stored = await getStoredSession(sessionFile, 'daytona-thread');
    assert.equal(stored.runStatus, 'ready');
    assert.equal(stored.daytonaSandboxId, 'sandbox-1');
    assert.equal(stored.deletedAt, undefined);
    assert.equal(stored.warning, 'snapshot API unavailable');
    assert.deepEqual(calls, [['delete']]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
