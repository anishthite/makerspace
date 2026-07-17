import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createBridgeService } from '../src/server/bridge.js';
import { createSessionService } from '../src/server/sessions.js';
import { getStoredSession, listStoredSessions, upsertSession } from '../src/store.js';

async function waitForValue(fn) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for value.');
}

function runStateStub() {
  const runs = new Map();
  const ensureRunState = (name) => {
    if (!runs.has(name)) runs.set(name, { runStatus: 'unknown', events: [] });
    return runs.get(name);
  };
  return {
    activeRuns: runs,
    ensureRunState,
    setRunState(name, patch) { return Object.assign(ensureRunState(name), patch); },
    resetRunState(name, runStatus) { runs.set(name, { runStatus, events: [] }); return runs.get(name); },
    recordRunEvent(name, event) {
      const run = ensureRunState(name);
      run.events.push(event);
      if (event.runStatus) run.runStatus = event.runStatus;
      if (Object.prototype.hasOwnProperty.call(event, 'warning')) run.warning = event.warning || null;
      return event;
    },
    appendRunOutput() {},
    appendRunStatus() {},
    activeRunResetPatch() { return {}; },
    performancePatchForSession() { return {}; },
    persistRunStatus: async (session) => session,
    persistThreadAssistantMessage: async () => {},
    mergeTrackedChanges: (...groups) => groups.flat().filter(Boolean),
    isActiveRunStatus: (status) => ['launching', 'queued', 'starting', 'running'].includes(String(status || '').toLowerCase()),
  };
}

