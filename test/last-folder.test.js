import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { LAST_FOLDER_FILE, readLastFolder, writeLastFolder } from '../desktop/last-folder.js';

test('last local folder persists without clobbering other desktop state', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workbench-folder-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, LAST_FOLDER_FILE);

  assert.equal(readLastFolder(dir), '');
  assert.equal(writeLastFolder(dir, ' /tmp/project '), '/tmp/project');
  assert.equal(readLastFolder(dir), '/tmp/project');

  await writeFile(file, `${JSON.stringify({ theme: 'dark', lastFolder: '/old' })}\n`);
  assert.equal(writeLastFolder(dir, '/new'), '/new');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { theme: 'dark', lastFolder: '/new' });
  assert.equal(writeLastFolder(dir, '   '), '/new');
});
