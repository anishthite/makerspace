import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { ensureLocalGitRepo, ensureLocalGitWorktree, localGitRepoPath } from '../src/local-git.js';

const execFileAsync = promisify(execFile);

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

test('ensureLocalGitRepo clones and fetches GitHub repos under local state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-local-git-'));
  const binDir = path.join(root, 'bin');
  const logPath = path.join(root, 'git.log');
  const gitPath = path.join(binDir, 'git');
  const previousPath = process.env.PATH;
  const previousLog = process.env.SPANNER_FAKE_GIT_LOG;

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(gitPath, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SPANNER_FAKE_GIT_LOG, JSON.stringify(args) + '\\n');
if (args.includes('clone')) fs.mkdirSync(path.join(args.at(-1), '.git'), { recursive: true });
process.exit(0);
`);
    await chmod(gitPath, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
    process.env.SPANNER_FAKE_GIT_LOG = logPath;

    const session = {
      repoMode: 'git',
      repoUrl: 'https://github.com/Acme/Private.git',
      branch: 'main',
      repoAuthHeader: 'AUTHORIZATION: basic secret',
    };
    const config = { localDataDir: root };
    const expectedPath = path.join(root, 'repos', 'github', 'acme', 'private');

    assert.equal(localGitRepoPath(session, config), expectedPath);
    assert.equal(await ensureLocalGitRepo(session, config), expectedPath);
    assert.equal(await exists(path.join(expectedPath, '.git')), true);

    assert.equal(await ensureLocalGitRepo(session, config), expectedPath);
    const calls = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

    assert.deepEqual(calls[0], [
      '-c',
      'http.extraHeader=AUTHORIZATION: basic secret',
      'clone',
      '--depth=1',
      '--branch',
      'main',
      'https://github.com/Acme/Private.git',
      expectedPath,
    ]);
    assert.deepEqual(calls[1], ['-C', expectedPath, 'remote', 'set-url', 'origin', 'https://github.com/Acme/Private.git']);
    assert.deepEqual(calls[2], [
      '-c',
      'http.extraHeader=AUTHORIZATION: basic secret',
      '-C',
      expectedPath,
      'fetch',
      '--prune',
      'origin',
      'refs/heads/main:refs/remotes/origin/main',
    ]);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousLog === undefined) delete process.env.SPANNER_FAKE_GIT_LOG;
    else process.env.SPANNER_FAKE_GIT_LOG = previousLog;
    await rm(root, { recursive: true, force: true });
  }
});

test('ensureLocalGitRepo falls back when a requested branch is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-local-git-fallback-'));
  const binDir = path.join(root, 'bin');
  const logPath = path.join(root, 'git.log');
  const gitPath = path.join(binDir, 'git');
  const repoPath = path.join(root, 'repos', 'github', 'acme', 'legacy');
  const previousPath = process.env.PATH;
  const previousLog = process.env.SPANNER_FAKE_GIT_LOG;

  try {
    await mkdir(path.join(repoPath, '.git'), { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(gitPath, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SPANNER_FAKE_GIT_LOG, JSON.stringify(args) + '\\n');
if (args.includes('fetch') && String(args.at(-1)).includes('refs/heads/main')) process.exit(1);
process.exit(0);
`);
    await chmod(gitPath, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
    process.env.SPANNER_FAKE_GIT_LOG = logPath;

    assert.equal(await ensureLocalGitRepo({ repoMode: 'git', repoUrl: 'https://github.com/acme/legacy.git', branch: 'main' }, { localDataDir: root }), repoPath);
    const calls = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

    assert.deepEqual(calls.at(-2), ['-C', repoPath, 'fetch', '--prune', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
    assert.deepEqual(calls.at(-1), ['-C', repoPath, 'fetch', '--prune', 'origin']);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousLog === undefined) delete process.env.SPANNER_FAKE_GIT_LOG;
    else process.env.SPANNER_FAKE_GIT_LOG = previousLog;
    await rm(root, { recursive: true, force: true });
  }
});

