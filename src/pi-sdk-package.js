import { existsSync } from 'node:fs';
import path from 'node:path';

const PI_PACKAGE_PARTS = ['node_modules', '@earendil-works', 'pi-coding-agent'];

function hasPiSdkEntry(packageDir) {
  return existsSync(path.join(packageDir, 'dist', 'index.js'));
}

export function resolvePiSdkPackageDir({ cwd = process.cwd(), execPath = process.execPath } = {}) {
  const bundledPackageDir = path.join(cwd, ...PI_PACKAGE_PARTS);
  if (hasPiSdkEntry(bundledPackageDir)) return bundledPackageDir;

  const nodePrefix = path.resolve(path.dirname(execPath), '..');
  return path.join(nodePrefix, 'lib', ...PI_PACKAGE_PARTS);
}
