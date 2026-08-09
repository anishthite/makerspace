import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { createHttpHelpers } from '../src/server/http.js';
import { createRunState } from '../src/server/run-state.js';
import { createRequestHandler } from '../src/server/routes.js';
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

function authStub() {
  return {
    canAccessSession: () => true,
    enrichGitHubRepoSession: async (session) => session,
    loadPiDefaults: async () => ({}),
    readBrowserSession: async () => null,
  };
}

function createServiceContext(config, provider, bridgeCalls = [], http = httpStub()) {
  const auth = authStub();
  const runState = createRunState({
    config,
    provider,
    loadPiSdk: async () => ({}),
    loadPiAi: async () => ({}),
    canAccessSession: () => true,
  });

  const bridge = {
    fetchBridgeJson: async () => ({}),
    refreshBridgeSessionIfNeeded: async (session) => session,
    startBridgeRun: async (session) => bridgeCalls.push(['startBridgeRun', session.bridgeUrl, session.taskPrompt]),
    waitForBridge: async (session) => bridgeCalls.push(['waitForBridge', session.bridgeUrl]),
    syncBridgeAuth: async (session) => bridgeCalls.push(['syncBridgeAuth', session.name]),
  };

  const service = createThreadService({
    config,
    provider,
    http,
    auth,
    runState,
    bridge,
  });

  return { service, runState, auth, bridge };
}

function createService(config, provider, bridgeCalls = []) {
  return createServiceContext(config, provider, bridgeCalls).service;
}

async function requestJson(handler, method, url, body = null, headers = {}) {
  const request = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.url = url;
  request.headers = {
    host: 'localhost',
    ...(body === null ? {} : { 'content-type': 'application/json' }),
    ...headers,
  };

  let statusCode = 0;
  let responseHeaders = {};
  let responseBody = '';
  const response = {
    writeHead(status, nextHeaders = {}) {
      statusCode = status;
      responseHeaders = nextHeaders;
    },
    end(chunk = '') {
      responseBody += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    },
  };

  await handler(request, response);
  return {
    status: statusCode,
    headers: responseHeaders,
    body: responseBody.trim() ? JSON.parse(responseBody) : null,
  };
}

function routeAuthStub(auth) {
  return {
    ...auth,
    requireApiToken: () => false,
    requireTrustedBrowserRequest: () => false,
    requireAuthMutationOrigin: () => false,
    browserSessionId: () => 'browser-session',
    hasTrustedControlToken: () => true,
    currentUser: async () => null,
    requireUser: async () => ({ user: null }),
    publicMe: () => ({ trusted: true }),
  };
}

function unusedRoute() {
  throw new Error('Unexpected route dependency.');
}

function routeSessionsStub() {
  return {
    createChatSession: unusedRoute,
    createManualSession: unusedRoute,
    syncRunOutput: async (thread) => ({ runStatus: thread.runStatus || thread.status || 'unknown' }),
  };
}

function createRouteHandler(config, provider, http, auth, runState, service) {
  return createRequestHandler({
    config,
    provider,
    http,
    auth: routeAuthStub(auth),
    runState,
    threads: service,
    sessions: routeSessionsStub(),
  });
}

