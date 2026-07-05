import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

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

test('thread workflow route returns workflow agents for a local thread', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'workbench-workflow-'));
  const sessionFile = path.join(tempDir, 'sessions.json');
  const settingsFile = path.join(tempDir, 'settings.json');
  const runId = 'mqu123-abc456';
  let server;

  try {
    await mkdir(path.join(tempDir, '.pi/workflows/runs'), { recursive: true });
    await writeFile(path.join(tempDir, '.pi/workflows/runs', `${runId}.json`), `${JSON.stringify({
      runId,
      workflowName: 'html-rendering-idea-lab',
      status: 'running',
      phases: ['Ideate', 'Judge'],
      currentPhase: 'Ideate',
      agents: [
        { id: 0, label: 'layout scout', phase: 'Ideate', status: 'running', model: 'openai/gpt-5.5', tokens: 1234, prompt: 'Map the HTML rendering options.', resultPreview: 'Found three layout directions.' },
        { id: 1, label: 'visual judge', phase: 'Judge', status: 'queued' },
      ],
      updatedAt: '2026-07-02T00:00:00.000Z',
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
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const baseUrl = await waitForServer(server);
    const headers = { authorization: 'Bearer test-token' };
    const ok = await fetch(`${baseUrl}/api/threads/viewer/workflows/${runId}`, { headers });
    assert.equal(ok.status, 200);
    const payload = await ok.json();
    assert.equal(payload.workflowName, 'html-rendering-idea-lab');
    assert.equal(payload.agents.length, 2);
    assert.equal(payload.agents[0].label, 'layout scout');
    assert.equal(payload.agents[0].tokens, 1234);
    assert.equal(payload.agents[0].promptPreview, 'Map the HTML rendering options.');
    assert.equal(payload.agents[0].resultPreview, 'Found three layout directions.');

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
