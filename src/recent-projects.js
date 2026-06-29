import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { d1StateRequested, readD1Kv, writeD1Kv } from './d1-state.js';

export const MAX_RECENT_PROJECTS = 8;

let writeQueue = Promise.resolve();

function cleanText(value, maxLength = 1000) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanProjectValue(value) {
  return cleanText(value).replace(/[\\/]+$/, '');
}

function looksLikeLocalPath(value) {
  return /^(~|\/|[A-Za-z]:[\\/]|\\\\)/.test(cleanText(value));
}

function normalizeRepoUrl(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (/^[\w.-]+\/[\w.-]+(?:\.git)?$/i.test(text)) return `https://github.com/${text.replace(/\.git$/i, '')}.git`;
  if (/^github\.com\//i.test(text)) return `https://${text.replace(/\.git$/i, '')}.git`;
  return text;
}

function projectLabel(value) {
  const text = cleanProjectValue(value)
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '');
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join('/') || text || 'workspace';
}

function normalizeProject(input = {}) {
  const rawValue = cleanProjectValue(input.value);
  if (!rawValue) return null;

  const local = input.kind === 'local' || looksLikeLocalPath(rawValue);
  const value = local ? rawValue : normalizeRepoUrl(rawValue);

  return {
    kind: local ? 'local' : 'git',
    value,
    label: cleanText(input.label, 160) || projectLabel(value),
    repoSource: local ? '' : cleanText(input.repoSource, 80),
    branch: local ? '' : cleanText(input.branch, 160),
  };
}

function projectKey(project) {
  const value = project.kind === 'git' ? project.value.replace(/\.git$/i, '').toLowerCase() : project.value;
  return `${project.kind}:${value}`;
}

async function writeProjects(filePath, projects) {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(projects, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

async function ensureProjectsFile(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      await writeProjects(filePath, []);
      return;
    }
    throw error;
  }
}

export async function listRecentProjects(filePath) {
  if (d1StateRequested()) {
    const rows = await readD1Kv('recent-projects', []);
    if (!Array.isArray(rows)) throw new Error('Recent projects store must be a JSON array.');
    return rows.map(normalizeProject).filter(Boolean).slice(0, MAX_RECENT_PROJECTS);
  }

  await ensureProjectsFile(filePath);
  const rows = JSON.parse((await readFile(filePath, 'utf8')).trim() || '[]');
  if (!Array.isArray(rows)) throw new Error('Recent projects store must be a JSON array.');
  return rows.map(normalizeProject).filter(Boolean).slice(0, MAX_RECENT_PROJECTS);
}

export async function saveRecentProject(filePath, input) {
  const project = normalizeProject(input);
  if (!project) throw new Error('Recent project value is required.');

  const operation = async () => {
    const projects = await listRecentProjects(filePath);
    const key = projectKey(project);
    const next = [project, ...projects.filter((entry) => projectKey(entry) !== key)].slice(0, MAX_RECENT_PROJECTS);
    if (d1StateRequested()) {
      await writeD1Kv('recent-projects', next);
    } else {
      await writeProjects(filePath, next);
    }
    return next;
  };

  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  return result;
}
