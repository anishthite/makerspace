import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createBridgeService } from '../src/server/bridge.js';
import { createSessionService } from '../src/server/sessions.js';
import { getStoredSession } from '../src/store.js';

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
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-bridge-auth-'));
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

test('bridge follower back-syncs refreshed remote Pi auth on terminal runs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-bridge-auth-back-sync-'));
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
      followBridgeRun: (name) => { followed = name; },
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

test('thread bridge launch persists safe diagnostics', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-bridge-diagnostics-'));
  const sessionFile = path.join(root, 'sessions.json');

  try {
    const bridge = createBridgeService({
      config: {
        sessionFile,
        image: '',
        remoteWorkspaceDir: '/workspace',
        bridgePort: 4310,
      },
      provider: {
        kind: 'test',
        createSession: async (_session, imageSettings) => {
          await imageSettings.onLaunchLog('provider:test_step', { bridgeToken: 'secret', ok: true });
          throw new Error('sandbox boom');
        },
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
      return session?.warning === 'sandbox boom' ? session : null;
    });
    const phases = stored.bridgeLaunchLog.map((entry) => entry.phase);

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
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-bridge-events-'));
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
