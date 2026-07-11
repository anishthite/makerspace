import { createCloudflareProvider } from './providers/cloudflare.js';
import { createLocalProvider } from './providers/local.js';

const PROVIDERS = {
  cloudflare: createCloudflareProvider,
  local: createLocalProvider,
};

export function isTransientSandboxError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return /timeout|temporar|rate limit|503|502|network|econnreset|etimedout/.test(message);
}

function projectInfo(config = {}) {
  return {
    name: config.projectName || 'spanner',
    home: config.provider === 'local' ? config.localDataDir || '' : '',
  };
}

export function createProvider(config, options = {}) {
  const kind = config.provider || 'cloudflare';
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
