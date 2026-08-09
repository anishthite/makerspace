import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureLocalGitRepo, localGitRepoPath } from '../src/local-git.js';

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
      'main',
    ]);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousLog === undefined) delete process.env.SPANNER_FAKE_GIT_LOG;
    else process.env.SPANNER_FAKE_GIT_LOG = previousLog;
    await rm(root, { recursive: true, force: true });
  }
});
