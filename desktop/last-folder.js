import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const LAST_FOLDER_FILE = 'desktop-state.json';

export function cleanFolder(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function statePath(userDataDir) {
  return path.join(userDataDir, LAST_FOLDER_FILE);
}

function readState(userDataDir) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(userDataDir), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readLastFolder(userDataDir) {
  return cleanFolder(readState(userDataDir).lastFolder);
}

export function writeLastFolder(userDataDir, folder) {
  const lastFolder = cleanFolder(folder);
  if (!lastFolder) return readLastFolder(userDataDir);
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(statePath(userDataDir), `${JSON.stringify({ ...readState(userDataDir), lastFolder }, null, 2)}\n`);
  return lastFolder;
}
