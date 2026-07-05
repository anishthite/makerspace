import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

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

test('thread artifact route serves local Excalidraw drawings only', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'workbench-excalidraw-'));
  const sessionFile = path.join(tempDir, 'sessions.json');
  const settingsFile = path.join(tempDir, 'settings.json');
  let server;

  try {
    await writeFile(path.join(tempDir, 'diagram.excalidraw'), `${JSON.stringify({ type: 'excalidraw', elements: [], appState: {}, files: {} })}\n`);
    await writeFile(path.join(tempDir, 'diagram.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'));
    await writeFile(path.join(tempDir, 'notes.txt'), 'not a drawing\n');
    await writeFile(sessionFile, `${JSON.stringify([
      {
        name: 'viewer',
        provider: 'local',
        threadBridge: true,
        localMode: true,
        repoPath: tempDir,
        status: 'ready',
        runStatus: 'ready',
        createdAt: '2026-06-27T00:00:00.000Z',
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
    const ok = await fetch(`${baseUrl}/api/threads/viewer/artifacts?path=diagram.excalidraw`, { headers });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).data.type, 'excalidraw');

    const image = await fetch(`${baseUrl}/api/threads/viewer/artifacts/file?path=diagram.png`, { headers });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.match(image.headers.get('content-security-policy') || '', /sandbox/);
    assert.ok((await image.arrayBuffer()).byteLength > 0);

    const save = await fetch(`${baseUrl}/api/threads/viewer/artifacts?path=diagram.excalidraw`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'excalidraw', elements: [{ id: 'saved', type: 'rectangle', isDeleted: false }], appState: { viewBackgroundColor: '#fff' }, files: {} }),
    });
    assert.equal(save.status, 200);
    assert.equal((await save.json()).saved, true);
    assert.equal(JSON.parse(await readFile(path.join(tempDir, 'diagram.excalidraw'), 'utf8')).elements[0].id, 'saved');

    const saveWrongExt = await fetch(`${baseUrl}/api/threads/viewer/artifacts?path=notes.txt`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'excalidraw', elements: [] }),
    });
    assert.equal(saveWrongExt.status, 400);

    const wrongExt = await fetch(`${baseUrl}/api/threads/viewer/artifacts?path=notes.txt`, { headers });
    assert.equal(wrongExt.status, 400);

    const wrongImageExt = await fetch(`${baseUrl}/api/threads/viewer/artifacts/file?path=notes.txt`, { headers });
    assert.equal(wrongImageExt.status, 400);

    const traversal = await fetch(`${baseUrl}/api/threads/viewer/artifacts?path=../diagram.excalidraw`, { headers });
    assert.equal(traversal.status, 400);

    const imageTraversal = await fetch(`${baseUrl}/api/threads/viewer/artifacts/file?path=../diagram.png`, { headers });
    assert.equal(imageTraversal.status, 400);
  } finally {
    if (server) await stopServer(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});
