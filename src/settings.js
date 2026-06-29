import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { d1StateRequested, readD1Kv, writeD1Kv } from './d1-state.js';

export const DEFAULT_IMAGE_REF = '';

const DEFAULT_SETTINGS = {
  imageRef: DEFAULT_IMAGE_REF,
  registryAuth: '',
  autoBuildImage: false,
  anthropicApiKey: '',
};

async function ensureSettingsFile(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      await writeFile(filePath, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`, 'utf8');
      return;
    }

    throw error;
  }
}

function normalizeDockerfile(value) {
  const text = String(value || '');
  return text.endsWith('\n') ? text : `${text}\n`;
}

function normalizeRegistryAuth(input = {}) {
  const direct = String(input.registryAuth || '').trim();
  if (direct) return direct;

  const username = String(input.registryUsername || '').trim();
  const password = String(input.registryPassword || '').trim();
  return username && password ? `${username}:${password}` : '';
}

export function normalizeImageSettings(input = {}) {
  return {
    imageRef: String(input.imageRef || DEFAULT_IMAGE_REF).trim(),
    registryAuth: normalizeRegistryAuth(input),
    autoBuildImage: input.autoBuildImage === true,
    anthropicApiKey: String(input.anthropicApiKey || '').trim(),
  };
}

function publicSettings(settings, dockerfile) {
  const registryUsername = settings.registryAuth ? settings.registryAuth.split(':')[0] : '';
  return {
    ...settings,
    registryAuth: '',
    registryUsername,
    anthropicApiKey: '',
    hasRegistryAuth: Boolean(settings.registryAuth),
    hasAnthropicApiKey: Boolean(settings.anthropicApiKey),
    dockerfile,
  };
}

async function writeNormalizedSettings(filePath, settings) {
  await writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export async function readSavedSettings(filePath) {
  if (d1StateRequested()) {
    return normalizeImageSettings({ ...DEFAULT_SETTINGS, ...(await readD1Kv('settings', {})) });
  }

  await ensureSettingsFile(filePath);
  const text = await readFile(filePath, 'utf8');
  const rawSettings = JSON.parse(text || '{}');
  const settings = normalizeImageSettings({ ...DEFAULT_SETTINGS, ...rawSettings });

  if (Object.prototype.hasOwnProperty.call(rawSettings, 'githubToken') || Object.prototype.hasOwnProperty.call(rawSettings, 'githubUser')) {
    await writeNormalizedSettings(filePath, settings);
  }

  return settings;
}

export async function saveSavedSettings(filePath, input) {
  const settings = normalizeImageSettings(input);

  if (settings.autoBuildImage && !settings.imageRef) {
    throw new Error('Image ref is required when auto-build is enabled.');
  }

  if (d1StateRequested()) {
    await writeD1Kv('settings', settings);
    return settings;
  }

  await ensureSettingsFile(filePath);
  await writeNormalizedSettings(filePath, settings);
  return settings;
}

export async function readAppSettings(config) {
  const diskDockerfile = await readFile(config.dockerfilePath, 'utf8');
  const [settings, dockerfile] = await Promise.all([
    readSavedSettings(config.settingsFile),
    d1StateRequested() ? readD1Kv('dockerfile', diskDockerfile) : diskDockerfile,
  ]);

  return publicSettings(settings, dockerfile);
}

export async function saveAppSettings(config, input) {
  const dockerfile = normalizeDockerfile(input.dockerfile);
  const existing = await readSavedSettings(config.settingsFile);
  const settings = await saveSavedSettings(config.settingsFile, {
    ...existing,
    ...input,
    registryAuth: normalizeRegistryAuth(input) || existing.registryAuth,
    anthropicApiKey: String(input.anthropicApiKey || '').trim() || existing.anthropicApiKey,
  });

  await mkdir(path.dirname(config.dockerfilePath), { recursive: true });
  await writeFile(config.dockerfilePath, dockerfile, 'utf8');
  if (d1StateRequested()) await writeD1Kv('dockerfile', dockerfile);

  return publicSettings(settings, dockerfile);
}
