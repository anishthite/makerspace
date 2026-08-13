import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

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

test('thread list does not count stale local runs as live after restart', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-stale-local-'));
  const sessionFile = path.join(tempDir, 'sessions.json');
  const settingsFile = path.join(tempDir, 'settings.json');
  const createdAt = '2026-06-25T01:00:00.000Z';
  const updatedAt = '2026-06-25T01:01:00.000Z';
  let server;

  try {
    await writeFile(sessionFile, `${JSON.stringify([
      { name: 'stale-local', provider: 'local', threadBridge: true, localMode: true, status: 'running', runStatus: 'running', createdAt, updatedAt },
      { name: 'stale-completed', provider: 'local', threadBridge: true, localMode: true, status: 'running', runStatus: 'running', createdAt, updatedAt, completedAt: updatedAt },
      { name: 'unknown-completed', provider: 'local', threadBridge: true, localMode: true, status: 'completed', runStatus: 'unknown', createdAt, updatedAt, completedAt: updatedAt },
      { name: 'remote-active', provider: 'cloudflare', threadBridge: true, bridgeMode: true, status: 'running', runStatus: 'running', createdAt, updatedAt },
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

    const response = await fetch(`${baseUrl}/api/threads`, { headers: { authorization: 'Bearer test-token' } });
    assert.equal(response.status, 200);
    const threads = Object.fromEntries((await response.json()).threads.map((thread) => [thread.name, thread]));

    assert.equal(threads['stale-local'].runStatus, 'failed');
    assert.equal(threads['stale-local'].endedAt, updatedAt);
    assert.equal(threads['stale-completed'].runStatus, 'completed');
    assert.equal(threads['stale-completed'].completedAt, updatedAt);
    assert.equal(threads['unknown-completed'].runStatus, 'completed');
    assert.equal(threads['unknown-completed'].completedAt, updatedAt);
    assert.equal(threads['remote-active'].runStatus, 'failed');
  } finally {
    if (server) await stopServer(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('message route restarts stale and failed local threads', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-local-restart-'));
  const sessionFile = path.join(tempDir, 'sessions.json');
  const settingsFile = path.join(tempDir, 'settings.json');
  const createdAt = '2026-06-25T02:00:00.000Z';
  const updatedAt = '2026-06-25T02:01:00.000Z';
  let server;

  try {
    await writeFile(sessionFile, `${JSON.stringify([
      { name: 'stale-local', provider: 'local', threadBridge: true, localMode: true, repoPath: tempDir, status: 'running', runStatus: 'running', taskPrompt: 'old prompt', submittedAtMs: 1, createdAt, updatedAt },
      { name: 'failed-local', provider: 'local', threadBridge: true, localMode: true, repoPath: tempDir, status: 'failed', runStatus: 'failed', taskPrompt: 'old prompt', submittedAtMs: 1, createdAt, updatedAt, endedAt: updatedAt },
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
        PI_SDK_PACKAGE_DIR: path.join(tempDir, 'missing-pi'),
        WARM_BRIDGE_POOL_SIZE: '0',
        IDLE_BRIDGE_TTL_MS: '0',
        CONTROL_API_TOKEN: 'test-token',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const baseUrl = await waitForServer(server);
    const headers = { authorization: 'Bearer test-token', 'content-type': 'application/json' };

    for (const [threadName, submittedAtMs] of [['stale-local', 123], ['failed-local', 456]]) {
      const response = await fetch(`${baseUrl}/api/threads/${threadName}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: `restart ${threadName}`, submittedAtMs }),
      });
      const payload = await response.json();
      assert.equal(response.status, 202, payload.error);
      assert.equal(payload.thread.runStatus, 'starting');
      assert.equal(payload.thread.taskPrompt, `restart ${threadName}`);
      assert.equal(payload.thread.submittedAtMs, submittedAtMs);
    }
  } finally {
    if (server) await stopServer(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('stop route marks a launching bridge thread failed', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-stop-thread-'));
  const sessionFile = path.join(tempDir, 'sessions.json');
  const settingsFile = path.join(tempDir, 'settings.json');
  const createdAt = '2026-06-25T03:00:00.000Z';
  let server;

  try {
    await writeFile(sessionFile, `${JSON.stringify([
      { name: 'launching', provider: 'cloudflare', threadBridge: true, bridgeMode: true, bridgeClaimed: true, taskPrompt: 'keep going', status: 'launching', runStatus: 'launching', createdAt },
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

    const response = await fetch(`${baseUrl}/api/threads/launching/stop`, { method: 'POST', headers: { authorization: 'Bearer test-token' } });
    const payload = await response.json();
    assert.equal(response.status, 200, payload.error);
    assert.equal(payload.thread.runStatus, 'failed');
    assert.equal(payload.thread.warning, 'Stopped by user.');
    assert.equal(payload.thread.taskPrompt, '');
    assert.equal(payload.thread.bridgeClaimed, false);

    const sessions = JSON.parse(await readFile(sessionFile, 'utf8'));
    assert.equal(sessions[0].runStatus, 'failed');
    assert.equal(sessions[0].warning, 'Stopped by user.');
  } finally {
    if (server) await stopServer(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('archive route accepts finished and stale inactive threads', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-archive-'));
  const sessionFile = path.join(tempDir, 'sessions.json');
  const settingsFile = path.join(tempDir, 'settings.json');
  const createdAt = '2026-06-24T20:00:00.000Z';
  let server;

  try {
    await writeFile(sessionFile, `${JSON.stringify([
      { name: 'done', provider: 'local', threadBridge: true, status: 'ready', runStatus: 'ready', createdAt },
      { name: 'failed', provider: 'local', threadBridge: true, status: 'failed', runStatus: 'failed', createdAt },
      { name: 'unknown-done', provider: 'local', threadBridge: true, status: 'completed', runStatus: 'unknown', createdAt, completedAt: createdAt },
      { name: 'busy', provider: 'local', threadBridge: true, status: 'running', runStatus: 'running', createdAt },
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

    const authHeaders = { authorization: 'Bearer test-token' };
    const doneResponse = await fetch(`${baseUrl}/api/threads/done/archive`, { method: 'POST', headers: authHeaders });
    assert.equal(doneResponse.status, 200);
    assert.ok((await doneResponse.json()).thread.archivedAt);

    const failedResponse = await fetch(`${baseUrl}/api/threads/failed/archive`, { method: 'POST', headers: authHeaders });
    assert.equal(failedResponse.status, 200);
    assert.ok((await failedResponse.json()).thread.archivedAt);

    const unknownDoneResponse = await fetch(`${baseUrl}/api/threads/unknown-done/archive`, { method: 'POST', headers: authHeaders });
    assert.equal(unknownDoneResponse.status, 200);
    assert.ok((await unknownDoneResponse.json()).thread.archivedAt);

    const busyResponse = await fetch(`${baseUrl}/api/threads/busy/archive`, { method: 'POST', headers: authHeaders });
    assert.equal(busyResponse.status, 200);
    assert.ok((await busyResponse.json()).thread.archivedAt);

    const hiddenResponse = await fetch(`${baseUrl}/api/threads`, { headers: authHeaders });
    assert.equal(hiddenResponse.status, 200);
    assert.deepEqual((await hiddenResponse.json()).threads.map((thread) => thread.name), []);

    const restoreResponse = await fetch(`${baseUrl}/api/threads/done/unarchive`, { method: 'POST', headers: authHeaders });
    assert.equal(restoreResponse.status, 200);
    assert.equal((await restoreResponse.json()).thread.archivedAt, undefined);

    const visibleResponse = await fetch(`${baseUrl}/api/threads`, { headers: authHeaders });
    assert.equal(visibleResponse.status, 200);
    assert.ok((await visibleResponse.json()).threads.some((thread) => thread.name === 'done'));

    const sessions = JSON.parse(await readFile(sessionFile, 'utf8'));
    assert.equal(sessions.find((session) => session.name === 'done').archivedAt, undefined);
    assert.ok(sessions.find((session) => session.name === 'failed').archivedAt);
    assert.ok(sessions.find((session) => session.name === 'unknown-done').archivedAt);
    assert.ok(sessions.find((session) => session.name === 'busy').archivedAt);
  } finally {
    if (server) await stopServer(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('archive closes Spanner-created local worktrees and unarchive restores them', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-archive-worktree-'));
  const sessionFile = path.join(tempDir, 'sessions.json');
  const settingsFile = path.join(tempDir, 'settings.json');
  const repoPath = path.join(tempDir, 'repo');
  const worktreePath = path.join(tempDir, 'worktrees', 'done-worktree');
  const branch = 'spanner/done-worktree';
  const createdAt = '2026-08-13T01:00:00.000Z';
  let server;

  async function git(cwd, args) {
    return execFileAsync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  }

  try {
    await mkdir(repoPath, { recursive: true });
    await git(repoPath, ['init', '-q', '-b', 'main']);
    await git(repoPath, ['config', 'user.email', 'spanner@example.test']);
    await git(repoPath, ['config', 'user.name', 'Spanner Test']);
    await writeFile(path.join(repoPath, 'tracked.txt'), 'base\n');
    await git(repoPath, ['add', 'tracked.txt']);
    await git(repoPath, ['commit', '-qm', 'base']);
    await git(repoPath, ['worktree', 'add', '-b', branch, worktreePath, 'main']);

    await writeFile(sessionFile, `${JSON.stringify([
      {
        name: 'done-worktree',
        provider: 'local',
        threadBridge: true,
        localMode: true,
        localWorktree: true,
        repoPath: worktreePath,
        sourceRepoPath: repoPath,
        worktreePath,
        worktreeBranch: branch,
        status: 'completed',
        runStatus: 'completed',
        createdAt,
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
    const authHeaders = { authorization: 'Bearer test-token' };

    const archiveResponse = await fetch(`${baseUrl}/api/threads/done-worktree/archive`, { method: 'POST', headers: authHeaders });
    const archived = await archiveResponse.json();
    assert.equal(archiveResponse.status, 200, archived.error);
    assert.ok(archived.thread.archivedAt);
    assert.ok(archived.thread.worktreeClosedAt);
    assert.equal(await exists(path.join(worktreePath, '.git')), false);

    const unarchiveResponse = await fetch(`${baseUrl}/api/threads/done-worktree/unarchive`, { method: 'POST', headers: authHeaders });
    const unarchived = await unarchiveResponse.json();
    assert.equal(unarchiveResponse.status, 200, unarchived.error);
    assert.equal(unarchived.thread.archivedAt, undefined);
    assert.equal(unarchived.thread.worktreeClosedAt, null);
    assert.ok(unarchived.thread.worktreeRestoredAt);
    assert.equal(await exists(path.join(worktreePath, '.git')), true);
  } finally {
    if (server) await stopServer(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});
