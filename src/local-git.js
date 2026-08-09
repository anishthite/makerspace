import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
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

function repoHash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

function repoLeaf(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  const leaf = text.split(/[/:]/).filter(Boolean).pop() || 'repo';
  return safePathSegment(leaf.replace(/\.git$/i, ''), 'repo');
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

async function updateExistingRepo(repoPath, session) {
  const branch = String(session.branch || '').trim();
  await runGit(['-C', repoPath, 'remote', 'set-url', 'origin', session.repoUrl]);
  await runGit(
    ['-C', repoPath, 'fetch', '--prune', 'origin', ...(branch ? [branch] : [])],
    { repoAuthHeader: session.repoAuthHeader },
  );
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

export async function ensureLocalGitRepo(session = {}, config = {}) {
  if (session.repoMode !== 'git' || !session.repoUrl) throw new Error('A git repo URL is required for local GitHub launch.');

  const repoPath = localGitRepoPath(session, config);
  const gitPath = path.join(repoPath, '.git');
  if (await exists(gitPath)) return updateExistingRepo(repoPath, session);
  if (await exists(repoPath)) throw new Error(`${repoPath} exists but is not a git repository.`);

  await mkdir(path.dirname(repoPath), { recursive: true });
  return cloneRepo(repoPath, session);
}
