import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

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
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
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

test('startup bootstrap returns project data in one request', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-bootstrap-'));
  const sessionFile = path.join(tempDir, 'sessions.json');
  const settingsFile = path.join(tempDir, 'settings.json');
  const recentProjectsFile = path.join(tempDir, 'recent-projects.json');
  let server;

  try {
    await writeFile(sessionFile, `${JSON.stringify([
      { name: 'agent-one', provider: 'local', threadBridge: true, localMode: true, repoPath: tempDir, status: 'completed', runStatus: 'completed', createdAt: '2026-07-11T00:00:00.000Z', updatedAt: '2026-07-11T00:00:01.000Z' },
    ])}\n`);
    await writeFile(settingsFile, '{}\n');
    await writeFile(recentProjectsFile, `${JSON.stringify([{ kind: 'local', value: tempDir, label: 'bootstrap repo' }])}\n`);

    server = spawn(process.execPath, ['src/server.js'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        INFRA_PROVIDER: 'local',
        HOST: '127.0.0.1',
        PORT: '0',
        SESSION_DATA_PATH: sessionFile,
        SETTINGS_DATA_PATH: settingsFile,
        RECENT_PROJECTS_DATA_PATH: recentProjectsFile,
        CONTROL_API_TOKEN: 'test-token',
        SPANNER_AUTH_REQUIRED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const baseUrl = await waitForServer(server);
    const response = await fetch(`${baseUrl}/api/bootstrap?page=project`, { headers: { authorization: 'Bearer test-token', 'x-spanner-session': 'browser-session-1234567890' } });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.provider.kind, 'local');
    assert.equal(payload.threads[0].name, 'agent-one');
    assert.equal(payload.recentProjects[0].label, 'bootstrap repo');
    assert.equal(payload.github.connected, false);
    assert.equal(payload.codex.disabled, 'sign-in-required');
    assert.equal(payload.defaults.model, 'Pi default model');
  } finally {
    if (server) await stopServer(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});
