import os from 'node:os';
import path from 'node:path';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { d1StateRequested, readD1Kv } from './d1-state.js';
import { defaultPiDefaultsPackageDir } from './pi-defaults-package.js';

function dependencyFromNpmSpec(spec) {
  if (!spec) return null;

  if (spec.startsWith('@')) {
    const versionIndex = spec.lastIndexOf('@');
    if (versionIndex > 0) {
      return {
        name: spec.slice(0, versionIndex),
        version: spec.slice(versionIndex + 1) || 'latest',
      };
    }
  }

  const versionIndex = spec.lastIndexOf('@');
  if (versionIndex > 0) {
    return {
      name: spec.slice(0, versionIndex),
      version: spec.slice(versionIndex + 1) || 'latest',
    };
  }

  return { name: spec, version: 'latest' };
}

export function deriveNpmPackageManifest(settingsText) {
  let parsed = {};

  try {
    parsed = JSON.parse(settingsText || '{}');
  } catch {
    parsed = {};
  }

  const dependencies = {};

  for (const entry of Array.isArray(parsed.packages) ? parsed.packages : []) {
    if (typeof entry !== 'string' || !entry.startsWith('npm:')) continue;
    const dependency = dependencyFromNpmSpec(entry.slice(4));
    if (!dependency) continue;
    dependencies[dependency.name] = dependency.version;
  }

  return {
    name: 'makerspace-image-packages',
    private: true,
    dependencies,
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'pipe' });
    const stdout = [];
    const stderr = [];
    const timeoutMs = options.timeoutMs || 30 * 60 * 1000;

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      const out = Buffer.concat(stdout).toString('utf8').trim();
      const err = Buffer.concat(stderr).toString('utf8').trim();

      if (code !== 0) {
        reject(new Error(err || out || `${command} exited with code ${code}`));
        return;
      }

      resolve({ stdout: out, stderr: err });
    });
  });
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(source, destination) {
  if (!(await exists(source))) return false;
  await cp(source, destination, { recursive: true });
  return true;
}

export async function prepareBuildContext(config) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'makerspace-image-'));
  const contextDir = path.join(tempRoot, 'image');

  await cp(config.imageAssetsDir, contextDir, { recursive: true });

  const dockerfilePath = path.join(contextDir, 'Dockerfile');
  const diskDockerfileText = await readFile(dockerfilePath, 'utf8').catch(() => '');
  const dockerfileText = d1StateRequested() ? await readD1Kv('dockerfile', diskDockerfileText) : diskDockerfileText;
  if (dockerfileText !== diskDockerfileText) await writeFile(dockerfilePath, dockerfileText, 'utf8');
  if (!dockerfileText.includes('ctx/')) {
    return { tempRoot, contextDir };
  }

  const ctxDir = path.join(contextDir, 'ctx');
  await mkdir(ctxDir, { recursive: true });

  const defaultsPackageDir = config.piDefaultsPackageDir || defaultPiDefaultsPackageDir(config.rootDir);
  if (!(await copyIfExists(defaultsPackageDir, path.join(ctxDir, 'makerspace-pi-defaults')))) {
    await mkdir(path.join(ctxDir, 'makerspace-pi-defaults'), { recursive: true });
  }

  return {
    tempRoot,
    contextDir,
  };
}

export async function buildAndPushImage(config, imageSettings) {
  if (!imageSettings?.imageRef) {
    throw new Error('Image ref is required to build a custom image.');
  }

  const { tempRoot, contextDir } = await prepareBuildContext(config);

  try {
    await runCommand('docker', [
      'buildx',
      'build',
      '--platform',
      'linux/amd64',
      '-t',
      imageSettings.imageRef,
      '--push',
      contextDir,
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