function baseSession(overrides = {}) {
  return {
    name: 'cloudflare-thread',
    provider: 'cloudflare',
    threadBridge: true,
    bridgeMode: true,
    status: 'ready',
    runStatus: 'ready',
    bridgeUrl: 'https://old.example.test',
    sandboxId: 'sandbox-1',
    cloudflareSandboxId: 'sandbox-1',
    cloudflareSandboxName: 'cloudflare-thread',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

test('thread lifecycle service suspends, resumes, and backup-deletes idle Cloudflare sessions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-lifecycle-'));
  const sessionFile = path.join(root, 'sessions.json');
  const settingsFile = path.join(root, 'settings.json');
  const calls = [];
  const bridgeCalls = [];
  const provider = {
    kind: 'cloudflare',
    info: () => ({ kind: 'cloudflare' }),
    suspendSession: async (session) => {
      calls.push(['suspend', session.name]);
      return { cloudflareState: 'stopped', cloudflareBackups: [{ key: 'workspace', backup: { id: 'backup-one' } }] };
    },
    resumeSession: async (session, settings) => {
      calls.push(['resume', session.name, settings.imageRef]);
      return { bridgeUrl: 'https://new.example.test/', httpsUrl: 'https://new.example.test/', cloudflareState: 'started' };
    },
    deleteSessionWithBackup: async (session) => {
      calls.push(['delete', session.name]);
      return { cloudflareBackups: [{ key: 'workspace', backup: { id: 'backup-two' } }], cloudflareBackupCreatedAt: '2026-07-10T01:00:00.000Z', cloudflareSandboxId: 'sandbox-1' };
    },
  };

  try {
    await writeFile(sessionFile, `${JSON.stringify([baseSession()])}\n`);
    await writeFile(settingsFile, `${JSON.stringify({ imageRef: 'ignored-by-cloudflare' })}\n`);
    const service = createService({ sessionFile, settingsFile }, provider, bridgeCalls);

    const suspended = await service.suspendThreadSession('cloudflare-thread');
    assert.equal(suspended.runStatus, 'suspended');
    assert.equal(suspended.cloudflareState, 'stopped');
    assert.equal(suspended.cloudflareBackups[0].backup.id, 'backup-one');

    const resumed = await service.resumeThreadSession('cloudflare-thread');
    assert.equal(resumed.runStatus, 'ready');
    assert.equal(resumed.bridgeUrl, 'https://new.example.test');
    assert.deepEqual(bridgeCalls, [['waitForBridge', 'https://new.example.test'], ['syncBridgeAuth', 'cloudflare-thread']]);

    const { thread, backup } = await service.deleteThreadSession('cloudflare-thread');
    assert.equal(backup.cloudflareBackups[0].backup.id, 'backup-two');
    assert.equal(thread.runStatus, 'deleted');
    assert.equal(thread.cloudflareBackups[0].backup.id, 'backup-two');
    assert.equal(thread.cloudflareSandboxId, null);
    assert.equal(thread.deletedSandboxId, 'sandbox-1');
    assert.deepEqual(calls.map((call) => call[0]), ['suspend', 'resume', 'delete']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('message send auto-resumes a suspended Cloudflare thread before starting the run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-auto-resume-'));
  const sessionFile = path.join(root, 'sessions.json');
  const settingsFile = path.join(root, 'settings.json');
  const calls = [];
  const bridgeCalls = [];
  const provider = {
    kind: 'cloudflare',
    info: () => ({ kind: 'cloudflare' }),
    resumeSession: async (session, settings) => {
      calls.push(['resume', session.name, session.runStatus, settings.imageRef]);
      return { bridgeUrl: 'https://resumed.example.test/', httpsUrl: 'https://resumed.example.test/' };
    },
  };

  try {
    await writeFile(sessionFile, `${JSON.stringify([baseSession({
      status: 'suspended',
      runStatus: 'suspended',
      bridgeToken: 'bridge-secret',
      bridgeClaimed: false,
      taskPrompt: '',
      cloudflareBackups: [{ key: 'workspace', backup: { id: 'backup-one' } }],
    })])}\n`);
    await writeFile(settingsFile, `${JSON.stringify({ imageRef: 'resume-image' })}\n`);
    const service = createService({ sessionFile, settingsFile }, provider, bridgeCalls);

    const prompted = await service.promptThreadSession('cloudflare-thread', { prompt: 'continue work', submittedAtMs: 2000 });
    const stored = await getStoredSession(sessionFile, 'cloudflare-thread');

    assert.equal(prompted.runStatus, 'running');
    assert.equal(prompted.bridgeUrl, 'https://resumed.example.test');
    assert.equal(stored.taskPrompt, 'continue work');
    assert.equal(stored.threadMessages.length, 1);
    assert.equal(stored.threadMessages[0].text, 'continue work');
    assert.equal(stored.threadMessages[0].role, 'user');
    assert.deepEqual(calls, [['resume', 'cloudflare-thread', 'launching', 'resume-image']]);
    assert.deepEqual(bridgeCalls, [
      ['waitForBridge', 'https://resumed.example.test'],
      ['syncBridgeAuth', 'cloudflare-thread'],
      ['startBridgeRun', 'https://resumed.example.test', 'continue work'],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('message route auto-resumes a suspended Cloudflare thread before starting the run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-auto-resume-route-'));
  const sessionFile = path.join(root, 'sessions.json');
  const settingsFile = path.join(root, 'settings.json');
  const calls = [];
  const bridgeCalls = [];
  const provider = {
    kind: 'cloudflare',
    info: () => ({ kind: 'cloudflare' }),
    resumeSession: async (session, settings) => {
      calls.push(['resume', session.name, session.runStatus, settings.imageRef]);
      return { bridgeUrl: 'https://route-resumed.example.test/', httpsUrl: 'https://route-resumed.example.test/' };
    },
  };

  try {
    await writeFile(sessionFile, `${JSON.stringify([baseSession({
      status: 'suspended',
      runStatus: 'suspended',
      bridgeToken: 'bridge-secret',
      bridgeClaimed: false,
      taskPrompt: '',
      cloudflareBackups: [{ key: 'workspace', backup: { id: 'backup-one' } }],
    })])}\n`);
    await writeFile(settingsFile, `${JSON.stringify({ imageRef: 'resume-image' })}\n`);
    const http = createHttpHelpers({ publicDir: root });
    const { service, runState, auth } = createServiceContext({ sessionFile, settingsFile }, provider, bridgeCalls, http);
    const handler = createRouteHandler({ sessionFile, settingsFile }, provider, http, auth, runState, service);

    const response = await requestJson(handler, 'POST', '/api/threads/cloudflare-thread/messages', {
      prompt: 'continue through route',
      submittedAtMs: 3000,
    }, { 'x-spanner-session': 'browser-session' });
    const stored = await getStoredSession(sessionFile, 'cloudflare-thread');

    assert.equal(response.status, 202);
    assert.equal(response.body.thread.runStatus, 'running');
    assert.equal(response.body.thread.bridgeUrl, 'https://route-resumed.example.test');
    assert.equal(stored.taskPrompt, 'continue through route');
    assert.equal(stored.threadMessages.length, 1);
    assert.equal(stored.threadMessages[0].text, 'continue through route');
    assert.deepEqual(calls, [['resume', 'cloudflare-thread', 'launching', 'resume-image']]);
    assert.deepEqual(bridgeCalls, [
      ['waitForBridge', 'https://route-resumed.example.test'],
      ['syncBridgeAuth', 'cloudflare-thread'],
      ['startBridgeRun', 'https://route-resumed.example.test', 'continue through route'],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('thread lifecycle rejects active runs and keeps sandbox when backup fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-lifecycle-fail-'));
  const sessionFile = path.join(root, 'sessions.json');
  const settingsFile = path.join(root, 'settings.json');
  const calls = [];
  const provider = {
    kind: 'cloudflare',
    info: () => ({ kind: 'cloudflare' }),
    suspendSession: async () => calls.push(['suspend']),
    resumeSession: async () => calls.push(['resume']),
    deleteSessionWithBackup: async () => {
      calls.push(['delete']);
      throw new Error('backup API unavailable');
    },
  };

  try {
    await writeFile(sessionFile, `${JSON.stringify([baseSession({ status: 'running', runStatus: 'running', bridgeClaimed: true })])}\n`);
    await writeFile(settingsFile, '{}\n');
    const service = createService({ sessionFile, settingsFile }, provider);

    await assert.rejects(() => service.suspendThreadSession('cloudflare-thread'), (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /Only idle/);
      return true;
    });
    assert.deepEqual(calls, []);

    await writeFile(sessionFile, `${JSON.stringify([baseSession()])}\n`);
    await assert.rejects(() => service.resumeThreadSession('cloudflare-thread'), (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /Only suspended/);
      return true;
    });
    assert.deepEqual(calls, []);

    await assert.rejects(() => service.deleteThreadSession('cloudflare-thread'), /backup API unavailable/);
    const stored = await getStoredSession(sessionFile, 'cloudflare-thread');
    assert.equal(stored.runStatus, 'ready');
    assert.equal(stored.cloudflareSandboxId, 'sandbox-1');
    assert.equal(stored.deletedAt, undefined);
    assert.equal(stored.warning, 'backup API unavailable');
    assert.deepEqual(calls, [['delete']]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('thread stop marks missing bridge runs stale locally', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-stop-missing-'));
  const sessionFile = path.join(root, 'sessions.json');
  const settingsFile = path.join(root, 'settings.json');
  const staleCalls = [];
  const provider = { kind: 'cloudflare', info: () => ({ kind: 'cloudflare' }) };
  const runState = createRunState({
    config: { sessionFile, settingsFile },
    provider,
    loadPiSdk: async () => ({}),
    loadPiAi: async () => ({}),
    canAccessSession: () => true,
  });
  const service = createThreadService({
    config: { sessionFile, settingsFile },
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
      fetchBridgeJson: async () => {
        const error = new Error('{"error":"Run not found."}');
        error.status = 404;
        throw error;
      },
      bridgeRunMissingError: (error) => Number(error?.status) === 404,
      markBridgeRunStale: async (name, session, warning, options) => {
        staleCalls.push([name, warning, options?.missing]);
        return upsertSession(sessionFile, {
          ...session,
          status: 'failed',
          runStatus: 'failed',
          bridgeClaimed: false,
          warning,
          staleAt: '2026-07-12T00:00:00.000Z',
        });
      },
    },
  });

  try {
    await writeFile(sessionFile, `${JSON.stringify([baseSession({
      bridgeToken: 'secret',
      bridgeRunId: 'run-1',
      bridgeClaimed: true,
      status: 'running',
      runStatus: 'running',
    })])}\n`);
    await writeFile(settingsFile, '{}\n');

    const stopped = await service.stopThreadSession('cloudflare-thread');

    assert.equal(stopped.runStatus, 'failed');
    assert.equal(stopped.bridgeClaimed, false);
    assert.match(stopped.warning, /disappeared/);
    assert.deepEqual(staleCalls, [['cloudflare-thread', 'Bridge run disappeared before it could be stopped.', true]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
