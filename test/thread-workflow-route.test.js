import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { createRunState } from '../src/server/run-state.js';
import { createThreadService } from '../src/server/threads.js';

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 5000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/listening on (http:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`server exited before start: ${code ?? signal}\n${output}`));
    });
  });
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

function httpStub() {
  return {
    clientError(message, statusCode = 400) {
      const error = new Error(message);
      error.statusCode = statusCode;
      return error;
    },
  };
}

function createWorkflowService(config, provider) {
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
      githubTokenForUser: async () => '',
      readBrowserSession: () => null,
    },
    runState,
    bridge: {},
  });
}

test('thread workflow payload uses mirrored agent data before remote reads', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-workflow-mirror-'));
  const sessionFile = path.join(tempDir, 'sessions.json');
  const workflowRunsDir = path.join(tempDir, 'workflows', 'runs');
  const runId = 'run-cached-agents';
  let remoteReads = 0;

  try {
    await mkdir(workflowRunsDir, { recursive: true });
    await writeFile(path.join(workflowRunsDir, `${runId}.json`), `${JSON.stringify({
      runId,
      workflowName: 'cached workflow',
      status: 'running',
      agents: [{ id: 1, label: 'cached agent', phase: 'Review', status: 'running' }],
    })}\n`);
    await writeFile(sessionFile, `${JSON.stringify([{
      name: 'remote-thread',
      provider: 'cloudflare',
      threadBridge: true,
      bridgeMode: true,
      status: 'running',
      runStatus: 'running',
      createdAt: '2026-07-12T00:00:00.000Z',
    }])}\n`);

    const service = createWorkflowService(
      { sessionFile, workflowRunsDir, localDataDir: tempDir, remoteHomeDir: '/home/root' },
      {
        kind: 'cloudflare',
        info: () => ({ kind: 'cloudflare' }),
        readRemoteFile: async () => {
          remoteReads += 1;
          throw new Error('remote read should not block cached rail payloads');
        },
      },
    );
    const labels = [];
    const payload = await service.threadWorkflowPayload('remote-thread', runId, '', true, null, {
      traceStep: async (label, task) => {
        labels.push(label);
        return task();
      },
    });

    assert.equal(payload.workflowName, 'cached workflow');
    assert.equal(payload.agents[0].label, 'cached agent');
    assert.equal(remoteReads, 0);
    assert.ok(labels.includes('workflow.mirrorRead'));
    assert.equal(labels.includes('workflow.remoteRead'), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('thread workflow route returns Spanner Pi workflow journal steps', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-workflow-'));
  const sessionFile = path.join(tempDir, 'sessions.json');
  const settingsFile = path.join(tempDir, 'settings.json');
  const journalRunId = 'run-mqu123-journal';
  let server;

  try {
    await mkdir(path.join(tempDir, '.pi/better-workflows/runs'), { recursive: true });
    await writeFile(path.join(tempDir, '.pi/better-workflows/runs', `${journalRunId}.json`), `${JSON.stringify({
      runId: journalRunId,
      name: 'landing-variation-review-loop',
      status: 'running',
      startedAt: '2026-07-07T00:00:00.000Z',
      journal: [
        {
          index: 0,
          hash: 'abc123',
          result: { variations: [{ name: 'Trace First' }, { name: 'Diff Hero' }] },
          toolCalls: [{ name: 'find_files' }, { name: 'structured_output' }],
        },
        {
          index: 1,
          hash: 'def456',
          result: { approved: true, score: 8.5, summary: 'Good enough to show.' },
          toolCalls: [{ name: 'structured_output' }],
        },
      ],
    })}\n`);
    await writeFile(sessionFile, `${JSON.stringify([
      {
        name: 'viewer',
        provider: 'local',
        threadBridge: true,
        localMode: true,
        repoPath: tempDir,
        status: 'running',
        runStatus: 'running',
        createdAt: '2026-07-02T00:00:00.000Z',
      },
    ])}\n`);
    await writeFile(settingsFile, '{}\n');

    server = spawn(process.execPath, ['src/server.js'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        INFRA_PROVIDER: 'local',
        HOST: '127.0.0.1',
        PORT: '0',
        SESSION_DATA_PATH: sessionFile,
        SETTINGS_DATA_PATH: settingsFile,
        WARM_BRIDGE_POOL_SIZE: '0',
        IDLE_BRIDGE_TTL_MS: '0',
        CONTROL_API_TOKEN: 'test-token',
        HOME: tempDir,
        PI_CODING_AGENT_DIR: path.join(tempDir, 'not-used-for-workflows', 'agent'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const baseUrl = await waitForServer(server);
    const headers = { authorization: 'Bearer test-token' };
    const journalResponse = await fetch(`${baseUrl}/api/threads/viewer/workflows/${journalRunId}`, { headers });
    assert.equal(journalResponse.status, 200);
    const journalPayload = await journalResponse.json();
    assert.equal(journalPayload.workflowName, 'landing-variation-review-loop');
    assert.equal(journalPayload.source, 'journal');
    assert.deepEqual(journalPayload.phases, ['Generate', 'Review']);
    assert.equal(journalPayload.agents.length, 2);
    assert.equal(journalPayload.agents[0].label, 'generate variations');
    assert.equal(journalPayload.agents[0].toolPreview, 'find_files, structured_output');
    assert.equal(journalPayload.agents[0].resultPreview, '2 variations: Trace First, Diff Hero');
    assert.equal(journalPayload.agents[1].label, 'review alternatives');
    assert.equal(journalPayload.agents[1].resultPreview, 'Good enough to show.');

    const mirrored = JSON.parse(await readFile(path.join(tempDir, '.spanner/workflows/runs', `${journalRunId}.json`), 'utf8'));
    assert.equal(mirrored.runId, journalRunId);
    await rm(path.join(tempDir, '.pi/better-workflows/runs', `${journalRunId}.json`));
    const mirrorResponse = await fetch(`${baseUrl}/api/threads/viewer/workflows/${journalRunId}`, { headers });
    assert.equal(mirrorResponse.status, 200);
    assert.equal((await mirrorResponse.json()).workflowName, 'landing-variation-review-loop');

    const missing = await fetch(`${baseUrl}/api/threads/viewer/workflows/missing-run`, { headers });
    assert.equal(missing.status, 200);
    assert.equal((await missing.json()).available, false);

    const badId = await fetch(`${baseUrl}/api/threads/viewer/workflows/bad!`, { headers });
    assert.equal(badId.status, 400);
  } finally {
    if (server) await stopServer(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});
