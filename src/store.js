import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

let storeWriteQueue = Promise.resolve();

async function ensureStore(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      await writeFile(filePath, '[]\n', 'utf8');
      return;
    }

    throw error;
  }
}

export async function listStoredSessions(filePath) {
  await ensureStore(filePath);
  const text = await readFile(filePath, 'utf8');
  const sessions = JSON.parse(text || '[]').filter((session) => session.provider !== 'mock');
  return sessions.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export async function getStoredSession(filePath, name) {
  const sessions = await listStoredSessions(filePath);
  return sessions.find((session) => session.name === name) || null;
}

export async function upsertSession(filePath, nextSession) {
  const operation = async () => {
    const sessions = await listStoredSessions(filePath);
    const index = sessions.findIndex((session) => session.name === nextSession.name);

    if (index === -1) {
      sessions.push(nextSession);
    } else {
      sessions[index] = { ...sessions[index], ...nextSession };
    }

    sessions.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    await writeFile(filePath, `${JSON.stringify(sessions, null, 2)}\n`, 'utf8');
    return sessions.find((session) => session.name === nextSession.name) || nextSession;
  };

  const result = storeWriteQueue.then(operation, operation);
  storeWriteQueue = result.catch(() => {});
  return result;
}

export async function removeStoredSession(filePath, name) {
  const operation = async () => {
    const sessions = await listStoredSessions(filePath);
    const nextSessions = sessions.filter((session) => session.name !== name);
    await writeFile(filePath, `${JSON.stringify(nextSessions, null, 2)}\n`, 'utf8');
    return sessions.length !== nextSessions.length;
  };

  const result = storeWriteQueue.then(operation, operation);
  storeWriteQueue = result.catch(() => {});
  return result;
}
