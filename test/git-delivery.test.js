import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGitDeliveryScript,
  createDraftPullRequestForThread,
  normalizeGitDeliveryFiles,
} from '../src/git-delivery.js';

test('git delivery normalizes tracked paths under the thread worktree', () => {
  assert.deepEqual(normalizeGitDeliveryFiles([
    { path: '/srv/workspace/tasks/thread/src/app.js' },
    { path: '/srv/workspace/main/package.json' },
    { path: './docs/guide.md' },
    { path: '../escape.js' },
    { path: '.git/config' },
    { path: 'docs/guide.md' },
  ], '/srv/workspace/tasks/thread'), ['src/app.js', 'docs/guide.md']);
});

test('git delivery script stages explicit files, not the whole worktree', () => {
  const script = buildGitDeliveryScript({
    cwd: '/srv/workspace/tasks/thread',
    files: ['src/app.js', 'docs/file with spaces.md'],
    branch: 'workbench/thread-1234abcd',
    commitMessage: "Fix user's bug",
    authHeader: 'AUTHORIZATION: basic abc123',
  });

  assert.match(script, /git add -- "\$\{FILES\[@\]\}"/);
  assert.doesNotMatch(script, /git add -A/);
  assert.match(script, /git status --porcelain -- "\$\{FILES\[@\]\}"/);
  assert.match(script, /http\.extraHeader=AUTHORIZATION: basic abc123/);
  assert.match(script, /push --force-with-lease origin "HEAD:refs\/heads\/\$BRANCH"/);
});

test('draft PR delivery pushes with one-shot auth and creates a GitHub draft PR', async () => {
  const originalFetch = global.fetch;
  const scripts = [];
  let request;

  global.fetch = async (url, options = {}) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      number: 12,
      html_url: 'https://github.com/acme/site/pull/12',
      url: 'https://api.github.com/repos/acme/site/pulls/12',
      title: request.body.title,
      state: 'open',
      draft: true,
      head: { ref: request.body.head },
      base: { ref: request.body.base },
    }), { status: 201, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await createDraftPullRequestForThread({
      session: {
        name: 'Fix Login',
        title: 'Fix login flow',
        repoUrl: 'https://github.com/acme/site.git',
        branch: 'main',
        remoteWorkspaceDir: '/srv/workspace/tasks/fix-login',
      },
      provider: {
        async runRemoteScript(_session, script) {
          scripts.push(script);
          return { stdout: '__WORKBENCH_GIT_DELIVERY__{"noChanges":false,"branch":"workbench/fix-login-abc12345","commit":"abc123"}\n' };
        },
      },
      token: 'secret-token',
      changes: [{ path: '/srv/workspace/tasks/fix-login/src/login.js' }],
    });

    assert.equal(result.pullRequest.url, 'https://github.com/acme/site/pull/12');
    assert.deepEqual(result.files, ['src/login.js']);
    assert.equal(request.url, 'https://api.github.com/repos/acme/site/pulls');
    assert.equal(request.options.headers.authorization, 'Bearer secret-token');
    assert.equal(request.body.draft, true);
    assert.equal(request.body.base, 'main');
    assert.match(request.body.head, /^workbench\/fix-login-/);
    assert.match(scripts[0], /http\.extraHeader=AUTHORIZATION: basic/);
    assert.doesNotMatch(scripts[0], /git add -A/);
  } finally {
    global.fetch = originalFetch;
  }
});
