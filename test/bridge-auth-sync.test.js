import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createBridgeService } from '../src/server/bridge.js';

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
