import { createHash } from 'node:crypto';
import path from 'node:path';

import { d1StateRequested, readD1Kv, writeD1Kv } from './d1-state.js';
import { getStoredSession, listStoredSessions } from './store.js';

function shellQuote(value) {
  const escaped = String(value).replace(/'/g, `'\\''`);
  return `'${escaped}'`;
}

function slugify(value, fallback = 'workspace') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40) || fallback;
}

function hash(value, length = 16) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function repoLeaf(repoUrl) {
  const text = String(repoUrl || '').replace(/\/+$/, '');
  const leaf = text.split('/').pop() || 'repo';
  return leaf.replace(/\.git$/i, '');
}

export function normalizeWorkspaceRepoUrl(repoUrl) {
  const text = String(repoUrl || '').trim();
  if (!text) return '';

  try {
    const url = new URL(text);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
    if (url.hostname === 'github.com') url.pathname = url.pathname.toLowerCase();
    return url.toString().replace(/\/$/, '').replace(/\.git$/i, '');
  } catch {
    return text.replace(/\/+$/, '').replace(/\.git$/i, '');
  }
}

export function buildWorkspaceIdentity({ ownerUserId, repoUrl }) {
  const owner = String(ownerUserId || '').trim();
  const normalizedRepoUrl = normalizeWorkspaceRepoUrl(repoUrl);
  if (!owner) throw new Error('Workspace mode requires a signed-in user.');
  if (!normalizedRepoUrl) throw new Error('Workspace mode requires a repository URL.');

  const repoHash = hash(normalizedRepoUrl, 16);
  const workspaceHash = hash(`${owner}\n${normalizedRepoUrl}`, 16);
  return {
    ownerUserId: owner,
    repoUrl: normalizedRepoUrl,
    repoHash,
    workspaceKey: `ws:${workspaceHash}`,
    workspaceName: `ws-${slugify(repoLeaf(normalizedRepoUrl))}-${workspaceHash.slice(0, 8)}`,
    indexKey: `workspace:index:${hash(owner, 12)}:${repoHash}`,
  };
}

export function workspacePaths(config, threadName = '') {
  const root = String(config.remoteWorkspaceDir || '/workspace').replace(/\/+$/, '');
  const safeThread = slugify(threadName, 'thread');
  return {
    root,
    main: `${root}/main`,
    tasks: `${root}/tasks`,
    task: `${root}/tasks/${safeThread}`,
  };
}

export function workspaceRemotePatch(workspace = {}) {
  return {
    bridgeUrl: workspace.bridgeUrl || workspace.httpsUrl || '',
    httpsUrl: workspace.httpsUrl || workspace.bridgeUrl || '',
    previewToken: workspace.previewToken || null,
    bridgeToken: workspace.bridgeToken || '',
    connectCommand: workspace.connectCommand || null,
    runAgentCommand: workspace.runAgentCommand || null,
    tailLogCommand: workspace.tailLogCommand || null,
    sandboxId: workspace.sandboxId || workspace.cloudflareSandboxId || null,
    cloudflareSandboxId: workspace.cloudflareSandboxId || workspace.sandboxId || null,
    cloudflareSandboxName: workspace.cloudflareSandboxName || null,
    cloudflareState: workspace.cloudflareState || null,
  };
}

export function buildWorkspaceSession(session, config, identity = buildWorkspaceIdentity(session)) {
  const paths = workspacePaths(config);
  return {
    name: identity.workspaceName,
    repoUrl: session.repoUrl,
    repoMode: session.repoMode || 'git',
    repoSource: session.repoSource || '',
    repoProvider: session.repoProvider || '',
    repoFullName: session.repoFullName || '',
    branch: session.branch || '',
    taskPrompt: '',
    visibility: 'public',
    sharePort: config.bridgePort,
    autoRunAgent: false,
    bridgeMode: true,
    bridgeClaimed: false,
    threadBridge: false,
    workspaceBridge: true,
    workspaceKey: identity.workspaceKey,
    workspaceRepoHash: identity.repoHash,
    ownerUserId: identity.ownerUserId,
    remoteWorkspaceDir: paths.root,
    remoteWorkspaceMainDir: paths.main,
    remoteWorkspaceTasksDir: paths.tasks,
  };
}

function validWorkspaceSession(session, identity) {
  return Boolean(
    session?.workspaceBridge &&
    session.workspaceKey === identity.workspaceKey &&
    session.ownerUserId === identity.ownerUserId,
  );
}

export async function findWorkspaceSession(config, identity) {
  if (d1StateRequested()) {
    const indexedName = await readD1Kv(identity.indexKey, '');
    if (indexedName) {
      const indexed = await getStoredSession(config.sessionFile, indexedName);
      if (validWorkspaceSession(indexed, identity)) return indexed;
    }
  }

  const sessions = await listStoredSessions(config.sessionFile);
  return sessions.find((session) => validWorkspaceSession(session, identity)) || null;
}

export async function saveWorkspaceIndex(identity, session) {
  if (!d1StateRequested()) return;
  await writeD1Kv(identity.indexKey, session.name);
}

export function buildWorktreeScript(session, config) {
  const paths = workspacePaths(config, session.name);
  const branch = String(session.branch || '').trim();
  const gitPrefix = session.repoAuthHeader ? `git -c ${shellQuote(`http.extraHeader=${session.repoAuthHeader}`)}` : 'git';
  const baseRef = branch ? `origin/${branch}` : 'HEAD';

  return [
    'set -euo pipefail',
    'export GIT_TERMINAL_PROMPT=0',
    `MAIN_DIR=${shellQuote(paths.main)}`,
    `TASK_DIR=${shellQuote(paths.task)}`,
    `BASE_REF=${shellQuote(baseRef)}`,
    'mkdir -p "$(dirname "$TASK_DIR")"',
    'test -d "$MAIN_DIR/.git" || { echo "workspace main checkout is missing" >&2; exit 1; }',
    'cd "$MAIN_DIR"',
    branch
      ? `${gitPrefix} fetch --prune origin ${shellQuote(branch)} || true`
      : `${gitPrefix} fetch --prune origin || true`,
    'git rev-parse --verify "$BASE_REF" >/dev/null 2>&1 || BASE_REF=HEAD',
    'git worktree prune || true',
    'if [ -e "$TASK_DIR/.git" ] || [ -f "$TASK_DIR/.git" ]; then exit 0; fi',
    'if [ -e "$TASK_DIR" ]; then rm -rf "$TASK_DIR"; fi',
    'git worktree add -f --detach "$TASK_DIR" "$BASE_REF"',
  ].join('\n');
}

export function assertWorkspaceCwd(cwd, root) {
  const workspaceRoot = path.posix.resolve(String(root || '/workspace'));
  const resolved = path.posix.resolve(String(cwd || workspaceRoot));
  if (resolved !== workspaceRoot && !resolved.startsWith(`${workspaceRoot}/`)) {
    throw new Error('Run cwd must stay inside the workspace root.');
  }
  return resolved;
}
