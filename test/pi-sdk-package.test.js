import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolvePiSdkPackageDir } from '../src/pi-sdk-package.js';

const packageParts = ['node_modules', '@earendil-works', 'pi-coding-agent'];

test('resolvePiSdkPackageDir prefers the bundled app node_modules package', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spanner-pi-sdk-'));
  const packageDir = path.join(dir, ...packageParts);

  try {
    await mkdir(path.join(packageDir, 'dist'), { recursive: true });
    await writeFile(path.join(packageDir, 'dist', 'index.js'), 'export {}\n');

    assert.equal(
      resolvePiSdkPackageDir({ cwd: dir, execPath: '/Applications/Spanner.app/Contents/MacOS/Spanner' }),
      packageDir,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolvePiSdkPackageDir falls back to a node global package path', () => {
  assert.equal(
    resolvePiSdkPackageDir({ cwd: '/definitely/missing/spanner', execPath: '/opt/node/bin/node' }),
    path.join('/opt/node/lib', ...packageParts),
  );
});
