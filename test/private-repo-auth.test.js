import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createBridgeService } from '../src/server/bridge.js';

function runStateStub() {
  const runs = new Map();
  return {
    activeRuns: runs,
    ensureRunState(name) {
      if (!runs.has(name)) runs.set(name, { runStatus: 'unknown', events: [] });
      return runs.get(name);
    },
    setRunState(name, patch) { return Object.assign(this.ensureRunState(name), patch); },
    resetRunState(name, runStatus) { runs.set(name, { runStatus, events: [] }); return runs.get(name); },
    appendRunOutput() {},
    appendRunStatus() {},
    activeRunResetPatch() { return {}; },
    performancePatchForSession() { return {}; },
    persistRunStatus: async (session) => session,
    persistThreadAssistantMessage: async () => {},
  };
}

test('thread bridge launch strips private clone auth before persisting session', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'makerspace-private-auth-'));
  const sessionFile = path.join(root, 'sessions.json');
  try {
    const config = {
      rootDir: root,
      sessionFile,
      settingsFile: path.join(root, 'settings.json'),
      remoteWorkspaceDir: '/srv/workspace',
      remoteControlDir: '/srv/makerspace',
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
