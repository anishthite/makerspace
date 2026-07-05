import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { listRecentProjects, MAX_RECENT_PROJECTS, saveRecentProject } from '../src/recent-projects.js';

async function withStore(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workbench-recents-'));
  try {
    return await fn(path.join(dir, 'recent-projects.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('saveRecentProject persists de-duped recents on disk', async () => {
  await withStore(async (filePath) => {
    assert.deepEqual(await listRecentProjects(filePath), []);

    await saveRecentProject(filePath, { kind: 'git', value: 'github.com/acme/site', label: 'Site', branch: 'main' });
    await saveRecentProject(filePath, { kind: 'local', value: '/tmp/site/' });
    const projects = await saveRecentProject(filePath, { kind: 'git', value: 'https://github.com/acme/site.git', label: 'Site again' });

    assert.equal(projects.length, 2);
    assert.equal(projects[0].value, 'https://github.com/acme/site.git');
    assert.equal(projects[0].label, 'Site again');
    assert.equal(projects[1].value, '/tmp/site');
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), projects);
  });
});

test('saveRecentProject keeps only the newest eight projects', async () => {
  await withStore(async (filePath) => {
    for (let index = 0; index < MAX_RECENT_PROJECTS + 2; index += 1) {
      await saveRecentProject(filePath, { value: `owner/repo-${index}` });
    }

    const projects = await listRecentProjects(filePath);
    assert.equal(projects.length, MAX_RECENT_PROJECTS);
    assert.equal(projects[0].value, `https://github.com/owner/repo-${MAX_RECENT_PROJECTS + 1}.git`);
    assert.equal(projects.at(-1).value, 'https://github.com/owner/repo-2.git');
  });
});
