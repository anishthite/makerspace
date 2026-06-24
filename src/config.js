import path from 'node:path';

try {
  process.loadEnvFile?.(path.join(process.cwd(), '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const DEFAULT_FORWARD_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
];

function splitList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getConfig() {
  const rootDir = process.cwd();

  return {
    rootDir,
    provider: process.env.INFRA_PROVIDER || process.env.PROVIDER || 'daytona',
    port: Number(process.env.PORT || 8787),
    controlApiToken: process.env.CONTROL_API_TOKEN || '',
    daytonaApiKey: process.env.DAYTONA_API_KEY || '',
    daytonaApiUrl: process.env.DAYTONA_API_URL || 'https://app.daytona.io/api',
    daytonaTarget: process.env.DAYTONA_TARGET || '',
    daytonaSnapshot: process.env.DAYTONA_SNAPSHOT || '',
    daytonaAutostopMinutes: Number(process.env.DAYTONA_AUTOSTOP_MINUTES || 60),
    daytonaAutodeleteMinutes: Number(process.env.DAYTONA_AUTODELETE_MINUTES || 120),
    remoteUser: process.env.DAYTONA_USER || 'daytona',
    remoteHomeDir: process.env.DAYTONA_HOME || '/home/daytona',
    defaultCpu: process.env.DAYTONA_CPU || '2',
    defaultMemory: process.env.DAYTONA_MEMORY || '8',
    defaultDisk: process.env.DAYTONA_DISK || '10',
    image: process.env.DAYTONA_IMAGE || '',
    registryAuth: process.env.DAYTONA_REGISTRY_AUTH || '',
    githubClientId: process.env.GITHUB_CLIENT_ID || '',
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    imageAssetsDir: process.env.IMAGE_ASSETS_DIR || path.join(rootDir, 'image'),
    dockerfilePath: process.env.DOCKERFILE_PATH || path.join(rootDir, 'image', 'Dockerfile'),
    settingsFile: process.env.SETTINGS_DATA_PATH || path.join(rootDir, 'data', 'settings.json'),
    remoteWorkspaceDir: process.env.REMOTE_WORKSPACE_DIR || '/srv/workspace',
    remoteControlDir: process.env.REMOTE_CONTROL_DIR || '/srv/micro-cloud',
    bridgePort: Number(process.env.PI_BRIDGE_PORT || 4310),
    bridgeReadyTimeoutMs: Number(process.env.PI_BRIDGE_READY_TIMEOUT_MS || 240000),
    bridgeReadyPollMs: Number(process.env.PI_BRIDGE_READY_POLL_MS || 1000),
    warmBridgePoolSize: Number(process.env.WARM_BRIDGE_POOL_SIZE || 0),
    idleBridgeTtlMs: Number(process.env.IDLE_BRIDGE_TTL_MS || 60 * 60 * 1000),
    hostDispatchEnabled: process.env.PI_LOCAL_DISPATCH !== '0' && process.env.PI_HOST_DISPATCH !== '0',
    piSdkPackageDir: process.env.PI_SDK_PACKAGE_DIR || '',
    piInstallCommand:
      process.env.PI_INSTALL_COMMAND ||
      'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
    defaultTaskPrompt:
      process.env.DEFAULT_TASK_PROMPT ||
      'Read AGENTS.md if present, inspect the repo, and complete the requested task.',
    sessionFile:
      process.env.SESSION_DATA_PATH || path.join(rootDir, 'data', 'sessions.json'),
    forwardEnvKeys: splitList(
      process.env.FORWARD_ENV_KEYS || DEFAULT_FORWARD_ENV_KEYS.join(','),
    ),
  };
}

export function collectForwardedEnv(config, settings = {}) {
  const savedEnv = {
    ANTHROPIC_API_KEY: settings.anthropicApiKey,
  };

  return config.forwardEnvKeys
    .map((key) => [key, savedEnv[key] || process.env[key]])
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => ({ key, value }));
}