test('ensureLocalGitWorktree fetches requested bases into shallow cached clones', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-real-worktree-'));
  const seed = path.join(root, 'seed');
  const remote = path.join(root, 'origin.git');

  async function git(cwd, args) {
    return execFileAsync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  }

  try {
    await mkdir(seed, { recursive: true });
    await git(seed, ['init', '-q', '-b', 'master']);
    await git(seed, ['config', 'user.email', 'spanner@example.test']);
    await git(seed, ['config', 'user.name', 'Spanner Test']);
    await writeFile(path.join(seed, 'branch.txt'), 'master\n');
    await git(seed, ['add', 'branch.txt']);
    await git(seed, ['commit', '-qm', 'master']);
    await git(seed, ['checkout', '-qb', 'main']);
    await writeFile(path.join(seed, 'branch.txt'), 'main\n');
    await git(seed, ['commit', '-am', 'main', '-q']);
    await git(seed, ['checkout', '-q', 'master']);
    await git(root, ['clone', '--bare', seed, remote]);

    const repoPath = await ensureLocalGitRepo({ repoMode: 'git', repoUrl: `file://${remote}` }, { localDataDir: path.join(root, 'state') });
    const worktreeBase = path.join(root, 'spanner');
    const result = await ensureLocalGitWorktree({ name: 'Use Main', repoPath }, { localWorktreeBaseDir: worktreeBase });

    assert.equal(result.worktreeBaseRef, 'origin/main');
    assert.equal(await readFile(path.join(result.worktreePath, 'branch.txt'), 'utf8'), 'main\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ensureLocalGitWorktree creates per-thread worktrees from main', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-local-worktree-'));
  const source = path.join(root, 'repo');
  const binDir = path.join(root, 'bin');
  const logPath = path.join(root, 'git.log');
  const gitPath = path.join(binDir, 'git');
  const previousPath = process.env.PATH;
  const previousLog = process.env.SPANNER_FAKE_GIT_LOG;
  const previousSource = process.env.SPANNER_FAKE_GIT_SOURCE;

  try {
    await mkdir(path.join(source, '.git', 'info'), { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(gitPath, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const source = process.env.SPANNER_FAKE_GIT_SOURCE;
fs.appendFileSync(process.env.SPANNER_FAKE_GIT_LOG, JSON.stringify(args) + '\\n');
function out(value) { process.stdout.write(value + '\\n'); }
if (args.includes('rev-parse') && args.includes('--show-toplevel')) out(source);
else if (args.includes('remote') && args.includes('get-url')) out('https://github.com/acme/demo.git');
else if (args.includes('rev-parse') && args.includes('--verify')) {
  if (args.at(-1) === 'origin/main^{commit}') out('abc123');
  else process.exit(1);
} else if (args.includes('rev-parse') && args.includes('--git-path')) out(path.join(source, '.git', 'info', 'exclude'));
else if (args.includes('worktree') && args.includes('add')) { fs.mkdirSync(args.at(-2), { recursive: true }); fs.writeFileSync(path.join(args.at(-2), '.git'), 'gitdir: fake'); }
process.exit(0);
`);
    await chmod(gitPath, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
    process.env.SPANNER_FAKE_GIT_LOG = logPath;
    process.env.SPANNER_FAKE_GIT_SOURCE = source;

    const worktreeBase = path.join(root, 'spanner');
    const result = await ensureLocalGitWorktree({ name: 'Fix Login Bug!', repoPath: source }, { localWorktreeBaseDir: worktreeBase });
    const expectedWorktreePath = path.join(worktreeBase, 'repo', 'fix-login-bug');
    const calls = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(result.sourceRepoPath, source);
    assert.equal(result.worktreePath, expectedWorktreePath);
    assert.equal(result.worktreeBaseRef, 'origin/main');
    assert.match(result.worktreeBranch, /^spanner\/fix-login-bug-[a-f0-9]{8}$/);
    assert.equal(result.localWorktree, true);
    assert.equal(await exists(path.join(expectedWorktreePath, '.git')), true);
    assert.deepEqual(calls.find((call) => call.includes('fetch')), ['-C', source, 'fetch', '--prune', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
    assert.deepEqual(calls.find((call) => call.includes('add')), ['-C', source, 'worktree', 'add', '-B', result.worktreeBranch, expectedWorktreePath, 'origin/main']);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousLog === undefined) delete process.env.SPANNER_FAKE_GIT_LOG;
    else process.env.SPANNER_FAKE_GIT_LOG = previousLog;
    if (previousSource === undefined) delete process.env.SPANNER_FAKE_GIT_SOURCE;
    else process.env.SPANNER_FAKE_GIT_SOURCE = previousSource;
    await rm(root, { recursive: true, force: true });
  }
});
