import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function createInMemoryCredentialStore(data = {}) {
  const credentials = new Map(Object.entries(data || {}));
  return {
    async read(providerId) {
      return credentials.get(providerId);
    },
    async list() {
      return [...credentials.entries()].map(([providerId, credential]) => ({ providerId, type: credential?.type }));
    },
    async modify(providerId, fn) {
      const next = await fn(credentials.get(providerId));
      if (next !== undefined) credentials.set(providerId, next);
      return credentials.get(providerId);
    },
    async delete(providerId) {
      credentials.delete(providerId);
    },
  };
}

export async function createPiModelRuntime(sdk, options = {}) {
  if (options.modelRuntime) return options.modelRuntime;
  if (!sdk?.ModelRuntime?.create) return null;
  return sdk.ModelRuntime.create({
    ...(options.credentials ? { credentials: options.credentials } : {}),
    ...(options.authPath ? { authPath: options.authPath } : {}),
    ...(options.modelsPath !== undefined ? { modelsPath: options.modelsPath } : {}),
    allowModelNetwork: options.allowModelNetwork ?? false,
  });
}

export function createPiModelRegistry(sdk, options = {}) {
  if (options.modelRegistry) return options.modelRegistry;
  if (options.modelRuntime && sdk?.ModelRegistry) return new sdk.ModelRegistry(options.modelRuntime);
  if (options.authStorage && sdk?.ModelRegistry?.create) return sdk.ModelRegistry.create(options.authStorage, options.modelsPath);
  return null;
}

export async function writeCredentialFile(authPath, provider, credential) {
  let data = {};
  try {
    data = JSON.parse(await readFile(authPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  data[provider] = credential;
  await mkdir(path.dirname(authPath), { recursive: true, mode: 0o700 });
  await writeFile(authPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}
