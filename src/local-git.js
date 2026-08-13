import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { parseGitHubRepoUrl } from './github.js';

function safePathSegment(value, fallback = 'repo') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function safeBranchSegment(value, fallback = 'thread') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48) || fallback;
}

function repoHash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

function repoLeaf(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  const leaf = text.split(/[/:]/).filter(Boolean).pop() || 'repo';
  return safePathSegment(leaf.replace(/\.git$/i, ''), 'repo');
}

function remoteBranchName(value) {
  let branch = String(value || '').trim();
  branch = branch.replace(/^refs\/remotes\/origin\//, '').replace(/^refs\/heads\//, '').replace(/^origin\//, '');
  if (!branch || branch.length > 200 || branch.includes('..') || branch.includes('//') || branch.includes(':')) return '';
  if (branch.startsWith('/') || branch.endsWith('/') || branch.startsWith('-')) return '';
  return /^[A-Za-z0-9._/-]+$/.test(branch) ? branch : '';
}

export function localGitRepoPath(session = {}, config = {}) {
  const repoUrl = String(session.repoUrl || '').trim();
  if (!repoUrl) throw new Error('GitHub repo URL is required.');

  const root = config.localGitReposDir || path.join(config.localDataDir || config.rootDir || process.cwd(), 'repos');
  const parsed = parseGitHubRepoUrl(repoUrl);
  if (parsed) {
    return path.join(root, 'github', safePathSegment(parsed.owner, 'owner'), safePathSegment(parsed.repo, 'repo'));
  }

  return path.join(root, 'git', `${repoLeaf(repoUrl)}-${repoHash(repoUrl)}`);
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function gitArgs(args, repoAuthHeader = '') {
  const header = String(repoAuthHeader || '').trim();
  return header ? ['-c', `http.extraHeader=${header}`, ...args] : args;
}

function redactedGitArgs(args) {
  return args.map((arg, index) => args[index - 1] === '-c' && String(arg).startsWith('http.extraHeader=')
    ? 'http.extraHeader=<redacted>'
    : arg);
}

async function runGit(args, { repoAuthHeader = '', cwd = process.cwd() } = {}) {
  const finalArgs = gitArgs(args, repoAuthHeader);
  return await new Promise((resolve, reject) => {
    const child = spawn('git', finalArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = (stderr || stdout || '').trim().split('\n').slice(-4).join('\n');
      reject(new Error(`git ${redactedGitArgs(finalArgs).join(' ')} failed${detail ? `: ${detail}` : ''}`));
    });
  });
}

async function fetchRemoteBranch(repoPath, baseName, repoAuthHeader = '') {
  const branch = remoteBranchName(baseName);
  if (!branch) return false;
  try {
    await runGit(
      ['-C', repoPath, 'fetch', '--prune', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`],
      { repoAuthHeader },
    );
    return true;
  } catch {
    return false;
  }
}

async function updateExistingRepo(repoPath, session) {
  const branch = String(session.branch || '').trim();
  await runGit(['-C', repoPath, 'remote', 'set-url', 'origin', session.repoUrl]);
  if (branch && await fetchRemoteBranch(repoPath, branch, session.repoAuthHeader)) return repoPath;
  await runGit(['-C', repoPath, 'fetch', '--prune', 'origin'], { repoAuthHeader: session.repoAuthHeader });
  return repoPath;
}

async function cloneRepo(repoPath, session) {
  const branch = String(session.branch || '').trim();
  const cloneArgs = [
    'clone',
    '--depth=1',
    ...(branch ? ['--branch', branch] : []),
    session.repoUrl,
    repoPath,
  ];
  const plainCloneArgs = ['clone', '--depth=1', session.repoUrl, repoPath];

  try {
    await runGit(cloneArgs, { repoAuthHeader: session.repoAuthHeader });
  } catch (error) {
    if (!branch) throw error;
    await rm(repoPath, { recursive: true, force: true });
    await runGit(plainCloneArgs, { repoAuthHeader: session.repoAuthHeader });
  }

  return repoPath;
}

async function gitTopLevel(repoPath) {
  const { stdout } = await runGit(['-C', repoPath, 'rev-parse', '--show-toplevel']);
  return path.resolve(stdout.trim());
}

async function hasOriginRemote(gitRoot) {
  try {
    await runGit(['-C', gitRoot, 'remote', 'get-url', 'origin']);
    return true;
  } catch {
    return false;
  }
}

async function verifyGitRef(gitRoot, ref) {
  try {
    await runGit(['-C', gitRoot, 'rev-parse', '--verify', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function resolveBaseRef(gitRoot, baseName, hasOrigin) {
  const candidates = [...new Set([
    ...(hasOrigin && !baseName.startsWith('origin/') ? [`origin/${baseName}`] : []),
    baseName,
    'HEAD',
  ].filter(Boolean))];

  for (const candidate of candidates) {
    if (await verifyGitRef(gitRoot, candidate)) return candidate;
  }
  return 'HEAD';
}

function configuredWorktreeRoot(gitRoot, config = {}) {
  const configured = String(config.localWorktreeDir || process.env.SPANNER_WORKTREE_DIR || '').trim();
  if (configured) return path.isAbsolute(configured) ? configured : path.resolve(gitRoot, configured);

  const baseDir = String(config.localWorktreeBaseDir || process.env.SPANNER_WORKTREE_BASE_DIR || path.join(homedir(), 'spanner')).trim();
  const resolvedBase = path.isAbsolute(baseDir) ? baseDir : path.resolve(gitRoot, baseDir);
  return path.join(resolvedBase, safePathSegment(path.basename(gitRoot), 'repo'));
}

async function isGitCheckout(filePath) {
  return exists(path.join(filePath, '.git'));
}

export async function ensureLocalGitRepo(session = {}, config = {}) {
  if (session.repoMode !== 'git' || !session.repoUrl) throw new Error('A git repo URL is required for local GitHub launch.');

  const repoPath = localGitRepoPath(session, config);
  const gitPath = path.join(repoPath, '.git');
  if (await exists(gitPath)) return updateExistingRepo(repoPath, session);
  if (await exists(repoPath)) throw new Error(`${repoPath} exists but is not a git repository.`);

  await mkdir(path.dirname(repoPath), { recursive: true });
  return cloneRepo(repoPath, session);
}

export async function ensureLocalGitWorktree(session = {}, config = {}) {
  const sourceInput = String(session.sourceRepoPath || session.repoPath || '').trim();
  if (!sourceInput) throw new Error('A source Git checkout is required for local worktrees.');

  const sourceRepoPath = await gitTopLevel(sourceInput);
  const baseName = String(session.branch || 'main').trim() || 'main';
  const threadName = safePathSegment(session.name || session.title || 'thread', 'thread');
  const branchSlug = safeBranchSegment(session.name || session.title || threadName, 'thread');
  const worktreeBranch = `spanner/${branchSlug}-${repoHash(session.name || sourceRepoPath).slice(0, 8)}`;
  const worktreeRoot = configuredWorktreeRoot(sourceRepoPath, config);
  const worktreePath = path.join(worktreeRoot, threadName);
  const origin = await hasOriginRemote(sourceRepoPath);

  if (origin) await fetchRemoteBranch(sourceRepoPath, baseName, session.repoAuthHeader);
  const worktreeBaseRef = await resolveBaseRef(sourceRepoPath, baseName, origin);

  await mkdir(worktreeRoot, { recursive: true });
  await runGit(['-C', sourceRepoPath, 'worktree', 'prune']).catch(() => {});

  if (await isGitCheckout(worktreePath)) {
    return { sourceRepoPath, worktreePath, worktreeBaseRef, worktreeBranch, localWorktree: true };
  }
  if (await exists(worktreePath)) throw new Error(`${worktreePath} exists but is not a git worktree.`);

  await runGit(['-C', sourceRepoPath, 'worktree', 'add', '-B', worktreeBranch, worktreePath, worktreeBaseRef]);
  return { sourceRepoPath, worktreePath, worktreeBaseRef, worktreeBranch, localWorktree: true };
}

function managedLocalWorktree(session = {}) {
  if (!session.localMode || !session.localWorktree || session.reuseRepoPath) return null;
  const sourceInput = String(session.sourceRepoPath || '').trim();
  const worktreePath = String(session.worktreePath || '').trim();
  if (!sourceInput || !worktreePath) return null;
  if (path.resolve(sourceInput) === path.resolve(worktreePath)) return null;
  return { sourceInput, worktreePath };
}

async function latestStashRef(sourceRepoPath) {
  const { stdout } = await runGit(['-C', sourceRepoPath, 'stash', 'list', '-n', '1', '--format=%H']);
  return stdout.trim().split('\n')[0] || '';
}

export async function closeLocalGitWorktree(session = {}) {
  const target = managedLocalWorktree(session);
  if (!target) return { closed: false, reason: 'not-managed-local-worktree' };

  const sourceRepoPath = await gitTopLevel(target.sourceInput);
  const worktreePath = target.worktreePath;
  if (path.resolve(sourceRepoPath) === path.resolve(worktreePath)) return { closed: false, reason: 'source-worktree' };
  if (!(await isGitCheckout(worktreePath))) return { closed: false, reason: 'already-closed', sourceRepoPath, worktreePath };

  const { stdout } = await runGit(['-C', worktreePath, 'status', '--porcelain=v1', '--untracked-files=all']);
  const dirty = Boolean(stdout.trim());
  let stashRef = '';
  if (dirty) {
    const before = await latestStashRef(sourceRepoPath).catch(() => '');
    await runGit(['-C', worktreePath, 'stash', 'push', '-u', '-m', `spanner archive ${session.name || path.basename(worktreePath)}`]);
    const after = await latestStashRef(sourceRepoPath).catch(() => '');
    stashRef = after && after !== before ? after : '';
  }

  // ponytail: force only after stashing git-visible state; ignored build outputs are disposable workspace artifacts.
  await runGit(['-C', sourceRepoPath, 'worktree', 'remove', '--force', worktreePath]);
  return { closed: true, dirty, stashRef, sourceRepoPath, worktreePath };
}

export async function restoreLocalGitWorktree(session = {}) {
  const target = managedLocalWorktree(session);
  if (!target) return { restored: false, reason: 'not-managed-local-worktree' };

  const sourceRepoPath = await gitTopLevel(target.sourceInput);
  const worktreePath = target.worktreePath;
  if (await isGitCheckout(worktreePath)) return { restored: false, reason: 'already-open', sourceRepoPath, worktreePath };
  if (await exists(worktreePath)) throw new Error(`${worktreePath} exists but is not a git worktree.`);

  const ref = String(session.worktreeBranch || session.worktreeBaseRef || session.branch || 'HEAD').trim() || 'HEAD';
  await mkdir(path.dirname(worktreePath), { recursive: true });
  await runGit(['-C', sourceRepoPath, 'worktree', 'prune']).catch(() => {});
  await runGit(['-C', sourceRepoPath, 'worktree', 'add', worktreePath, ref]);

  const stashRef = String(session.worktreeArchiveStash || '').trim();
  const stashApplied = Boolean(stashRef && !session.worktreeArchiveStashAppliedAt);
  if (stashApplied) await runGit(['-C', worktreePath, 'stash', 'apply', stashRef]);
  return { restored: true, stashApplied, sourceRepoPath, worktreePath };
}
