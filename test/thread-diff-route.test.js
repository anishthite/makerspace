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

test('thread changes route returns tracked tool changes', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-changes-'));
  const sessionFile = path.join(tempDir, 'sessions.json');
  const settingsFile = path.join(tempDir, 'settings.json');
  let server;

  try {
    await writeFile(sessionFile, `${JSON.stringify([
      {
        name: 'diffing',
        provider: 'local',
        threadBridge: true,
        localMode: true,
        repoPath: tempDir,
        status: 'ready',
        runStatus: 'ready',
        createdAt: '2026-06-25T00:00:00.000Z',
        trackedChanges: [{ path: 'app.txt', code: 'M', label: 'edited', diff: 'edited app.txt\n\n+after' }],
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
    const response = await fetch(`${baseUrl}/api/threads/diffing/diff`, { headers: { authorization: 'Bearer test-token' } });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.source, 'tracked-tools');
    assert.equal(payload.notGit, false);
    assert.equal(payload.diff, '');
    assert.deepEqual(payload.files.map((file) => file.path), ['app.txt']);
    assert.match(payload.files[0].diff, /\+after/);
    assert.match(payload.status, /M app\.txt/);
  } finally {
    if (server) await stopServer(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});
