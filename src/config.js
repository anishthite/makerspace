import { homedir } from 'node:os';
import path from 'node:path';

try {
  process.loadEnvFile?.(path.join(process.cwd(), '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const DEFAULT_FORWARD_ENV_KEYS = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
  'INFERENCE_API_KEY',
];

function splitList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function projectNameFromEnv(localDataDir) {
  const explicit = String(process.env.WORKBENCH_PROJECT || process.env.WORKBENCH_NAME || '').trim();
  if (explicit) return explicit;

  if (process.env.WORKBENCH_HOME) {
    const name = path.basename(path.resolve(localDataDir)).replace(/^\.+/, '').trim();
    if (name) return name;
  }

  return 'workbench';
}

export function getConfig() {
  const rootDir = process.cwd();
  const provider = process.env.INFRA_PROVIDER || process.env.PROVIDER || 'daytona';
  const workspaceMode = truthy(process.env.WORKBENCH_WORKSPACE_MODE || process.env.PROJECT_WORKSPACE_MODE);
  const localDataDir = process.env.WORKBENCH_HOME || path.join(homedir(), '.workbench');
  const defaultDataDir = provider === 'local' ? localDataDir : path.join(rootDir, 'data');

  return {
    rootDir,
    provider,
    projectName: projectNameFromEnv(localDataDir),
    localDataDir,
    host: process.env.HOST || (provider === 'local' ? '127.0.0.1' : ''),
    port: Number(process.env.PORT || 8787),
    controlApiToken: process.env.CONTROL_API_TOKEN || '',
    authRequired: process.env.WORKBENCH_AUTH_REQUIRED || process.env.WORKBENCH_MULTI_USER
      ? truthy(process.env.WORKBENCH_AUTH_REQUIRED || process.env.WORKBENCH_MULTI_USER)
      : Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && provider !== 'local'),
    authSecret: process.env.WORKBENCH_AUTH_SECRET || process.env.AUTH_SECRET || '',
    authCookieName: process.env.WORKBENCH_AUTH_COOKIE || 'workbench_auth',
    authCookieSameSite: process.env.WORKBENCH_AUTH_SAMESITE || '',
    authSessionDays: Number(process.env.WORKBENCH_AUTH_SESSION_DAYS || 30),
    allowHostedLocalProvider: truthy(process.env.WORKBENCH_ALLOW_HOSTED_LOCAL_PROVIDER),
    allowedOrigin: process.env.WORKBENCH_ALLOWED_ORIGIN || process.env.PUBLIC_APP_ORIGIN || '',
    stateStore: process.env.WORKBENCH_STATE_STORE || process.env.STATE_STORE || 'file',
    daytonaApiKey: process.env.DAYTONA_API_KEY || '',
    daytonaApiUrl: process.env.DAYTONA_API_URL || 'https://app.daytona.io/api',
    daytonaTarget: process.env.DAYTONA_TARGET || '',
    daytonaSnapshot: process.env.DAYTONA_SNAPSHOT || '',
    workspaceMode,
    daytonaAutostopMinutes: Number(process.env.DAYTONA_AUTOSTOP_MINUTES || 60),
    daytonaAutodeleteMinutes: Number(process.env.DAYTONA_AUTODELETE_MINUTES || (workspaceMode ? 10080 : 120)),
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
    settingsFile: process.env.SETTINGS_DATA_PATH || path.join(defaultDataDir, 'settings.json'),
    recentProjectsFile: process.env.RECENT_PROJECTS_DATA_PATH || path.join(defaultDataDir, 'recent-projects.json'),
    authFile: process.env.AUTH_DATA_PATH || process.env.WORKBENCH_AUTH_DATA_PATH || path.join(defaultDataDir, 'auth.json'),
    remoteWorkspaceDir: process.env.REMOTE_WORKSPACE_DIR || '/srv/workspace',
    remoteControlDir: process.env.REMOTE_CONTROL_DIR || '/srv/workbench',
    bridgePort: Number(process.env.PI_BRIDGE_PORT || 4310),
    bridgeReadyTimeoutMs: Number(process.env.PI_BRIDGE_READY_TIMEOUT_MS || 240000),
    bridgeReadyPollMs: Number(process.env.PI_BRIDGE_READY_POLL_MS || 1000),
    bridgeStreamStallMs: Number(process.env.PI_BRIDGE_STREAM_STALL_MS || 60000),
    warmBridgePoolSize: Number(process.env.WARM_BRIDGE_POOL_SIZE || 0),
    idleBridgeTtlMs: Number(process.env.IDLE_BRIDGE_TTL_MS || 60 * 60 * 1000),
    hostDispatchEnabled: provider !== 'local' && ['1', 'true', 'yes'].includes(String(process.env.PI_HOST_DISPATCH || process.env.PI_LOCAL_DISPATCH || '').toLowerCase()),
    piSdkPackageDir: process.env.PI_SDK_PACKAGE_DIR || '',
    piAgentDir: process.env.PI_CODING_AGENT_DIR || path.join(homedir(), '.pi', 'agent'),
    piProfileFile: process.env.PI_PROFILE_DATA_PATH || path.join(defaultDataDir, 'pi-profile.json'),
    piDefaultsPackageDir:
      process.env.WORKBENCH_PI_DEFAULTS_PACKAGE_DIR ||
      path.join(rootDir, 'packages', 'workbench-pi-defaults'),
    remotePiDefaultsPackageDir:
      process.env.REMOTE_PI_DEFAULTS_PACKAGE_DIR ||
      `/home/${process.env.DAYTONA_USER || 'daytona'}/.pi/agent/workbench-pi-defaults`,
    piInstallCommand:
      process.env.PI_INSTALL_COMMAND ||
      'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
    defaultTaskPrompt:
      process.env.DEFAULT_TASK_PROMPT ||
      'Read AGENTS.md if present, inspect the repo, and complete the requested task.',
    threadTitleModel: process.env.THREAD_TITLE_MODEL || 'openai-codex/gpt-5.4-mini',
    threadTitleTimeoutMs: Number(process.env.THREAD_TITLE_TIMEOUT_MS || 15000),
    threadSummaryModel: process.env.THREAD_SUMMARY_MODEL || process.env.THREAD_TITLE_MODEL || 'openai-codex/gpt-5.4-mini',
    threadSummaryTimeoutMs: Number(process.env.THREAD_SUMMARY_TIMEOUT_MS || 15000),
    threadTurnStatusModel: process.env.THREAD_TURN_STATUS_MODEL || process.env.THREAD_SUMMARY_MODEL || process.env.THREAD_TITLE_MODEL || 'openai-codex/gpt-5.4-mini',
    threadTurnStatusTimeoutMs: Number(process.env.THREAD_TURN_STATUS_TIMEOUT_MS || 15000),
    sessionFile:
      process.env.SESSION_DATA_PATH || path.join(defaultDataDir, 'sessions.json'),
    piSessionTraceDir:
      process.env.PI_SESSION_TRACE_DIR || path.join(defaultDataDir, 'pi-sessions'),
    forwardEnvKeys: splitList(
      process.env.FORWARD_ENV_KEYS || DEFAULT_FORWARD_ENV_KEYS.join(','),
    ),
  };
}

const SHARED_GIT_TOKEN_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN'];

export function collectForwardedEnv(config, settings = {}) {
  const savedEnv = {
    ANTHROPIC_API_KEY: settings.anthropicApiKey,
  };

  return config.forwardEnvKeys
    // Multi-user sandboxes get per-user GitHub tokens via the bridge auth
    // sync; never forward the server's shared token to everyone.
    .filter((key) => !(config.authRequired && SHARED_GIT_TOKEN_KEYS.includes(key)))
    .map((key) => [key, savedEnv[key] || process.env[key]])
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => ({ key, value }));
}
