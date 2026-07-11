import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createBridgeService } from '../src/server/bridge.js';
import { createSessionService } from '../src/server/sessions.js';

async function waitForValue(fn) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for value.');
}

function runStateStub() {
  const runs = new Map();
  const ensureRunState = (name) => {
    if (!runs.has(name)) runs.set(name, { runStatus: 'unknown', events: [] });
    return runs.get(name);
  };
  return {
    activeRuns: runs,
    ensureRunState,
    setRunState(name, patch) { return Object.assign(ensureRunState(name), patch); },
    resetRunState(name, runStatus) { runs.set(name, { runStatus, events: [] }); return runs.get(name); },
    appendRunOutput() {},
    appendRunStatus() {},
    activeRunResetPatch() { return {}; },
    performancePatchForSession() { return {}; },
    persistRunStatus: async (session) => session,
    persistThreadAssistantMessage: async () => {},
  };
}

test('manual Cloudflare launch uses private clone auth without persisting it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-manual-private-auth-'));
  const sessionFile = path.join(root, 'sessions.json');
  let launched = null;
  try {
    const config = {
      rootDir: root,
      sessionFile,
      settingsFile: path.join(root, 'settings.json'),
      remoteWorkspaceDir: '/srv/workspace',
      remoteControlDir: '/srv/spanner',
      bridgePort: 4310,
    };
    await writeFile(config.settingsFile, '{}\n');
    const sessions = createSessionService({
      config,
      provider: {
        kind: 'test',
        createSession: async (session) => {
          launched = session;
          return { name: session.name, status: 'ready' };
        },
        info: () => ({ kind: 'test' }),
      },
      auth: {
        readLocalPiAuth: async () => null,
        enrichGitHubRepoSession: async (session) => ({ ...session, repoAuthHeader: 'AUTHORIZATION: basic secret' }),
      },
      runState: runStateStub(),
      bridge: {},
    });

    const stored = await sessions.createManualSession({
      name: 'manual-private',
      repoUrl: 'https://github.com/acme/private.git',
    }, null, '', { id: 'github-1' });

    assert.equal(stored.repoAuthHeader, '');
    await waitForValue(() => launched);
    assert.equal(launched.repoAuthHeader, 'AUTHORIZATION: basic secret');
    await waitForValue(async () => JSON.parse(await readFile(sessionFile, 'utf8'))[0]?.status === 'running');
    assert.equal(JSON.parse(await readFile(sessionFile, 'utf8'))[0].repoAuthHeader, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('thread bridge launch strips private clone auth before persisting session', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'spanner-private-auth-'));
  const sessionFile = path.join(root, 'sessions.json');
  try {
    const config = {
      rootDir: root,
      sessionFile,
      settingsFile: path.join(root, 'settings.json'),
      remoteWorkspaceDir: '/srv/workspace',
      remoteControlDir: '/srv/spanner',
      bridgePort: 4310,
      bridgeReadyTimeoutMs: 1000,
      bridgeReadyPollMs: 10,
    };
    await writeFile(config.settingsFile, '{}\n');
    const bridge = createBridgeService({
      config,
      provider: {
        kind: 'test',
        createSession: () => new Promise(() => {}),
        bridgeHeaders: () => ({}),
        info: () => ({ kind: 'test' }),
      },
      auth: {
        readLocalPiAuth: async () => null,
        readLocalPiSettings: async () => null,
      },
      runState: runStateStub(),
    });

    const stored = await bridge.startThreadBridgeLaunch({
      name: 'private-thread',
      repoUrl: 'https://github.com/acme/private.git',
      repoMode: 'git',
      taskPrompt: 'work',
      threadBridge: true,
      bridgeMode: true,
      repoAuthHeader: 'AUTHORIZATION: basic secret',
      ownerUserId: 'github-1',
    }, {});

    assert.equal(stored.repoAuthHeader, '');
    assert.equal(JSON.parse(await readFile(sessionFile, 'utf8'))[0].repoAuthHeader, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
