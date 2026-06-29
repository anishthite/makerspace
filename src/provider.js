import { createDaytonaProvider, isTransientSandboxError } from './providers/daytona.js';
import { createLocalProvider } from './providers/local.js';

const PROVIDERS = {
  daytona: createDaytonaProvider,
  local: createLocalProvider,
};

export { isTransientSandboxError };

function projectInfo(config = {}) {
  return {
    name: config.projectName || 'makerspace',
    home: config.provider === 'local' ? config.localDataDir || '' : '',
  };
}

export function createProvider(config, options = {}) {
  const kind = config.provider || 'daytona';
  const create = PROVIDERS[kind];

  if (!create) {
    throw new Error(`Unknown infrastructure provider: ${kind}`);
  }

  const provider = create(config, options);
  const info = provider.info.bind(provider);
  return {
    ...provider,
    info() {
      return { ...info(), project: projectInfo(config) };
    },
  };
}
