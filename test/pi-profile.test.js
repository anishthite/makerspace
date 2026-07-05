import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildPiProfileSyncPayload, piProfileResourceOverrides, readPiProfile, savePiProfile } from '../src/pi-profile.js';

async function makeProfileFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-pi-profile-'));
  const agentDir = path.join(root, 'agent');
  const agentsSkillsDir = path.join(root, 'agents-skills');
  const piProfileFile = path.join(root, 'pi-profile.json');
  await mkdir(path.join(agentDir, 'skills', 'alpha'), { recursive: true });
  await mkdir(path.join(agentDir, 'skills', 'beta'), { recursive: true });
  await mkdir(path.join(agentDir, 'extensions', 'nested'), { recursive: true });
  await mkdir(path.join(agentDir, 'prompts'), { recursive: true });
  await mkdir(agentsSkillsDir, { recursive: true });
  await writeFile(path.join(agentDir, 'AGENTS.md'), '# Current Pi\n');
  await writeFile(path.join(agentDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Alpha skill\n---\n# Alpha\n');
  await writeFile(path.join(agentDir, 'skills', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: Beta skill\n---\n# Beta\n');
  await writeFile(path.join(agentDir, 'extensions', 'guard.ts'), 'export default function () {}\n');
  await writeFile(path.join(agentDir, 'extensions', 'nested', 'index.ts'), 'export default function nested() {}\n');
  await writeFile(path.join(agentDir, 'extensions', 'nested', 'helper.ts'), 'export const helper = true;\n');
  await writeFile(path.join(agentDir, 'prompts', 'ship.md'), '---\ndescription: Ship prompt\n---\nShip it.\n');
  return { root, agentDir, agentsSkillsDir, piProfileFile };
}

test('readPiProfile defaults to Workbench package profile instead of personal Pi dir', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-package-profile-'));
  const packageDir = path.join(root, 'packages', 'workbench-pi-defaults');
  const personalDir = path.join(root, 'personal-pi');
  await mkdir(path.join(packageDir, 'context'), { recursive: true });
  await mkdir(personalDir, { recursive: true });
  await writeFile(path.join(packageDir, 'context', 'AGENTS.md'), '# Workbench Pi\n');
  await writeFile(path.join(personalDir, 'AGENTS.md'), '# Personal Pi\n');
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = personalDir;
  try {
    const profile = await readPiProfile({ rootDir: root, piDefaultsPackageDir: packageDir, piProfileFile: path.join(root, 'profile.json') });
    assert.equal(profile.agentsText, '# Workbench Pi\n');
    assert.equal(profile.agentsPath, path.join(packageDir, 'context', 'AGENTS.md'));
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test('readPiProfile discovers current Pi resources', async () => {
  const fixture = await makeProfileFixture();
  const profile = await readPiProfile(fixture);

  assert.equal(profile.agentsText, '# Current Pi\n');
  assert.deepEqual(profile.resources.skills.map((skill) => skill.name), ['alpha', 'beta']);
  assert.deepEqual(profile.resources.extensions.map((extension) => extension.name), ['guard', 'nested']);
  assert.deepEqual(profile.resources.prompts.map((prompt) => prompt.name), ['ship']);
});

test('savePiProfile writes AGENTS.md and persists enabled resources', async () => {
  const fixture = await makeProfileFixture();
  const initial = await readPiProfile(fixture);
  const alpha = initial.resources.skills.find((skill) => skill.name === 'alpha');
  const guard = initial.resources.extensions.find((extension) => extension.name === 'guard');

  const saved = await savePiProfile(fixture, {
    agentsText: '# Updated\n',
    syncToRemote: false,
    enabledSkills: [alpha.id],
    enabledExtensions: [guard.id],
    enabledPrompts: [],
  });

  assert.equal(await readFile(path.join(fixture.agentDir, 'AGENTS.md'), 'utf8'), '# Updated\n');
  assert.equal(saved.syncToRemote, false);
  assert.deepEqual(saved.resources.skills.map((skill) => [skill.name, skill.enabled]), [['alpha', true], ['beta', false]]);
  assert.deepEqual(saved.resources.prompts.map((prompt) => prompt.enabled), [false]);
});

test('piProfileResourceOverrides filters only known profile resources', async () => {
  const fixture = await makeProfileFixture();
  const profile = await savePiProfile(fixture, {
    enabledSkills: [(await readPiProfile(fixture)).resources.skills.find((skill) => skill.name === 'alpha').id],
    enabledExtensions: [],
    enabledPrompts: [],
  });
  const overrides = piProfileResourceOverrides(profile);
  const alphaPath = profile.resources.skills.find((skill) => skill.name === 'alpha').path;
  const betaPath = profile.resources.skills.find((skill) => skill.name === 'beta').path;
  const guardPath = profile.resources.extensions.find((extension) => extension.name === 'guard').path;

  assert.deepEqual(overrides.skillsOverride({ skills: [
    { name: 'alpha', filePath: alphaPath },
    { name: 'beta', filePath: betaPath },
    { name: 'package-skill', filePath: '/package/SKILL.md' },
  ], diagnostics: [] }).skills.map((skill) => skill.name), ['alpha', 'package-skill']);
  assert.deepEqual(overrides.extensionsOverride({ extensions: [
    { path: guardPath },
    { path: '/package/extension.ts' },
  ], errors: [] }).extensions.map((extension) => extension.path), ['/package/extension.ts']);
});

test('buildPiProfileSyncPayload serializes selected profile files', async () => {
  const fixture = await makeProfileFixture();
  const profile = await readPiProfile(fixture);
  const alpha = profile.resources.skills.find((skill) => skill.name === 'alpha');
  const nested = profile.resources.extensions.find((extension) => extension.name === 'nested');
  const ship = profile.resources.prompts.find((prompt) => prompt.name === 'ship');
  await savePiProfile(fixture, {
    agentsText: '# Synced\n',
    enabledSkills: [alpha.id],
    enabledExtensions: [nested.id],
    enabledPrompts: [ship.id],
  });

  const payload = await buildPiProfileSyncPayload(fixture);
  const paths = payload.files.map((file) => file.path).sort();

  assert.deepEqual(paths, [
    'AGENTS.md',
    'extensions/nested/helper.ts',
    'extensions/nested/index.ts',
    'prompts/ship.md',
    'skills/alpha/SKILL.md',
  ]);
  assert.equal(payload.files.find((file) => file.path === 'AGENTS.md').content, '# Synced\n');
});
