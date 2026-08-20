import test from 'node:test';
import assert from 'node:assert/strict';

import { appendThreadMessages, decorateSession, normalizeChatRequest, normalizeClientId, normalizeCreateRequest, normalizeImageAttachments, normalizeModelOptions, normalizeThreadRequest, threadMessage } from '../src/session.js';

const config = {
  defaultTaskPrompt: 'Inspect the repo and do the task.',
  remoteControlDir: '/srv/spanner',
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
  assert.equal(session.modelRef, '');
  assert.equal(session.thinkingLevel, '');
  assert.match(session.name, /^blank-repo-\d{14}-[a-f0-9]{6}$/);
});

test('normalizeChatRequest preserves image attachments', () => {
  const session = normalizeChatRequest(
    {
      prompt: 'Describe this.',
      images: [{ type: 'image', mimeType: 'image/png', data: Buffer.from('png').toString('base64') }],
    },
    config,
  );

  assert.deepEqual(session.images, [{ type: 'image', mimeType: 'image/png', data: 'cG5n' }]);
});

test('normalizeImageAttachments rejects unsupported images', () => {
  assert.throws(
    () => normalizeImageAttachments([{ type: 'image', mimeType: 'image/svg+xml', data: 'PHN2Zz4=' }]),
    /PNG, JPEG, GIF, or WebP/,
  );
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
      modelRef: 'openai-codex/gpt-5.4-mini',
      thinkingLevel: 'high',
    },
    config,
  );

  assert.equal(session.repoMode, 'git');
  assert.equal(session.repoUrl, 'https://github.com/acme/demo.git');
  assert.equal(session.branch, 'main');
  assert.equal(session.taskPrompt, 'Start here.');
  assert.equal(session.initialPrompt, 'Start here.');
  assert.equal(session.deliveryMode, 'draft-pr');
  assert.equal(session.modelRef, 'openai-codex/gpt-5.4-mini');
  assert.equal(session.thinkingLevel, 'high');
  assert.equal(session.repoSource, 'github');
  assert.equal(session.bridgeMode, true);
  assert.equal(session.threadBridge, true);
  assert.equal(session.bridgeClaimed, true);
  assert.equal(session.sharePort, 4310);
  assert.match(session.name, /^demo-\d{14}-[a-f0-9]{6}$/);
});

test('normalizeThreadRequest preserves a local repo path', () => {
  const session = normalizeThreadRequest(
    {
      repoPath: '/Users/me/project',
      prompt: 'Run locally.',
    },
    config,
  );

  assert.equal(session.repoMode, 'local');
  assert.equal(session.repoPath, '/Users/me/project');
  assert.equal(session.repoUrl, '');
  assert.equal(session.taskPrompt, 'Run locally.');
  assert.equal(session.initialPrompt, 'Run locally.');
  assert.equal(session.localMode, true);
  assert.equal(session.bridgeMode, undefined);
  assert.equal(session.threadBridge, true);
  assert.match(session.name, /^project-\d{14}-[a-f0-9]{6}$/);
});

test('normalizeThreadRequest preserves clicked workspace reuse metadata', () => {
  const session = normalizeThreadRequest(
    {
      repoPath: '/Users/me/project/.worktrees/sidebar-fix',
      sourceRepoPath: '/Users/me/project',
      worktreePath: '/Users/me/project/.worktrees/sidebar-fix',
      reuseRepoPath: true,
      prompt: 'Run in this workspace.',
    },
    config,
  );

  assert.equal(session.repoPath, '/Users/me/project/.worktrees/sidebar-fix');
  assert.equal(session.sourceRepoPath, '/Users/me/project');
  assert.equal(session.worktreePath, '/Users/me/project/.worktrees/sidebar-fix');
  assert.equal(session.localWorktree, true);
  assert.equal(session.reuseRepoPath, true);
});

test('normalizeThreadRequest makes new-worktree intent win over stale reuse metadata', () => {
  const session = normalizeThreadRequest(
    {
      repoPath: '/Users/me/project',
      sourceRepoPath: '/Users/me/project',
      worktreePath: '/Users/me/project/.worktrees/sidebar-fix',
      reuseRepoPath: true,
      newWorktree: true,
      prompt: 'Start fresh.',
    },
    config,
  );

  assert.equal(session.sourceRepoPath, '/Users/me/project');
  assert.equal(session.worktreePath, undefined);
  assert.equal(session.reuseRepoPath, undefined);
});

test('normalizeModelOptions rejects invalid thinking levels', () => {
  assert.throws(() => normalizeModelOptions({ thinkingLevel: 'maximum' }), /Thinking level/);
});

test('appendThreadMessages keeps bounded user and assistant history', () => {
  const session = { threadMessages: [threadMessage('user', 'old', 1, 'a')] };
  const next = appendThreadMessages(session, [
    threadMessage('assistant', 'done', 2, 'a'),
    { role: 'tool', text: 'ignored' },
    null,
  ]);

  assert.deepEqual(next, [
    { role: 'user', text: 'old', timestamp: '1970-01-01T00:00:00.001Z', runId: 'a' },
    { role: 'assistant', text: 'done', timestamp: '1970-01-01T00:00:00.002Z', runId: 'a' },
  ]);
});

test('threadMessage preserves image attachments for chat history', () => {
  const image = { type: 'image', mimeType: 'image/png', data: Buffer.from('png').toString('base64') };
  assert.deepEqual(threadMessage('user', 'see this', 1, 'a', [image]), {
    role: 'user',
    text: 'see this',
    timestamp: '1970-01-01T00:00:00.001Z',
    runId: 'a',
    images: [{ type: 'image', mimeType: 'image/png', data: 'cG5n' }],
  });
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
      connectCommand: 'cloudflare sandbox shell sandbox-123',
      runAgentCommand: 'cloudflare sandbox exec sandbox-123 -- bash /srv/spanner/run-pi.sh',
      tailLogCommand: 'cloudflare sandbox exec sandbox-123 -- tail -n 120 /srv/spanner/pi.log',
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
  assert.equal(session.images, undefined);
  assert.equal(session.hasBridgeToken, true);
  assert.equal(session.commands.connect, 'cloudflare sandbox shell sandbox-123');
  assert.equal(session.commands.runAgent, 'cloudflare sandbox exec sandbox-123 -- bash /srv/spanner/run-pi.sh');
  assert.equal(session.commands.tailLog, 'cloudflare sandbox exec sandbox-123 -- tail -n 120 /srv/spanner/pi.log');
});
