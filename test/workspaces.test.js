import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertWorkspaceCwd,
  buildWorkspaceIdentity,
  buildWorkspaceSession,
  buildWorktreeScript,
  workspacePaths,
} from '../src/workspaces.js';

test('workspace identity separates users and normalizes repo URLs', () => {
  const left = buildWorkspaceIdentity({ ownerUserId: 'github-1', repoUrl: 'https://github.com/Acme/Site.git' });
  const same = buildWorkspaceIdentity({ ownerUserId: 'github-1', repoUrl: 'https://github.com/acme/site' });
  const otherUser = buildWorkspaceIdentity({ ownerUserId: 'github-2', repoUrl: 'https://github.com/acme/site' });

  assert.equal(left.workspaceKey, same.workspaceKey);
  assert.equal(left.repoHash, same.repoHash);
  assert.notEqual(left.workspaceKey, otherUser.workspaceKey);
  assert.match(left.workspaceName, /^ws-site-[a-f0-9]{8}$/);
});

test('workspace rows carry owner and durable remote layout', () => {
  const config = { remoteWorkspaceDir: '/srv/workspace', bridgePort: 4310 };
  const identity = buildWorkspaceIdentity({ ownerUserId: 'github-1', repoUrl: 'https://github.com/acme/site' });
  const session = buildWorkspaceSession({ repoUrl: 'https://github.com/acme/site.git', branch: 'main' }, config, identity);

  assert.equal(session.workspaceBridge, true);
  assert.equal(session.ownerUserId, 'github-1');
  assert.equal(session.remoteWorkspaceDir, '/srv/workspace');
  assert.equal(session.remoteWorkspaceMainDir, '/srv/workspace/main');
  assert.equal(session.remoteWorkspaceTasksDir, '/srv/workspace/tasks');
});

test('worktree script creates per-thread task checkout under workspace', () => {
  const script = buildWorktreeScript({
    name: 'Fix Login Bug!',
    branch: 'main',
    repoAuthHeader: 'Authorization: Bearer token',
  }, { remoteWorkspaceDir: '/srv/workspace' });

  assert.match(script, /TASK_DIR='\/srv\/workspace\/tasks\/fix-login-bug'/);
  assert.match(script, /fetch --prune origin 'main'/);
  assert.match(script, /git worktree add -f --detach/);
  assert.match(script, /http\.extraHeader=Authorization: Bearer token/);
});

test('workspace cwd validation stays under root', () => {
  assert.equal(assertWorkspaceCwd('/srv/workspace/tasks/a', '/srv/workspace'), '/srv/workspace/tasks/a');
  assert.equal(assertWorkspaceCwd('', '/srv/workspace'), '/srv/workspace');
  assert.throws(() => assertWorkspaceCwd('/srv/other', '/srv/workspace'), /workspace root/);
});

test('workspacePaths keeps task names filesystem-safe', () => {
  assert.deepEqual(workspacePaths({ remoteWorkspaceDir: '/srv/workspace/' }, '../Bad Thread!!'), {
    root: '/srv/workspace',
    main: '/srv/workspace/main',
    tasks: '/srv/workspace/tasks',
    task: '/srv/workspace/tasks/bad-thread',
  });
});
