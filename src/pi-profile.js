import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { createAuthStore } from './auth-store.js';
import { d1StateRequested, readD1Kv, writeD1Kv } from './d1-state.js';

const TEXT_EXTENSIONS = new Set(['.cjs', '.css', '.html', '.js', '.json', '.jsonc', '.md', '.mjs', '.sh', '.ts', '.txt', '.yaml', '.yml']);
const MAX_SYNC_FILE_BYTES = 200_000;
const MAX_SYNC_TOTAL_BYTES = 2_000_000;
const MAX_SYNC_FILES = 300;

function defaultAgentDir(config = {}) {
  return config.piDefaultsPackageDir || path.join(config.rootDir || process.cwd(), 'packages', 'makerspace-pi-defaults');
}

function agentsPathFor(agentDir, config = {}) {
  return config.agentDir ? path.join(agentDir, 'AGENTS.md') : path.join(agentDir, 'context', 'AGENTS.md');
}

function defaultProfileFile(config = {}) {
  return config.piProfileFile || path.join(config.localDataDir || path.join(config.rootDir || process.cwd(), 'data'), 'pi-profile.json');
}

function normalizeState(input = {}) {
  const enabled = input.enabled && typeof input.enabled === 'object' ? input.enabled : {};
  return {
    syncToRemote: input.syncToRemote !== false,
    enabled: {
      skills: Array.isArray(enabled.skills) ? enabled.skills.map(String) : null,
      extensions: Array.isArray(enabled.extensions) ? enabled.extensions.map(String) : null,
      prompts: Array.isArray(enabled.prompts) ? enabled.prompts.map(String) : null,
    },
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseFrontmatter(text) {
  const match = String(text || '').match(/^---\n([\s\S]*?)\n---\n?/);
  const data = {};
  if (!match) return data;
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) data[key] = value;
  }
  return data;
}

async function readText(filePath, fallback = '') {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function isEnabled(state, type, id) {
  const list = state.enabled[type];
  return !Array.isArray(list) || list.includes(id);
}

function byNameThenPath(a, b) {
  return a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
}

async function discoverSkillRoots(root) {
  const found = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
      found.push(path.join(dir, 'SKILL.md'));
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await walk(path.join(dir, entry.name));
    }
  }
  await walk(root);
  return found;
}

async function discoverSkills(agentDir, state, config = {}) {
  const roots = [path.join(agentDir, 'skills')];
  const unique = new Set();
  const skills = [];

  for (const root of roots) {
    for (const skillPath of await discoverSkillRoots(root)) {
      const id = path.resolve(skillPath);
      if (unique.has(id)) continue;
      unique.add(id);
      const text = await readText(skillPath);
      const frontmatter = parseFrontmatter(text);
      const baseDir = path.dirname(skillPath);
      const name = String(frontmatter.name || path.basename(baseDir));
      skills.push({
        id,
        type: 'skills',
        name,
        description: String(frontmatter.description || ''),
        path: id,
        baseDir: path.resolve(baseDir),
        enabled: isEnabled(state, 'skills', id),
      });
    }
  }

  return skills.sort(byNameThenPath);
}

async function discoverExtensions(agentDir, state) {
  const root = path.join(agentDir, 'extensions');
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const extensions = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && ['.ts', '.js'].includes(path.extname(entry.name))) {
      const id = path.resolve(fullPath);
      extensions.push({ id, type: 'extensions', name: path.basename(entry.name, path.extname(entry.name)), path: id, baseDir: root, enabled: isEnabled(state, 'extensions', id) });
      continue;
    }
    if (!entry.isDirectory()) continue;
    for (const candidate of ['index.ts', 'index.js']) {
      const filePath = path.join(fullPath, candidate);
      if (await exists(filePath)) {
        const id = path.resolve(filePath);
        extensions.push({ id, type: 'extensions', name: entry.name, path: id, baseDir: path.resolve(fullPath), enabled: isEnabled(state, 'extensions', id) });
        break;
      }
    }
  }
  return extensions.sort(byNameThenPath);
}

async function discoverPrompts(agentDir, state) {
  const root = path.join(agentDir, 'prompts');
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const prompts = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = path.join(root, entry.name);
    const id = path.resolve(filePath);
    const text = await readText(filePath);
    const frontmatter = parseFrontmatter(text);
    prompts.push({
      id,
      type: 'prompts',
      name: path.basename(entry.name, '.md'),
      description: String(frontmatter.description || ''),
      path: id,
      baseDir: root,
      enabled: isEnabled(state, 'prompts', id),
    });
  }
  return prompts.sort(byNameThenPath);
}

async function readProfileState(config = {}, user = null) {
  if (user?.id) return createAuthStore(config).readUserKv(user.id, 'pi-profile-state', {});
  return d1StateRequested() ? readD1Kv('pi-profile-state', {}) : readJson(defaultProfileFile(config));
}

async function readProfileAgentsText(config = {}, user = null, fallback = '') {
  if (user?.id) return String(await createAuthStore(config).readUserKv(user.id, 'pi-profile-agents-text', fallback));
  return d1StateRequested() ? readD1Kv('pi-profile-agents-text', fallback).then(String) : fallback;
}

