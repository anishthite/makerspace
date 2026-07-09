import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { deriveNpmPackageManifest } from '../src/image-builder.js';
import { DEFAULT_IMAGE_REF, normalizeImageSettings, readAppSettings, readSavedSettings, saveAppSettings } from '../src/settings.js';

test('normalizeImageSettings trims values and defaults autoBuildImage', () => {
  const settings = normalizeImageSettings({
    imageRef: ' ghcr.io/acme/pi:latest ',
    registryUsername: ' user ',
    registryPassword: ' token ',
  });

  assert.deepEqual(settings, {
    imageRef: 'ghcr.io/acme/pi:latest',
    registryAuth: 'user:token',
    autoBuildImage: false,
    anthropicApiKey: '',
  });
});

test('normalizeImageSettings defaults to the optimized image', () => {
  assert.equal(normalizeImageSettings({}).imageRef, DEFAULT_IMAGE_REF);
});

test('readSavedSettings scrubs legacy github auth fields', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spanner-settings-'));
  const filePath = path.join(dir, 'settings.json');

  await writeFile(filePath, `${JSON.stringify({
    imageRef: '',
    registryAuth: '',
    autoBuildImage: false,
    anthropicApiKey: '',
    githubToken: 'old-token',
    githubUser: { login: 'octocat' },
  }, null, 2)}\n`);

  const settings = await readSavedSettings(filePath);
  const raw = JSON.parse(await readFile(filePath, 'utf8'));

  assert.equal(settings.imageRef, '');
  assert.equal('githubToken' in raw, false);
  assert.equal('githubUser' in raw, false);
});

test('saveAppSettings preserves blank secrets and hides them on read', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spanner-settings-'));
  const config = {
    settingsFile: path.join(dir, 'settings.json'),
    dockerfilePath: path.join(dir, 'Dockerfile'),
  };
  await writeFile(config.dockerfilePath, 'FROM alpine\n');

  await saveAppSettings(config, {
    imageRef: DEFAULT_IMAGE_REF,
    registryAuth: 'user:token',
    anthropicApiKey: 'fake-anthropic-key',
    dockerfile: 'FROM alpine\n',
  });
  const saved = await saveAppSettings(config, {
    imageRef: DEFAULT_IMAGE_REF,
    registryAuth: '',
    anthropicApiKey: '',
    dockerfile: 'FROM alpine\n',
  });
  const read = await readAppSettings(config);
  const raw = JSON.parse(await readFile(config.settingsFile, 'utf8'));

  assert.equal(raw.registryAuth, 'user:token');
  assert.equal(raw.anthropicApiKey, 'fake-anthropic-key');
  assert.equal('githubToken' in raw, false);
  assert.equal(saved.registryAuth, '');
  assert.equal(saved.anthropicApiKey, '');
  assert.equal(read.registryAuth, '');
  assert.equal(read.registryUsername, 'user');
  assert.equal(read.anthropicApiKey, '');
  assert.equal(read.hasRegistryAuth, true);
  assert.equal(read.hasAnthropicApiKey, true);
});

test('deriveNpmPackageManifest keeps only npm packages', () => {
  const manifest = deriveNpmPackageManifest(JSON.stringify({
    packages: [
      'npm:pi-web-access',
      'npm:@scope/pkg@1.2.3',
      'git:github.com/example/repo',
      '../../workspace/local-package',
    ],
  }));

  assert.deepEqual(manifest, {
    name: 'spanner-image-packages',
    private: true,
    dependencies: {
      'pi-web-access': 'latest',
      '@scope/pkg': '1.2.3',
    },
  });
});
