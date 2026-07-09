import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareBuildContext } from '../src/image-builder.js';
import { createPiResourceOptions, piDefaultsResourcePaths } from '../src/pi-defaults-package.js';

const packageDir = path.resolve('packages/workbench-pi-defaults');

test('workbench Pi defaults package exposes pi resources', async () => {
  const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
  const skill = await readFile(path.join(packageDir, 'skills/workbench-implementation-notes/SKILL.md'), 'utf8');
  const extension = await readFile(path.join(packageDir, 'extensions/workbench-defaults.ts'), 'utf8');

  assert.equal(manifest.name, '@workbench/pi-defaults');
  assert.deepEqual(manifest.pi, {
    extensions: ['extensions/*.ts'],
    skills: ['skills'],
    prompts: ['prompts/*.md'],
  });
  assert.match(skill, /name: workbench-implementation-notes/);
  assert.match(skill, /description: Keep concise append-only implementation notes/);
  assert.match(extension, /before_agent_start/);
  assert.match(extension, /context\/AGENTS\.md/);
  assert.match(extension, /contextHasAgents/);
  assert.match(extension, /registerProvider\('inference'/);
  assert.match(extension, /\$INFERENCE_API_KEY/);

  for (const skill of ['code-simplifier', 'playground', 'excalidraw-diagram', 'ponytail', 'ponytail-audit', 'ponytail-debt', 'ponytail-help', 'ponytail-review', 'emil-design-eng']) {
    assert.match(await readFile(path.join(packageDir, 'skills', skill, 'SKILL.md'), 'utf8'), /#|---|name:/);
  }
  await assert.rejects(readFile(path.join(packageDir, 'skills/excalidraw-diagram/references/.venv/pyvenv.cfg'), 'utf8'), /ENOENT/);
});

test('createPiResourceOptions adds package resource paths when present', async () => {
  let captured;
  const fakeSdk = {
    getAgentDir: () => '/tmp/fake-agent',
    SettingsManager: {
      create: (cwd, agentDir) => ({ cwd, agentDir }),
    },
    DefaultResourceLoader: class {
      constructor(options) {
        captured = options;
      }
      async reload() {
        captured.reloaded = true;
      }
    },
  };

  const result = await createPiResourceOptions(fakeSdk, {
    cwd: '/tmp/fake-cwd',
    packageDir,
  });

  assert.equal(result.defaultsLoaded, true);
  assert.equal(captured.cwd, '/tmp/fake-cwd');
  assert.equal(captured.agentDir, '/tmp/fake-agent');
  assert.deepEqual(captured.additionalExtensionPaths, [packageDir]);
  assert.deepEqual(captured.additionalSkillPaths, [path.join(packageDir, 'skills')]);
  assert.deepEqual(captured.additionalPromptTemplatePaths, [path.join(packageDir, 'prompts')]);
  const agentsFiles = captured.agentsFilesOverride({ agentsFiles: [{ path: '/project/AGENTS.md', content: '# Project\n' }] }).agentsFiles;
  assert.equal(agentsFiles[0].path, path.join(packageDir, 'context', 'AGENTS.md'));
  assert.match(agentsFiles[0].content, /Default to using fenced `openui` blocks for final user-facing responses/);
  assert.match(agentsFiles[0].content, /prefer a direct root such as `TextContent` or `Table`/);
  assert.match(agentsFiles[0].content, /## Interactive final-answer controls/);
  assert.match(agentsFiles[0].content, /```workbench-ui/);
  assert.match(agentsFiles[0].content, /actions fill the composer for user review/);
  assert.equal(agentsFiles[1].path, '/project/AGENTS.md');
  assert.equal(captured.reloaded, true);
});

test('createPiResourceOptions applies extension provider registrations', async () => {
  const providers = [];
  const runtime = {
    pendingProviderRegistrations: [
      { name: 'inference', config: { apiKey: '$INFERENCE_API_KEY' }, extensionPath: 'defaults.ts' },
    ],
  };
  const fakeSdk = {
    getAgentDir: () => '/tmp/fake-agent',
    AuthStorage: {
      create: (authPath) => ({ authPath }),
    },
    ModelRegistry: {
      create: (authStorage, modelsPath) => ({
        authStorage,
        modelsPath,
        registerProvider: (name, config) => providers.push({ name, config }),
      }),
    },
    SettingsManager: {
      create: (cwd, agentDir) => ({ cwd, agentDir }),
    },
    DefaultResourceLoader: class {
      async reload() {}
      getExtensions() {
        return { runtime };
      }
    },
  };

  const result = await createPiResourceOptions(fakeSdk, {
    cwd: '/tmp/fake-cwd',
    packageDir,
  });

  assert.deepEqual(providers, [{ name: 'inference', config: { apiKey: '$INFERENCE_API_KEY' } }]);
  assert.equal(result.modelRegistry.modelsPath, '/tmp/fake-agent/models.json');
  assert.deepEqual(runtime.pendingProviderRegistrations, []);
  assert.deepEqual(result.diagnostics, []);
});

test('prepareBuildContext copies defaults package into docker ctx', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workbench-defaults-image-'));
  const imageDir = path.join(dir, 'image');
  const packageSource = path.join(dir, 'defaults');

  await mkdir(imageDir, { recursive: true });
  await mkdir(packageSource, { recursive: true });
  await writeFile(path.join(imageDir, 'Dockerfile'), 'FROM scratch\nCOPY ctx/ /tmp/ctx/\n');
  await writeFile(path.join(packageSource, 'package.json'), '{"name":"defaults"}\n');

  const prepared = await prepareBuildContext({
    imageAssetsDir: imageDir,
    piDefaultsPackageDir: packageSource,
  });

  try {
    assert.equal(
      await readFile(path.join(prepared.contextDir, 'ctx/workbench-pi-defaults/package.json'), 'utf8'),
      '{"name":"defaults"}\n',
    );
  } finally {
    await rm(prepared.tempRoot, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test('piDefaultsResourcePaths returns null for absent package', () => {
  assert.equal(piDefaultsResourcePaths('/definitely/missing/workbench-pi-defaults'), null);
});
