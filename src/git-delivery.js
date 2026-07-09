import { createHash } from 'node:crypto';
import path from 'node:path';

import { buildGitHubCloneAuthHeader, createGitHubPullRequest, parseGitHubRepoUrl } from './github.js';

const RESULT_MARKER = '__SPANNER_GIT_DELIVERY__';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function hash(value, length = 8) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function slugify(value, fallback = 'thread') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48) || fallback;
}

function safeRelativeGitPath(value, remoteCwd = '') {
  const input = String(value || '').trim().replaceAll('\\', '/');
  if (!input || /[\0\r\n]/.test(input) || /^[a-z][a-z0-9+.-]*:/i.test(input) || /[*?[\]{}]/.test(input)) return '';

  let relative = input;
  if (path.posix.isAbsolute(input)) {
    const cwd = path.posix.resolve(String(remoteCwd || '/'));
    const resolved = path.posix.resolve(input);
    if (resolved !== cwd && !resolved.startsWith(`${cwd}/`)) return '';
    relative = path.posix.relative(cwd, resolved);
  }

  const normalized = path.posix.normalize(relative.replace(/^\.\//, ''));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return '';
  if (normalized === '.git' || normalized.startsWith('.git/')) return '';
  return normalized;
}

export function normalizeGitDeliveryFiles(changes = [], remoteCwd = '') {
  const seen = new Set();
  const files = [];
  for (const change of Array.isArray(changes) ? changes : []) {
    const file = safeRelativeGitPath(change?.path || change, remoteCwd);
    if (!file || seen.has(file)) continue;
    seen.add(file);
    files.push(file);
  }
  return files;
}

export function branchNameForThread(session = {}) {
  return `spanner/${slugify(session.name || session.title)}-${hash(session.name || session.repoUrl || 'thread')}`;
}

function safeBranchName(value, fallback) {
  const branch = String(value || '').trim();
  if (!branch || branch.length > 120 || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/') || branch.includes('//')) return fallback;
  return /^[A-Za-z0-9._/-]+$/.test(branch) ? branch : fallback;
}

export function titleForThreadPullRequest(session = {}, options = {}) {
  const explicit = String(options.title || '').trim();
  if (explicit) return explicit.slice(0, 120);
  const title = String(session.title || '').trim();
  if (title) return title.slice(0, 120);
  const prompt = String(session.initialPrompt || session.taskPrompt || '').trim().split(/\r?\n/)[0];
  return (prompt || `Spanner changes for ${session.name || 'thread'}`).slice(0, 120);
}

function commitMessageForThread(session = {}, options = {}) {
  return titleForThreadPullRequest(session, options).replace(/\r/g, '').slice(0, 200);
}

export function bodyForThreadPullRequest(session = {}, files = [], options = {}) {
  const explicit = String(options.body || '').trim();
  if (explicit) return explicit;
  const list = files.map((file) => `- \`${file}\``).join('\n') || '- No tracked files';
  return `Created by Spanner from thread \`${session.name || 'thread'}\`.\n\nStaged files:\n${list}\n`;
}

export function repoPathForThreadPullRequest(session = {}) {
  if (session.repoFullName && String(session.repoFullName).includes('/')) {
    const [owner, repo] = String(session.repoFullName).split('/');
    return { owner, repo };
  }
  return parseGitHubRepoUrl(session.repoUrl);
}

export function buildGitDeliveryScript({ cwd, files, branch, commitMessage, authHeader }) {
  const fileList = files.map((file) => `  ${shellQuote(file)}`).join('\n');
  const extraHeader = `http.extraHeader=${authHeader}`;

  return [
    'set -euo pipefail',
    'export GIT_TERMINAL_PROMPT=0',
    `cd ${shellQuote(cwd)}`,
    'git rev-parse --is-inside-work-tree >/dev/null',
    `BRANCH=${shellQuote(branch)}`,
    `COMMIT_MESSAGE=${shellQuote(commitMessage)}`,
    `FILES=(\n${fileList}\n)`,
    'STATUS=$(git status --porcelain -- "${FILES[@]}")',
    'if [ -z "$STATUS" ]; then',
    `  printf '%s%s\\n' ${shellQuote(RESULT_MARKER)} '{"noChanges":true}'`,
    '  exit 0',
    'fi',
    'git reset -q',
    'git add -- "${FILES[@]}"',
    'if git diff --cached --quiet --; then',
    `  printf '%s%s\\n' ${shellQuote(RESULT_MARKER)} '{"noChanges":true}'`,
    '  exit 0',
    'fi',
    'git -c user.name="Spanner" -c user.email="spanner@users.noreply.github.com" commit -m "$COMMIT_MESSAGE"',
    'COMMIT_SHA=$(git rev-parse HEAD)',
    `git -c ${shellQuote(extraHeader)} push --force-with-lease origin "HEAD:refs/heads/$BRANCH"`,
    `printf '%s' ${shellQuote(RESULT_MARKER)}`,
    `printf '{"noChanges":false,"branch":"%s","commit":"%s"}\\n' "$BRANCH" "$COMMIT_SHA"`,
  ].join('\n');
}

export function parseGitDeliveryScriptResult(result = {}) {
  const output = `${result.stdout || ''}\n${result.output || ''}\n${result.stderr || ''}`;
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith(RESULT_MARKER));
  if (!line) throw new Error('Git delivery did not report a result.');
  return JSON.parse(line.slice(RESULT_MARKER.length));
}

export async function createDraftPullRequestForThread({ session, provider, token, changes, options = {} }) {
  if (!provider?.runRemoteScript) throw new Error('Draft PR delivery requires remote script execution support.');
  if (!token) throw new Error('Reconnect GitHub before creating a pull request.');

  const repo = repoPathForThreadPullRequest(session);
  if (!repo) throw new Error('Draft PR delivery requires a GitHub repository.');

  const cwd = session.remoteWorkspaceDir || session.remoteCwd || '';
  if (!cwd) throw new Error('Draft PR delivery requires a remote worktree path.');
  const files = normalizeGitDeliveryFiles(changes, cwd);
  if (!files.length) return { noChanges: true, files, pullRequest: null };

  const branch = safeBranchName(options.branch || session.prBranch, branchNameForThread(session));
  const title = titleForThreadPullRequest(session, options);
  const body = bodyForThreadPullRequest(session, files, options);
  const base = String(options.base || session.branch || session.repoDefaultBranch || 'main');
  const authHeader = buildGitHubCloneAuthHeader(token);
  const script = buildGitDeliveryScript({
    cwd,
    files,
    branch,
    commitMessage: commitMessageForThread(session, options),
    authHeader,
  });

  const remote = await provider.runRemoteScript(session, script, { timeoutMs: 2 * 60 * 1000 });
  const pushed = parseGitDeliveryScriptResult(remote);
  if (pushed.noChanges) return { noChanges: true, files, branch, pullRequest: null };

  if (session.prUrl && session.prNumber) {
    return {
      noChanges: false,
      files,
      branch,
      commit: pushed.commit || '',
      pullRequest: {
        number: session.prNumber,
        url: session.prUrl,
        title,
        draft: true,
        head: branch,
        base,
      },
      existing: true,
    };
  }

  const pullRequest = await createGitHubPullRequest(token, repo, {
    title,
    head: branch,
    base,
    body,
    draft: options.draft !== false,
  });

  return {
    noChanges: false,
    files,
    branch,
    commit: pushed.commit || '',
    pullRequest,
  };
}
