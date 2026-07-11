import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { piProfileResourceOverrides } from './pi-profile.js';

export const PI_DEFAULTS_PACKAGE_NAME = '@spanner/pi-defaults';
export const REMOTE_PI_DEFAULTS_PACKAGE_DIR = '/home/root/.pi/agent/spanner-pi-defaults';

export function defaultPiDefaultsPackageDir(rootDir = process.cwd()) {
  return path.join(rootDir, 'packages', 'spanner-pi-defaults');
}

export function resolvePiDefaultsPackageDir(config = {}) {
  return config.piDefaultsPackageDir || process.env.SPANNER_PI_DEFAULTS_PACKAGE_DIR || defaultPiDefaultsPackageDir(config.rootDir);
}

export function piDefaultsResourcePaths(packageDir) {
  const dir = String(packageDir || '').trim();
  if (!dir || !existsSync(dir)) return null;

  const extensionsDir = path.join(dir, 'extensions');
  const skillsDir = path.join(dir, 'skills');
  const promptsDir = path.join(dir, 'prompts');

  return {
    packageDir: dir,
    extensionPaths: existsSync(extensionsDir) ? [dir] : [],
    skillPaths: existsSync(skillsDir) ? [skillsDir] : [],
    promptPaths: existsSync(promptsDir) ? [promptsDir] : [],
  };
}

function defaultAgentDir(sdk) {
  return sdk.getAgentDir?.() || path.join(homedir(), '.pi', 'agent');
}

function applyPendingProviderRegistrations(resourceLoader, modelRegistry) {
  const extensionsResult = resourceLoader.getExtensions?.();
  const pending = extensionsResult?.runtime?.pendingProviderRegistrations || [];
  const diagnostics = [];

  for (const { name, config, extensionPath } of pending) {
    try {
      modelRegistry.registerProvider(name, config);
    } catch (error) {
      diagnostics.push({
        type: 'error',
        message: `Extension "${extensionPath}" error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (extensionsResult?.runtime) extensionsResult.runtime.pendingProviderRegistrations = [];
  return diagnostics;
}

function readDefaultsAgentsFile(defaults) {
  if (!defaults) return null;
  const filePath = path.join(defaults.packageDir, 'context', 'AGENTS.md');
  try {
    return { path: filePath, content: readFileSync(filePath, 'utf8') };
  } catch {
    return null;
  }
}

function prependAgentsFile(current, agentsFile) {
  if (!agentsFile) return current;
  const agentsFiles = current.agentsFiles || [];
  const agentsPath = path.resolve(agentsFile.path);
  if (agentsFiles.some((file) => path.resolve(file.path) === agentsPath)) return current;
  return { ...current, agentsFiles: [agentsFile, ...agentsFiles] };
}

export async function createPiResourceOptions(sdk, options = {}) {
  const cwd = options.cwd || process.cwd();
  const agentDir = options.agentDir || defaultAgentDir(sdk);
  const authStorage = options.authStorage || sdk.AuthStorage?.create?.(path.join(agentDir, 'auth.json'));
  const modelRegistry = options.modelRegistry || (authStorage && sdk.ModelRegistry?.create?.(authStorage, path.join(agentDir, 'models.json')));
  const settingsManager = options.settingsManager || sdk.SettingsManager.create(cwd, agentDir);
  const defaults = piDefaultsResourcePaths(options.packageDir);
  const defaultsAgentsFile = readDefaultsAgentsFile(defaults);
  const profileOverrides = piProfileResourceOverrides(options.piProfile);

  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalExtensionPaths: defaults?.extensionPaths || [],
    additionalSkillPaths: defaults?.skillPaths || [],
    additionalPromptTemplatePaths: defaults?.promptPaths || [],
    ...profileOverrides,
    agentsFilesOverride: (current) => prependAgentsFile(profileOverrides.agentsFilesOverride?.(current) || current, defaultsAgentsFile),
  });
  await resourceLoader.reload();

  const diagnostics = modelRegistry ? applyPendingProviderRegistrations(resourceLoader, modelRegistry) : [];

  return {
    ...(authStorage ? { authStorage } : {}),
    ...(modelRegistry ? { modelRegistry } : {}),
    settingsManager,
    resourceLoader,
    defaultsLoaded: Boolean(defaults),
    diagnostics,
  };
}
