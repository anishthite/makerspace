import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    mergeTrackedChanges: (...groups) => groups.flat().filter(Boolean),
  };
}

test('ready bridge reuse syncs current Codex auth before running', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-bridge-auth-'));
  const previousFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), body: JSON.parse(String(options.body || '{}')) });
    return new Response('{"ok":true}\n', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const config = {
      rootDir: root,
      sessionFile: path.join(root, 'sessions.json'),
      settingsFile: path.join(root, 'settings.json'),
      authFile: path.join(root, 'auth.json'),
      piDefaultsPackageDir: path.join(root, 'missing-defaults'),
      remoteWorkspaceDir: '/srv/workspace',
      bridgePort: 4310,
      bridgeReadyTimeoutMs: 1000,
      bridgeReadyPollMs: 10,
    };
    await writeFile(config.settingsFile, '{}\n');
    const bridge = createBridgeService({
      config,
      provider: {
        kind: 'test',
        shouldRefreshSession: () => false,
        bridgeHeaders: () => ({}),
        info: () => ({ kind: 'test' }),
      },
      auth: {
        readPiAuthForSession: async (session) => `auth-for-${session.ownerUserId}`,
        readLocalPiSettings: async () => null,
        readGitHubAuthForSession: async (session) => ({
          token: `github-for-${session.ownerUserId}`,
          login: 'octo',
          name: 'Octo Cat',
          email: 'octo@example.test',
        }),
      },
      runState: runStateStub(),
    });

    const session = {
      name: 'thread-a',
      bridgeUrl: 'https://bridge.example',
      bridgeToken: 'secret',
      ownerUserId: 'github-1',
    };

    assert.equal(await bridge.refreshBridgeSessionIfNeeded(session), session);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://bridge.example/auth');
    assert.equal(requests[0].body.authText, 'auth-for-github-1');
    assert.deepEqual(requests[0].body.github, {
      token: 'github-for-github-1',
      login: 'octo',
      name: 'Octo Cat',
      email: 'octo@example.test',
    });
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});
