import { cpSync, existsSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { stateStoreFromEnv } from './d1-state.js';

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
  return String(value || '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function moveLegacyDir(legacyDir, nextDir) {
  if (!legacyDir || !nextDir || legacyDir === nextDir || existsSync(nextDir) || !existsSync(legacyDir)) return;
  try {
    renameSync(legacyDir, nextDir);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    cpSync(legacyDir, nextDir, { recursive: true, errorOnExist: false });
    rmSync(legacyDir, { recursive: true, force: true });
  }
}

function defaultLocalDataDir() {
  const nextDir = path.join(homedir(), '.spanner');
  // ponytail: one-time hard-rename migration; explicit SPANNER_HOME opts out.
  if (!process.env.SPANNER_HOME) moveLegacyDir(path.join(homedir(), '.workbench'), nextDir);
  return nextDir;
}

const ALLOWED_ORIGIN_ENV_KEYS = [
  'SPANNER_ALLOWED_ORIGINS',
  'SPANNER_ALLOWED_ORIGIN',
  'PUBLIC_APP_ORIGINS',
  'PUBLIC_APP_ORIGIN',
];

export function allowedOriginsFromEnv(env = process.env) {
  const value = ALLOWED_ORIGIN_ENV_KEYS.map((key) => env[key]).find((item) => String(item || '').trim());
  return splitList(value || '');
}

export function allowedOriginFromEnv(env = process.env) {
  return allowedOriginsFromEnv(env)[0] || '';
}

function projectNameFromEnv(localDataDir) {
  const explicit = String(process.env.SPANNER_PROJECT || process.env.SPANNER_NAME || '').trim();
  if (explicit) return explicit;

  if (process.env.SPANNER_HOME) {
    const name = path.basename(path.resolve(localDataDir)).replace(/^\.+/, '').trim();
    if (name) return name;
  }

  return 'spanner';
}

export function getConfig() {
  const rootDir = process.cwd();
  const provider = process.env.INFRA_PROVIDER || process.env.PROVIDER || 'cloudflare';
  const workspaceMode = truthy(process.env.SPANNER_WORKSPACE_MODE || process.env.PROJECT_WORKSPACE_MODE);
  const localDataDir = process.env.SPANNER_HOME || defaultLocalDataDir();
  const defaultDataDir = provider === 'local' ? localDataDir : path.join(rootDir, 'data');
  const allowedOrigins = allowedOriginsFromEnv();
  const cloudflareKeepAlive = process.env.CLOUDFLARE_SANDBOX_KEEPALIVE === undefined
    ? true
    : truthy(process.env.CLOUDFLARE_SANDBOX_KEEPALIVE);

  return {
    rootDir,
    provider,
    projectName: projectNameFromEnv(localDataDir),
    localDataDir,
    host: process.env.HOST || (provider === 'local' ? '127.0.0.1' : ''),
    port: Number(process.env.PORT || 8787),
    controlApiToken: process.env.CONTROL_API_TOKEN || '',
    authRequired: process.env.SPANNER_AUTH_REQUIRED || process.env.SPANNER_MULTI_USER
      ? truthy(process.env.SPANNER_AUTH_REQUIRED || process.env.SPANNER_MULTI_USER)
      : Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && provider !== 'local'),
    authSecret: process.env.SPANNER_AUTH_SECRET || process.env.AUTH_SECRET || '',
    authCookieName: process.env.SPANNER_AUTH_COOKIE || 'spanner_auth',
    authCookieSameSite: process.env.SPANNER_AUTH_SAMESITE || '',
    authSessionDays: Number(process.env.SPANNER_AUTH_SESSION_DAYS || 30),
    allowHostedLocalProvider: truthy(process.env.SPANNER_ALLOW_HOSTED_LOCAL_PROVIDER),
    allowedOrigin: allowedOrigins[0] || '',
    allowedOrigins,
    allowedUsers: splitList(process.env.SPANNER_ALLOWED_USERS || process.env.SPANNER_ALLOWED_GITHUB_USERS || ''),
    stateStore: stateStoreFromEnv(),
    cloudflareBrokerUrl: process.env.CLOUDFLARE_SANDBOX_BROKER_URL || process.env.CLOUDFLARE_BROKER_URL || '',
    cloudflareBrokerToken: process.env.CLOUDFLARE_SANDBOX_BROKER_TOKEN || process.env.CLOUDFLARE_BROKER_TOKEN || '',
    cloudflareMachine: process.env.CLOUDFLARE_SANDBOX_MACHINE || 'standard-2',
    cloudflareSleepAfter: process.env.CLOUDFLARE_SANDBOX_SLEEP_AFTER || '15m',
    cloudflareKeepAlive,
    workspaceMode,
    remoteUser: process.env.REMOTE_USER || 'root',
    remoteHomeDir: process.env.REMOTE_HOME || '/home/root',
    image: process.env.CLOUDFLARE_SANDBOX_IMAGE || process.env.SANDBOX_IMAGE || '',
    registryAuth: process.env.SANDBOX_REGISTRY_AUTH || '',
    githubClientId: process.env.GITHUB_CLIENT_ID || '',
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    githubAppId: process.env.GITHUB_APP_ID || '',
    githubAppSlug: process.env.GITHUB_APP_SLUG || process.env.GITHUB_APP_NAME || '',
    githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY || '',
    imageAssetsDir: process.env.IMAGE_ASSETS_DIR || path.join(rootDir, 'image'),
    dockerfilePath: process.env.DOCKERFILE_PATH || path.join(rootDir, 'image', 'Dockerfile'),
    settingsFile: process.env.SETTINGS_DATA_PATH || path.join(defaultDataDir, 'settings.json'),
    recentProjectsFile: process.env.RECENT_PROJECTS_DATA_PATH || path.join(defaultDataDir, 'recent-projects.json'),
    workflowRunsDir: process.env.SPANNER_WORKFLOW_RUNS_DIR || path.join(defaultDataDir, 'workflows', 'runs'),
    authFile: process.env.AUTH_DATA_PATH || process.env.SPANNER_AUTH_DATA_PATH || path.join(defaultDataDir, 'auth.json'),
    remoteWorkspaceDir: process.env.REMOTE_WORKSPACE_DIR || '/workspace',
    remoteControlDir: process.env.REMOTE_CONTROL_DIR || '/home/root/.spanner/control',
    bridgePort: Number(process.env.PI_BRIDGE_PORT || 4310),
    bridgeReadyTimeoutMs: Number(process.env.PI_BRIDGE_READY_TIMEOUT_MS || 240000),
    bridgeReadyPollMs: Number(process.env.PI_BRIDGE_READY_POLL_MS || 1000),
    bridgeStreamStallMs: Number(process.env.PI_BRIDGE_STREAM_STALL_MS || 60000),
    bridgeRunStaleMs: Number(process.env.PI_BRIDGE_RUN_STALE_MS || 45 * 60 * 1000),
    bridgeStaleBackupTimeoutMs: Number(process.env.PI_BRIDGE_STALE_BACKUP_TIMEOUT_MS || 30000),
    warmBridgePoolSize: Number(process.env.WARM_BRIDGE_POOL_SIZE || 0),
    idleBridgeTtlMs: Number(process.env.IDLE_BRIDGE_TTL_MS || 60 * 60 * 1000),
    threadBridgeIdleTtlMs: Number(process.env.THREAD_BRIDGE_IDLE_TTL_MS || 15 * 60 * 1000),
    hostDispatchEnabled: provider !== 'local' && ['1', 'true', 'yes'].includes(String(process.env.PI_HOST_DISPATCH || process.env.PI_LOCAL_DISPATCH || '').toLowerCase()),
    piSdkPackageDir: process.env.PI_SDK_PACKAGE_DIR || '',
    piAgentDir: process.env.PI_CODING_AGENT_DIR || path.join(homedir(), '.pi', 'agent'),
    piProfileFile: process.env.PI_PROFILE_DATA_PATH || path.join(defaultDataDir, 'pi-profile.json'),
    piDefaultsPackageDir:
      process.env.SPANNER_PI_DEFAULTS_PACKAGE_DIR ||
      path.join(rootDir, 'packages', 'spanner-pi-defaults'),
    remotePiDefaultsPackageDir:
      process.env.REMOTE_PI_DEFAULTS_PACKAGE_DIR ||
      '/home/root/.pi/agent/spanner-pi-defaults',
    piInstallCommand:
      process.env.PI_INSTALL_COMMAND ||
      'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
    defaultTaskPrompt:
      process.env.DEFAULT_TASK_PROMPT ||
      'Use the Spanner defaults context from $SPANNER_PI_DEFAULTS_PACKAGE_DIR/context/AGENTS.md when set, otherwise packages/spanner-pi-defaults/context/AGENTS.md if present. Do not require a repo-root AGENTS.md. Then inspect the repo and complete the requested task.',
    threadTitleModel: process.env.THREAD_TITLE_MODEL || 'openai-codex/gpt-5.4-mini',
    threadTitleTimeoutMs: Number(process.env.THREAD_TITLE_TIMEOUT_MS || 15000),
    threadSummaryModel: process.env.THREAD_SUMMARY_MODEL || process.env.THREAD_TITLE_MODEL || 'openai-codex/gpt-5.4-mini',
    threadSummaryTimeoutMs: Number(process.env.THREAD_SUMMARY_TIMEOUT_MS || 15000),
    threadTurnStatusModel: process.env.THREAD_TURN_STATUS_MODEL || process.env.THREAD_SUMMARY_MODEL || process.env.THREAD_TITLE_MODEL || 'openai-codex/gpt-5.4-mini',
    threadTurnStatusTimeoutMs: Number(process.env.THREAD_TURN_STATUS_TIMEOUT_MS || 15000),
    threadNextStepsModel: process.env.THREAD_NEXT_STEPS_MODEL || process.env.THREAD_SUMMARY_MODEL || process.env.THREAD_TITLE_MODEL || 'openai-codex/gpt-5.4-mini',
    threadNextStepsTimeoutMs: Number(process.env.THREAD_NEXT_STEPS_TIMEOUT_MS || 15000),
    workspaceLaunchSuggestionsModel: process.env.WORKSPACE_LAUNCH_SUGGESTIONS_MODEL || process.env.THREAD_NEXT_STEPS_MODEL || process.env.THREAD_SUMMARY_MODEL || process.env.THREAD_TITLE_MODEL || 'openai-codex/gpt-5.4-mini',
    workspaceLaunchSuggestionsTimeoutMs: Number(process.env.WORKSPACE_LAUNCH_SUGGESTIONS_TIMEOUT_MS || process.env.THREAD_NEXT_STEPS_TIMEOUT_MS || 15000),
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
