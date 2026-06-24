import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { listStoredSessions, removeStoredSession } from '../src/store.js';

test('listStoredSessions ignores stale mock sessions', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'micro-cloud-store-'));
  const filePath = path.join(tempDir, 'sessions.json');

  try {
    await writeFile(filePath, `${JSON.stringify([
      { name: 'old-mock', provider: 'mock', createdAt: '2026-06-16T19:00:00.000Z' },
      { name: 'real-ssh', provider: 'ssh', createdAt: '2026-06-16T20:00:00.000Z' },
      { name: 'legacy', createdAt: '2026-06-16T18:00:00.000Z' },
    ])}\n`);

    const sessions = await listStoredSessions(filePath);
    assert.deepEqual(sessions.map((session) => session.name), ['real-ssh', 'legacy']);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('removeStoredSession deletes a session row', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'micro-cloud-store-'));
  const filePath = path.join(tempDir, 'sessions.json');

  try {
    await writeFile(filePath, `${JSON.stringify([
      { name: 'keep', provider: 'ssh', createdAt: '2026-06-16T20:00:00.000Z' },
      { name: 'drop', provider: 'ssh', createdAt: '2026-06-16T19:00:00.000Z' },
    ])}\n`);

    assert.equal(await removeStoredSession(filePath, 'drop'), true);
    assert.equal(await removeStoredSession(filePath, 'missing'), false);
    assert.deepEqual((await listStoredSessions(filePath)).map((session) => session.name), ['keep']);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
