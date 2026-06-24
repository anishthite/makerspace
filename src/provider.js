import { createDaytonaProvider, isTransientSandboxError } from './providers/daytona.js';

const PROVIDERS = {
  daytona: createDaytonaProvider,
};

export { isTransientSandboxError };

export function createProvider(config, options = {}) {
  const kind = config.provider || 'daytona';
  const create = PROVIDERS[kind];

  if (!create) {
    throw new Error(`Unknown infrastructure provider: ${kind}`);
  }

  return create(config, options);
}
