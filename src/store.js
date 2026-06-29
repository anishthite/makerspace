import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { d1StateRequested, getD1Session, listD1Sessions, removeD1Session, upsertD1Session } from './d1-state.js';

let storeWriteQueue = Promise.resolve();
const storeCache = new Map();

function corruptStorePath(filePath) {
  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  return `${filePath}.corrupt-${suffix}`;
}

function invalidateStoreCache(filePath) {
  storeCache.delete(filePath);
}

async function writeStore(filePath, sessions) {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(sessions)}\n`, 'utf8');
  await rename(tempPath, filePath);
  invalidateStoreCache(filePath);
}

async function repairCorruptStore(filePath, error) {
  const backupPath = corruptStorePath(filePath);

  try {
    await rename(filePath, backupPath);
  } catch (renameError) {
    if (renameError.code !== 'ENOENT') throw renameError;
  }

  await writeStore(filePath, []);
  console.warn(`[store] Reset corrupt session store ${filePath}; backup: ${backupPath}; ${error.message}`);
  return [];
}

function parseSessions(text) {
  const sessions = JSON.parse(text.trim() || '[]');
  if (!Array.isArray(sessions)) throw new Error('Session store must be a JSON array.');
  return sessions.filter((session) => session && typeof session === 'object' && session.provider !== 'mock');
}

async function ensureStore(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      await writeStore(filePath, []);
      invalidateStoreCache(filePath);
      return;
    }

    throw error;
  }
}

export async function listStoredSessions(filePath) {
  if (d1StateRequested()) {
    const sessions = await listD1Sessions();
    return [...sessions].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  await ensureStore(filePath);
  const stats = await stat(filePath);
  const cached = storeCache.get(filePath);
  if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
    return [...cached.sessions].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  const text = await readFile(filePath, 'utf8');
  let sessions;

  try {
    sessions = parseSessions(text);
  } catch (error) {
    sessions = await repairCorruptStore(filePath, error);
  }

  const nextStats = await stat(filePath);
  storeCache.set(filePath, { size: nextStats.size, mtimeMs: nextStats.mtimeMs, sessions });
  return [...sessions].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export async function getStoredSession(filePath, name) {
  if (d1StateRequested()) return getD1Session(name);

  const sessions = await listStoredSessions(filePath);
  return sessions.find((session) => session.name === name) || null;
}

export async function upsertSession(filePath, nextSession) {
  if (d1StateRequested()) {
    const existing = await getD1Session(nextSession.name);
    return upsertD1Session(existing ? { ...existing, ...nextSession } : nextSession);
  }

  const operation = async () => {
    const sessions = await listStoredSessions(filePath);
    const index = sessions.findIndex((session) => session.name === nextSession.name);

    if (index === -1) {
      sessions.push(nextSession);
    } else {
      sessions[index] = { ...sessions[index], ...nextSession };
    }

    sessions.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    await writeStore(filePath, sessions);
    return sessions.find((session) => session.name === nextSession.name) || nextSession;
  };

  const result = storeWriteQueue.then(operation, operation);
  storeWriteQueue = result.catch(() => {});
  return result;
}

export async function archiveStoredSession(filePath, name, archivedAt = new Date().toISOString()) {
  if (d1StateRequested()) {
    const session = await getD1Session(name);
    if (!session) return null;
    const next = { ...session, archivedAt, updatedAt: archivedAt };
    await upsertD1Session(next);
    return next;
  }

  const operation = async () => {
    const sessions = await listStoredSessions(filePath);
    const index = sessions.findIndex((session) => session.name === name);
    if (index === -1) return null;

    sessions[index] = { ...sessions[index], archivedAt, updatedAt: archivedAt };
    await writeStore(filePath, sessions);
    return sessions[index];
  };

  const result = storeWriteQueue.then(operation, operation);
  storeWriteQueue = result.catch(() => {});
  return result;
}

export async function unarchiveStoredSession(filePath, name, updatedAt = new Date().toISOString()) {
  if (d1StateRequested()) {
    const session = await getD1Session(name);
    if (!session) return null;
    const { archivedAt, ...rest } = session;
    const next = { ...rest, updatedAt };
    await upsertD1Session(next);
    return next;
  }

  const operation = async () => {
    const sessions = await listStoredSessions(filePath);
    const index = sessions.findIndex((session) => session.name === name);
    if (index === -1) return null;

    const { archivedAt, ...session } = sessions[index];
    sessions[index] = { ...session, updatedAt };
    await writeStore(filePath, sessions);
    return sessions[index];
  };

  const result = storeWriteQueue.then(operation, operation);
  storeWriteQueue = result.catch(() => {});
  return result;
}

export async function removeStoredSession(filePath, name) {
  if (d1StateRequested()) return removeD1Session(name);

  const operation = async () => {
    const sessions = await listStoredSessions(filePath);
    const nextSessions = sessions.filter((session) => session.name !== name);
    await writeStore(filePath, nextSessions);
    return sessions.length !== nextSessions.length;
  };

  const result = storeWriteQueue.then(operation, operation);
  storeWriteQueue = result.catch(() => {});
  return result;
}