test('ready bridge reuse syncs current Codex auth before running', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-bridge-auth-'));
  const previousFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), body: JSON.parse(String(options.body || '{}')) });
    return new Response('{"ok":true}\n', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const config = {
      rootDir: root,
      sessionFile: path.join(root, 'sessions.json'),
      settingsFile: path.join(root, 'settings.json'),
      authFile: path.join(root, 'auth.json'),
      piDefaultsPackageDir: path.join(root, 'missing-defaults'),
      remoteWorkspaceDir: '/srv/workspace',
      bridgePort: 4310,
      bridgeReadyTimeoutMs: 1000,
      bridgeReadyPollMs: 10,
    };
    await writeFile(config.settingsFile, '{}\n');
    const bridge = createBridgeService({
      config,
      provider: {
        kind: 'test',
        shouldRefreshSession: () => false,
        bridgeHeaders: () => ({}),
        info: () => ({ kind: 'test' }),
      },
      auth: {
        readPiAuthForSession: async (session) => `auth-for-${session.ownerUserId}`,
        readLocalPiSettings: async () => null,
        readGitHubAuthForSession: async (session) => ({
          token: `github-for-${session.ownerUserId}`,
          login: 'octo',
          name: 'Octo Cat',
          email: 'octo@example.test',
        }),
      },
      runState: runStateStub(),
    });

    const session = {
      name: 'thread-a',
      bridgeUrl: 'https://bridge.example',
      bridgeToken: 'secret',
      ownerUserId: 'github-1',
    };

    assert.equal(await bridge.refreshBridgeSessionIfNeeded(session), session);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://bridge.example/auth');
    assert.equal(requests[0].body.authText, 'auth-for-github-1');
    assert.deepEqual(requests[0].body.github, {
      token: 'github-for-github-1',
      login: 'octo',
      name: 'Octo Cat',
      email: 'octo@example.test',
    });
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('idle cleanup destroys reusable bridges and auto-suspends thread bridges', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-idle-thread-cleanup-'));
  const sessionFile = path.join(root, 'sessions.json');
  const destroyed = [];
  const suspended = [];
  const freshNow = new Date().toISOString();
  const expiredAt = new Date(Date.now() - 120_000).toISOString();

  try {
    await writeFile(sessionFile, `${JSON.stringify([
      {
        name: 'idle-reusable',
        bridgeMode: true,
        bridgeClaimed: false,
        status: 'ready',
        runStatus: 'ready',
        bridgeUrl: 'https://idle.example.test',
        bridgeToken: 'secret',
        updatedAt: expiredAt,
      },
      {
        name: 'idle-thread',
        threadBridge: true,
        bridgeMode: true,
        bridgeClaimed: false,
        status: 'ready',
        runStatus: 'ready',
        bridgeUrl: 'https://thread.example.test',
        bridgeToken: 'secret',
        updatedAt: expiredAt,
      },
      {
        name: 'completed-thread',
        threadBridge: true,
        bridgeMode: true,
        bridgeClaimed: true,
        status: 'completed',
        runStatus: 'completed',
        bridgeUrl: 'https://completed.example.test',
        bridgeToken: 'secret',
        updatedAt: expiredAt,
      },
      {
        name: 'failed-thread',
        threadBridge: true,
        bridgeMode: true,
        bridgeClaimed: true,
        status: 'failed',
        runStatus: 'failed',
        bridgeUrl: 'https://failed.example.test',
        bridgeToken: 'secret',
        updatedAt: expiredAt,
      },
      {
        name: 'fresh-thread',
        threadBridge: true,
        bridgeMode: true,
        bridgeClaimed: false,
        status: 'ready',
        runStatus: 'ready',
        bridgeUrl: 'https://fresh.example.test',
        bridgeToken: 'secret',
        updatedAt: freshNow,
      },
      {
        name: 'active-thread',
        threadBridge: true,
        bridgeMode: true,
        bridgeClaimed: true,
        status: 'running',
        runStatus: 'running',
        bridgeUrl: 'https://active.example.test',
        bridgeToken: 'secret',
        updatedAt: expiredAt,
      },
    ])}\n`);

    const bridge = createBridgeService({
      config: { sessionFile, idleBridgeTtlMs: 60_000, threadBridgeIdleTtlMs: 60_000 },
      provider: {
        destroySession: async (name) => { destroyed.push(name); },
        suspendSession: async (session) => {
          suspended.push(session.name);
          return { cloudflareBackups: [{ key: 'workspace', backup: { id: `${session.name}-backup` } }] };
        },
      },
      auth: {},
      runState: runStateStub(),
    });

    await bridge.pruneExpiredIdleBridges();

    assert.equal(await getStoredSession(sessionFile, 'idle-reusable'), null);
    const idleThread = await getStoredSession(sessionFile, 'idle-thread');
    assert.equal(idleThread.runStatus, 'suspended');
    assert.equal(idleThread.autoSuspendedAt, idleThread.suspendedAt);
    assert.equal(idleThread.cloudflareBackups[0].backup.id, 'idle-thread-backup');
    const completedThread = await getStoredSession(sessionFile, 'completed-thread');
    assert.equal(completedThread.runStatus, 'suspended');
    assert.equal(completedThread.bridgeClaimed, false);
    const failedThread = await getStoredSession(sessionFile, 'failed-thread');
    assert.equal(failedThread.runStatus, 'suspended');
    assert.equal(failedThread.bridgeClaimed, false);
    assert.equal((await getStoredSession(sessionFile, 'fresh-thread')).runStatus, 'ready');
    assert.equal((await getStoredSession(sessionFile, 'active-thread')).runStatus, 'running');
    assert.deepEqual(destroyed, ['idle-reusable']);
    assert.deepEqual(suspended, ['idle-thread', 'completed-thread', 'failed-thread']);
    assert.equal((await listStoredSessions(sessionFile)).length, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bridge auth sync retries transient container startup responses', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-bridge-startup-retry-'));
  const previousFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('{"error":"Container is starting. Please retry in a moment."}', { status: 503, headers: { 'retry-after': '0' } });
    }
    return new Response('{"ok":true}\n', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const config = {
      sessionFile: path.join(root, 'sessions.json'),
      settingsFile: path.join(root, 'settings.json'),
      piDefaultsPackageDir: path.join(root, 'missing-defaults'),
      bridgeReadyTimeoutMs: 1000,
    };
    await writeFile(config.settingsFile, '{}\n');
    const bridge = createBridgeService({
      config,
      provider: { kind: 'test', shouldRefreshSession: () => false, bridgeHeaders: () => ({}) },
      auth: {
        readPiAuthForSession: async () => 'auth',
        readLocalPiSettings: async () => null,
        readGitHubAuthForSession: async () => null,
      },
      runState: runStateStub(),
    });

    const session = { name: 'thread-wake', bridgeUrl: 'https://bridge.example', bridgeToken: 'secret' };
    assert.equal(await bridge.refreshBridgeSessionIfNeeded(session), session);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('bridge follower back-syncs refreshed remote Pi auth on terminal runs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-bridge-auth-back-sync-'));
  const sessionFile = path.join(root, 'sessions.json');
  const previousFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let synced = null;

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.endsWith('/auth')) {
      return new Response(JSON.stringify({ authText: '{"openai-codex":{"type":"oauth","access":"new","refresh":"new-refresh","expires":9999999999999,"accountId":"acct"}}' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"index":1,"type":"status","runStatus":"failed","done":true}\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

  try {
    await writeFile(sessionFile, `${JSON.stringify([{
      name: 'remote-thread',
      ownerUserId: 'github-1',
      bridgeUrl: 'https://bridge.example.test',
      bridgeRunId: 'run-1',
      bridgeToken: 'secret',
      status: 'running',
      runStatus: 'running',
    }])}\n`);
    const bridge = createBridgeService({
      config: { sessionFile },
      provider: { bridgeHeaders: () => ({}) },
      auth: {
        syncPiAuthForSession: async (session, authText) => {
          synced = { session, authText };
          return 1;
        },
      },
      runState: runStateStub(),
    });

    await bridge.followBridgeRun('remote-thread');

    assert.equal(synced.session.ownerUserId, 'github-1');
    assert.match(synced.authText, /new-refresh/);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('bridge SSE consumer parses CRLF-delimited remote events', async () => {
  const bridge = createBridgeService({
    config: {},
    provider: {},
    auth: {},
    runState: runStateStub(),
  });
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"type":"tool","phase":"start"}\r\n',
    '\r\n',
    'data: {"done":true}\r\n\r\n',
  ].map((chunk) => encoder.encode(chunk));
  const response = new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }));
  const events = [];

  await bridge.consumeSse(response, (event) => events.push(event));

  assert.deepEqual(events, [
    { type: 'tool', phase: 'start' },
    { done: true },
  ]);
});

