import test from 'node:test';
import assert from 'node:assert/strict';

import { decorateSession, normalizeChatRequest, normalizeClientId, normalizeCreateRequest, normalizeThreadRequest } from '../src/session.js';

const config = {
  defaultTaskPrompt: 'Inspect the repo and do the task.',
  remoteControlDir: '/srv/micro-cloud',
  bridgePort: 4310,
};

test('normalizeCreateRequest defaults blank repo launches sanely', () => {
  const session = normalizeCreateRequest(
    {
      repoUrl: '',
      branch: '',
      taskPrompt: '',
      autoRunAgent: true,
    },
    config,
  );

  assert.equal(session.repoMode, 'empty');
  assert.equal(session.visibility, 'private');
  assert.equal(session.autoRunAgent, true);
  assert.equal(session.taskPrompt, config.defaultTaskPrompt);
  assert.match(session.name, /^blank-repo-\d{14}-[a-f0-9]{6}$/);
});

test('normalizeChatRequest turns a prompt into a private auto-run blank repo session', () => {
  const session = normalizeChatRequest(
    {
      prompt: 'Build the app.',
    },
    config,
  );

  assert.equal(session.repoMode, 'empty');
  assert.equal(session.visibility, 'public');
  assert.equal(session.autoRunAgent, true);
  assert.equal(session.bridgeMode, true);
  assert.equal(session.sharePort, 4310);
  assert.equal(session.taskPrompt, 'Build the app.');
  assert.match(session.name, /^blank-repo-\d{14}-[a-f0-9]{6}$/);
});

test('normalizeChatRequest preserves a browser client id for intent bridge claims', () => {
  const session = normalizeChatRequest(
    {
      prompt: 'Build the app.',
      clientId: 'Browser Client 123',
    },
    config,
  );

  assert.equal(session.clientId, 'browser-client-123');
  assert.equal(normalizeClientId('Browser Client 123'), 'browser-client-123');
});

test('normalizeThreadRequest creates a repo-backed bridge thread with an initial prompt', () => {
  const session = normalizeThreadRequest(
    {
      repoUrl: 'https://github.com/acme/demo.git',
      branch: 'main',
      prompt: 'Start here.',
      repoSource: 'github',
    },
    config,
  );

  assert.equal(session.repoMode, 'git');
  assert.equal(session.repoUrl, 'https://github.com/acme/demo.git');
  assert.equal(session.branch, 'main');
  assert.equal(session.taskPrompt, 'Start here.');
  assert.equal(session.repoSource, 'github');
  assert.equal(session.bridgeMode, true);
  assert.equal(session.threadBridge, true);
  assert.equal(session.bridgeClaimed, true);
  assert.equal(session.sharePort, 4310);
  assert.match(session.name, /^demo-\d{14}-[a-f0-9]{6}$/);
});

test('normalizeCreateRequest avoids collisions for back-to-back generated names', () => {
  const first = normalizeCreateRequest(
    {
      repoUrl: '',
      branch: '',
      taskPrompt: '',
      autoRunAgent: true,
    },
    config,
  );
  const second = normalizeCreateRequest(
    {
      repoUrl: '',
      branch: '',
      taskPrompt: '',
      autoRunAgent: true,
    },
    config,
  );

  assert.notEqual(first.name, second.name);
});

test('decorateSession preserves provider commands and hides bridge secrets', () => {
  const session = decorateSession(
    {
      name: 'hello-agent',
      connectCommand: 'daytona ssh sandbox-123',
      runAgentCommand: 'daytona ssh sandbox-123 -- bash /srv/micro-cloud/run-pi.sh',
      tailLogCommand: 'daytona ssh sandbox-123 -- tail -n 120 /srv/micro-cloud/pi.log',
      bridgeUrl: 'https://preview.example/4310',
      bridgeToken: 'secret-bridge-token',
      previewToken: 'secret-preview-token',
      repoAuthHeader: 'AUTHORIZATION: basic secret',
      githubOwnerSessionId: 'browser-session-1234567890',
    },
    config,
  );

  assert.equal(session.httpsUrl, 'https://preview.example/4310');
  assert.equal(session.bridgeUrl, 'https://preview.example/4310');
  assert.equal(session.bridgeToken, undefined);
  assert.equal(session.previewToken, undefined);
  assert.equal(session.repoAuthHeader, undefined);
  assert.equal(session.githubOwnerSessionId, undefined);
  assert.equal(session.hasBridgeToken, true);
  assert.equal(session.commands.connect, 'daytona ssh sandbox-123');
  assert.equal(session.commands.runAgent, 'daytona ssh sandbox-123 -- bash /srv/micro-cloud/run-pi.sh');
  assert.equal(session.commands.tailLog, 'daytona ssh sandbox-123 -- tail -n 120 /srv/micro-cloud/pi.log');
});
