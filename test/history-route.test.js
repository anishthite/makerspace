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

test('trusted history includes sessions from previous browser session ids', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-history-'));
  const sessionFile = path.join(tempDir, 'sessions.json');
  const settingsFile = path.join(tempDir, 'settings.json');
  let server;

  try {
    await writeFile(sessionFile, `${JSON.stringify([
      {
        name: 'old-private-thread',
        provider: 'local',
        threadBridge: true,
        localMode: true,
        repoPath: tempDir,
        initialPrompt: 'Continue the old work',
        status: 'ready',
        runStatus: 'ready',
        createdAt: '2026-06-24T20:00:00.000Z',
        githubOwnerSessionId: 'previous-browser-session',
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

    const historyResponse = await fetch(`${baseUrl}/api/sessions`, { headers });
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.deepEqual(history.sessions.map((session) => session.name), ['old-private-thread']);
    assert.equal(history.sessions[0].githubOwnerSessionId, undefined);

    const threadResponse = await fetch(`${baseUrl}/api/threads/old-private-thread`, { headers });
    assert.equal(threadResponse.status, 200);
    assert.equal((await threadResponse.json()).thread.name, 'old-private-thread');

    const outputResponse = await fetch(`${baseUrl}/api/sessions/old-private-thread/output`, { headers });
    assert.equal(outputResponse.status, 200);
    assert.equal((await outputResponse.json()).session.name, 'old-private-thread');
  } finally {
    if (server) await stopServer(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});