test('bridge SSE consumer ignores heartbeat comments for liveness', async () => {
  const bridge = createBridgeService({
    config: {},
    provider: {},
    auth: {},
    runState: runStateStub(),
  });
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(': ping\n\n'));
      controller.enqueue(encoder.encode('data: {"type":"status","runStatus":"running"}\n\n'));
      controller.close();
    },
  }));
  const events = [];
  let activityCount = 0;

  await bridge.consumeSse(response, (event) => events.push(event), () => { activityCount += 1; });

  assert.equal(activityCount, 1);
  assert.deepEqual(events, [{ type: 'status', runStatus: 'running' }]);
});

test('browser SSE route disables proxy buffering', async () => {
  const source = await readFile(new URL('../src/server/routes.js', import.meta.url), 'utf8');
  assert.match(source, /'x-accel-buffering': 'no'/);
});

test('thread output sync starts the active bridge follower', async () => {
  const runState = runStateStub();
  let followed = '';
  const sessions = createSessionService({
    config: {},
    provider: {},
    auth: { readLocalPiAuth: async () => null },
    runState,
    bridge: {
      claimReusableBridgeSession: async () => null,
      waitForBridge: async () => {},
      pushBridgeAuth: async () => {},
      startBridgeRun: async () => {},
      reattachBridgeRun: async (session) => {
        followed = session.name;
        return runState.ensureRunState(session.name);
      },
    },
  });

  const run = await sessions.syncRunOutput({
    name: 'remote-thread',
    bridgeMode: true,
    bridgeClaimed: true,
    bridgeUrl: 'https://bridge.example.test',
    bridgeRunId: 'run-1',
    bridgeToken: 'secret',
    runStatus: 'running',
  });

  assert.equal(followed, 'remote-thread');
  assert.equal(run, runState.activeRuns.get('remote-thread'));
});

