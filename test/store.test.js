import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';

import { archiveStoredSession, listStoredSessions, removeStoredSession, unarchiveStoredSession, upsertSession } from '../src/store.js';

test('listStoredSessions ignores stale mock sessions', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-store-'));
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

test('archiveStoredSession marks a session archived without deleting it', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-store-'));
  const filePath = path.join(tempDir, 'sessions.json');

  try {
    await writeFile(filePath, `${JSON.stringify([
      { name: 'done', provider: 'ssh', createdAt: '2026-06-16T20:00:00.000Z' },
    ])}\n`);

    const archived = await archiveStoredSession(filePath, 'done', '2026-06-24T20:00:00.000Z');
    assert.equal(archived.archivedAt, '2026-06-24T20:00:00.000Z');
    assert.equal(archived.updatedAt, '2026-06-24T20:00:00.000Z');
    assert.equal(await archiveStoredSession(filePath, 'missing'), null);
    assert.deepEqual((await listStoredSessions(filePath)).map((session) => session.name), ['done']);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('unarchiveStoredSession clears archivedAt without deleting the row', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-store-'));
  const filePath = path.join(tempDir, 'sessions.json');

  try {
    await writeFile(filePath, `${JSON.stringify([
      { name: 'done', provider: 'ssh', createdAt: '2026-06-16T20:00:00.000Z', archivedAt: '2026-06-24T20:00:00.000Z' },
    ])}\n`);

    const restored = await unarchiveStoredSession(filePath, 'done', '2026-06-26T10:00:00.000Z');
    assert.equal(restored.archivedAt, undefined);
    assert.equal(restored.updatedAt, '2026-06-26T10:00:00.000Z');
    assert.equal(await unarchiveStoredSession(filePath, 'missing'), null);
    assert.deepEqual((await listStoredSessions(filePath)).map((session) => session.name), ['done']);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('listStoredSessions backs up corrupt JSON and starts fresh', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-store-'));
  const filePath = path.join(tempDir, 'sessions.json');
  const corruptText = '[{ "name": "partial", "titleMode';

  try {
    await writeFile(filePath, corruptText);

    assert.deepEqual(await listStoredSessions(filePath), []);
    assert.equal(await readFile(filePath, 'utf8'), '[]\n');

    const backups = (await readdir(tempDir)).filter((name) => name.startsWith('sessions.json.corrupt-'));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(tempDir, backups[0]), 'utf8'), corruptText);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('upsertSession writes compact parseable JSON through a temp file', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-store-'));
  const filePath = path.join(tempDir, 'sessions.json');

  try {
    const saved = await upsertSession(filePath, { name: 'saved', provider: 'local', createdAt: '2026-06-25T20:00:00.000Z' });
    assert.equal(saved.name, 'saved');
    const text = await readFile(filePath, 'utf8');
    assert.equal(text, '[{"name":"saved","provider":"local","createdAt":"2026-06-25T20:00:00.000Z"}]\n');
    assert.deepEqual(JSON.parse(text).map((session) => session.name), ['saved']);
    assert.deepEqual((await readdir(tempDir)).filter((name) => name.endsWith('.tmp')), []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('listStoredSessions refreshes when file stat changes', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-store-'));
  const filePath = path.join(tempDir, 'sessions.json');

  try {
    await writeFile(filePath, '[{"name":"one","createdAt":"2026-06-25T20:00:00.000Z"}]\n');
    assert.deepEqual((await listStoredSessions(filePath)).map((session) => session.name), ['one']);

    await writeFile(filePath, '[{"name":"two","createdAt":"2026-06-25T21:00:00.000Z"},{"name":"one","createdAt":"2026-06-25T20:00:00.000Z"}]\n');
    assert.deepEqual((await listStoredSessions(filePath)).map((session) => session.name), ['two', 'one']);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('removeStoredSession deletes a session row', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'spanner-store-'));
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