export async function readPiProfile(config = {}, user = null) {
  const agentDir = path.resolve(config.agentDir || defaultAgentDir(config));
  const rawState = await readProfileState(config, user);
  const state = normalizeState(rawState);
  const agentsPath = agentsPathFor(agentDir, config);
  const diskAgentsText = await readText(agentsPath);
  const [agentsText, skills, extensions, prompts] = await Promise.all([
    readProfileAgentsText(config, user, diskAgentsText),
    discoverSkills(agentDir, state, config),
    discoverExtensions(agentDir, state),
    discoverPrompts(agentDir, state),
  ]);

  return {
    agentDir,
    agentsPath: user?.id ? `db:user:${user.id}:AGENTS.md` : agentsPath,
    agentsText,
    syncToRemote: state.syncToRemote,
    resources: { skills, extensions, prompts },
  };
}

function selectedIds(resources = []) {
  return resources.filter((resource) => resource.enabled !== false).map((resource) => resource.id);
}

export async function savePiProfile(config = {}, input = {}, user = null) {
  const agentDir = path.resolve(config.agentDir || defaultAgentDir(config));
  const agentsPath = agentsPathFor(agentDir, config);

  const state = normalizeState({
    syncToRemote: input.syncToRemote !== false,
    enabled: {
      skills: Array.isArray(input.enabledSkills) ? input.enabledSkills : null,
      extensions: Array.isArray(input.enabledExtensions) ? input.enabledExtensions : null,
      prompts: Array.isArray(input.enabledPrompts) ? input.enabledPrompts : null,
    },
  });

  if (user?.id) {
    const store = createAuthStore(config);
    await store.writeUserKv(user.id, 'pi-profile-state', state);
    if (typeof input.agentsText === 'string') await store.writeUserKv(user.id, 'pi-profile-agents-text', input.agentsText);
    return readPiProfile(config, user);
  }

  if (typeof input.agentsText === 'string') {
    await mkdir(path.dirname(agentsPath), { recursive: true });
    await writeFile(agentsPath, input.agentsText, 'utf8');
  }

  if (d1StateRequested()) {
    await writeD1Kv('pi-profile-state', state);
    if (typeof input.agentsText === 'string') await writeD1Kv('pi-profile-agents-text', input.agentsText);
  } else {
    await writeJson(defaultProfileFile(config), state);
  }

  return readPiProfile(config);
}

function profileResourceIds(profile, type) {
  return new Set((profile?.resources?.[type] || []).map((resource) => path.resolve(resource.id)));
}

function profileEnabledIds(profile, type) {
  return new Set(selectedIds(profile?.resources?.[type] || []).map((id) => path.resolve(id)));
}

function keepProfileResource(profile, type, itemPath) {
  if (!profile || !itemPath) return true;
  const id = path.resolve(itemPath);
  const known = profileResourceIds(profile, type);
  if (!known.has(id)) return true;
  return profileEnabledIds(profile, type).has(id);
}

export function piProfileResourceOverrides(profile) {
  return {
    skillsOverride(current) {
      return {
        ...current,
        skills: current.skills.filter((skill) => keepProfileResource(profile, 'skills', skill.filePath)),
      };
    },
    promptsOverride(current) {
      return {
        ...current,
        prompts: current.prompts.filter((prompt) => keepProfileResource(profile, 'prompts', prompt.filePath)),
      };
    },
    extensionsOverride(current) {
      return {
        ...current,
        extensions: current.extensions.filter((extension) => keepProfileResource(profile, 'extensions', extension.path)),
      };
    },
  };
}

function safeSegment(value) {
  return String(value || 'resource').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'resource';
}

function shouldSkipFile(filePath, dirent) {
  if (dirent.name === 'node_modules' || dirent.name === '.git') return true;
  if (dirent.isDirectory()) return false;
  const ext = path.extname(filePath).toLowerCase();
  return ext && !TEXT_EXTENSIONS.has(ext);
}

async function addTextFile(files, relativePath, filePath, budget) {
  const buffer = await readFile(filePath).catch(() => null);
  if (!buffer || buffer.length > MAX_SYNC_FILE_BYTES || buffer.includes(0)) return;
  if (budget.files >= MAX_SYNC_FILES || budget.bytes + buffer.length > MAX_SYNC_TOTAL_BYTES) return;
  files.push({ path: relativePath.split(path.sep).join('/'), content: buffer.toString('utf8') });
  budget.files += 1;
  budget.bytes += buffer.length;
}

async function addTextTree(files, sourceDir, targetDir, budget) {
  let entries = [];
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    if (shouldSkipFile(source, entry)) continue;
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await addTextTree(files, source, target, budget);
    } else if (entry.isFile()) {
      await addTextFile(files, target, source, budget);
    }
  }
}

export async function buildPiProfileSyncPayload(config = {}, user = null) {
  const profile = await readPiProfile(config, user);
  if (profile.syncToRemote === false) return null;

  const files = [];
  const budget = { files: 0, bytes: 0 };
  files.push({ path: 'AGENTS.md', content: profile.agentsText });
  budget.files += 1;
  budget.bytes += Buffer.byteLength(profile.agentsText);

  for (const skill of profile.resources.skills.filter((resource) => resource.enabled)) {
    await addTextTree(files, skill.baseDir, path.join('skills', safeSegment(skill.name)), budget);
  }
  for (const extension of profile.resources.extensions.filter((resource) => resource.enabled)) {
    if (path.basename(extension.path).startsWith('index.')) {
      await addTextTree(files, extension.baseDir, path.join('extensions', safeSegment(extension.name)), budget);
    } else {
      await addTextFile(files, path.join('extensions', path.basename(extension.path)), extension.path, budget);
    }
  }
  for (const prompt of profile.resources.prompts.filter((resource) => resource.enabled)) {
    await addTextFile(files, path.join('prompts', path.basename(prompt.path)), prompt.path, budget);
  }

  return { files, fileCount: files.length, bytes: budget.bytes };
}