test('thread output sync does not create a dead run before bridge URL exists', async () => {
  const runState = runStateStub();
  const sessions = createSessionService({
    config: {},
    provider: {},
    auth: { readLocalPiAuth: async () => null },
    runState,
    bridge: {
      claimReusableBridgeSession: async () => null,
      waitForBridge: async () => {},
      pushBridgeAuth: async () => {},
      startBridgeRun: async () => {},
      followBridgeRun: () => { throw new Error('should not follow before bridge URL exists'); },
    },
  });

  const run = await sessions.syncRunOutput({
    name: 'remote-thread',
    bridgeMode: true,
    bridgeClaimed: true,
    bridgeUrl: null,
    runStatus: 'launching',
    status: 'launching',
  });

  assert.equal(runState.activeRuns.has('remote-thread'), false);
  assert.equal(run.runStatus, 'launching');
  assert.equal(run.events[0].message, 'waiting for remote bridge');
});

test('thread bridge launch failure destroys Cloudflare sandbox and keeps safe diagnostics', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-bridge-diagnostics-'));
  const sessionFile = path.join(root, 'sessions.json');
  const destroyed = [];

  try {
    const bridge = createBridgeService({
      config: {
        sessionFile,
        image: '',
        remoteWorkspaceDir: '/workspace',
        bridgePort: 4310,
      },
      provider: {
        kind: 'cloudflare',
        createSession: async (_session, imageSettings) => {
          await imageSettings.onLaunchLog('provider:test_step', { bridgeToken: 'secret', ok: true });
          throw new Error('sandbox boom');
        },
        destroySession: async (name) => { destroyed.push(name); },
      },
      auth: {
        readPiAuthForSession: async () => null,
        readLocalPiSettings: async () => null,
      },
      runState: runStateStub(),
    });

    await bridge.startThreadBridgeLaunch({
      name: 'diagnostic-thread',
      repoUrl: 'https://github.com/acme/repo.git',
      repoMode: 'git',
      taskPrompt: 'work',
      threadBridge: true,
      bridgeMode: true,
      sharePort: 4310,
    }, {});

    const stored = await waitForValue(async () => {
      const session = await getStoredSession(sessionFile, 'diagnostic-thread');
      const phases = session?.bridgeLaunchLog?.map((entry) => entry.phase) || [];
      return phases.includes('launch:destroyed_after_failure') ? session : null;
    });
    const phases = stored.bridgeLaunchLog.map((entry) => entry.phase);

    assert.deepEqual(destroyed, ['diagnostic-thread']);
    assert.equal(stored.warning, 'sandbox boom');
    assert.ok(phases.includes('thread_launch:queued'));
    assert.ok(phases.includes('thread_launch:worker_start'));
    assert.ok(phases.includes('provider:test_step'));
    assert.ok(phases.includes('launch:failed'));
    assert.equal(stored.bridgeLaunchLog.some((entry) => Object.prototype.hasOwnProperty.call(entry, 'bridgeToken')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bridge follower records structured remote events', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-bridge-events-'));
  const sessionFile = path.join(root, 'sessions.json');
  const previousFetch = globalThis.fetch;
  const encoder = new TextEncoder();

  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      for (const event of [
        { index: 1, type: 'tool', phase: 'start', toolName: 'bash', runStatus: 'running' },
        { index: 2, type: 'status', runStatus: 'failed', warning: 'done for test', done: true },
      ]) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });

  try {
    await writeFile(sessionFile, `${JSON.stringify([{
      name: 'remote-thread',
      bridgeUrl: 'https://bridge.example.test',
      bridgeRunId: 'run-1',
      bridgeToken: 'secret',
      status: 'running',
      runStatus: 'running',
    }])}\n`);
    const runState = runStateStub();
    const bridge = createBridgeService({
      config: { sessionFile },
      provider: { bridgeHeaders: () => ({}) },
      auth: {},
      runState,
    });

    await bridge.followBridgeRun('remote-thread');

    assert.equal(runState.activeRuns.get('remote-thread').events[0].type, 'tool');
    assert.equal(runState.activeRuns.get('remote-thread').warning, 'done for test');
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('bridge follower retries transient missing remote runs before failing stale', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-bridge-missing-retry-'));
  const sessionFile = path.join(root, 'sessions.json');
  const previousFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let fetches = 0;
  let backups = 0;

  globalThis.fetch = async () => {
    fetches += 1;
    if (fetches === 1) return new Response('{"error":"Run not found."}', { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ index: 1, type: 'status', runStatus: 'completed', done: true })}\n\n`));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

  try {
    await writeFile(sessionFile, `${JSON.stringify([{
      name: 'remote-thread',
      bridgeUrl: 'https://bridge.example.test',
      bridgeRunId: 'run-1',
      bridgeToken: 'secret',
      status: 'running',
      runStatus: 'running',
    }])}\n`);
    const runState = runStateStub();
    runState.persistRunStatus = (session, runStatus) => upsertSession(sessionFile, { ...session, status: runStatus, runStatus });
    const bridge = createBridgeService({
      config: { sessionFile, bridgeRunMissingGraceMs: 30_000 },
      provider: {
        bridgeHeaders: () => ({}),
        backupSession: async () => { backups += 1; return {}; },
      },
      auth: {},
      runState,
    });

    await bridge.followBridgeRun('remote-thread');
    const stored = await getStoredSession(sessionFile, 'remote-thread');

    assert.equal(fetches, 2);
    assert.equal(backups, 0);
    assert.equal(stored.status, 'completed');
    assert.equal(stored.runStatus, 'completed');
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('bridge follower marks missing remote runs stale and snapshots when possible', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-bridge-stale-'));
  const sessionFile = path.join(root, 'sessions.json');
  const previousFetch = globalThis.fetch;
  let backups = 0;

  globalThis.fetch = async () => new Response('{"error":"Run not found."}', { status: 404, headers: { 'content-type': 'application/json' } });

  try {
    await writeFile(sessionFile, `${JSON.stringify([{
      name: 'remote-thread',
      threadBridge: true,
      bridgeMode: true,
      bridgeClaimed: true,
      bridgeUrl: 'https://bridge.example.test',
      bridgeRunId: 'run-1',
      bridgeToken: 'secret',
      status: 'running',
      runStatus: 'running',
      taskPrompt: 'work',
      images: [{ type: 'image', mimeType: 'image/png', data: 'cG5n' }],
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    }])}\n`);
    const bridge = createBridgeService({
      config: { sessionFile, bridgeRunStaleMs: 60_000, bridgeRunMissingGraceMs: 0 },
      provider: {
        bridgeHeaders: () => ({}),
        backupSession: async (session) => {
          backups += 1;
          return { cloudflareBackups: [{ key: 'workspace', backup: { id: `backup-${session.name}` } }], cloudflareBackupCreatedAt: '2026-07-12T00:01:00.000Z' };
        },
      },
      auth: {},
      runState: runStateStub(),
    });

    await bridge.followBridgeRun('remote-thread');
    const stored = await getStoredSession(sessionFile, 'remote-thread');

    assert.equal(backups, 1);
    assert.equal(stored.status, 'failed');
    assert.equal(stored.runStatus, 'failed');
    assert.equal(stored.bridgeClaimed, false);
    assert.equal(stored.taskPrompt, '');
    assert.deepEqual(stored.images, []);
    assert.equal(stored.cloudflareBackups[0].backup.id, 'backup-remote-thread');
    assert.match(stored.warning, /disappeared/);
    assert.ok(stored.staleAt);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});
