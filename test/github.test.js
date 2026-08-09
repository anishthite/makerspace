import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { buildGitHubAuthorizeUrl, buildGitHubCloneAuthHeader, GITHUB_OAUTH_SCOPES, listGitHubRepos, parseGitHubRepoUrl } from '../src/github.js';
import { buildGitHubAppInstallUrl, buildGitHubAppJwt, githubRepoOwner } from '../src/github-app.js';

test('GitHub OAuth URL requests workflow scope for remote git writes', () => {
  const url = new URL(buildGitHubAuthorizeUrl({ githubClientId: 'client-id' }, 'https://app.test/callback', 'state-1'));
  assert.equal(url.searchParams.get('scope'), GITHUB_OAUTH_SCOPES.join(' '));
  assert.equal(url.searchParams.get('scope').includes('workflow'), true);
});

test('parseGitHubRepoUrl handles https and ssh forms', () => {
  assert.deepEqual(parseGitHubRepoUrl('https://github.com/acme/demo.git'), { owner: 'acme', repo: 'demo' });
  assert.deepEqual(parseGitHubRepoUrl('git@github.com:acme/demo.git'), { owner: 'acme', repo: 'demo' });
  assert.equal(parseGitHubRepoUrl('https://example.com/acme/demo.git'), null);
});

test('listGitHubRepos keeps paging past the first four pages', async () => {
  const originalFetch = globalThis.fetch;
  const requestedPages = [];
  globalThis.fetch = async (url) => {
    const page = Number(new URL(url).searchParams.get('page') || '1');
    requestedPages.push(page);
    const count = page <= 5 ? 100 : 7;
    const repos = Array.from({ length: count }, (_, index) => ({
      id: page * 1000 + index,
      name: `repo-${page}-${index}`,
      full_name: `acme/repo-${page}-${index}`,
      private: false,
      visibility: 'public',
      clone_url: `https://github.com/acme/repo-${page}-${index}.git`,
      default_branch: 'main',
      owner: { login: 'acme' },
    }));
    return new Response(JSON.stringify(repos), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const repos = await listGitHubRepos('token-1');
    assert.deepEqual(requestedPages, [1, 2, 3, 4, 5, 6]);
    assert.equal(repos.length, 507);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('listGitHubRepos indexes linked pages without an extra probe request', async () => {
  const originalFetch = globalThis.fetch;
  const requestedPages = [];
  globalThis.fetch = async (url) => {
    const page = Number(new URL(url).searchParams.get('page') || '1');
    requestedPages.push(page);
    const repos = Array.from({ length: 100 }, (_, index) => ({
      id: page * 1000 + index,
      name: `repo-${page}-${index}`,
      full_name: `acme/repo-${page}-${index}`,
      private: false,
      visibility: 'public',
      clone_url: `https://github.com/acme/repo-${page}-${index}.git`,
      default_branch: 'main',
      owner: { login: 'acme' },
    }));
    const link = page === 1
      ? '<https://api.github.com/user/repos?sort=updated&per_page=100&page=2>; rel="next", <https://api.github.com/user/repos?sort=updated&per_page=100&page=3>; rel="last"'
      : '';
    return new Response(JSON.stringify(repos), { status: 200, headers: { 'content-type': 'application/json', ...(link ? { link } : {}) } });
  };

  try {
    const repos = await listGitHubRepos('token-1');
    assert.deepEqual(requestedPages, [1, 2, 3]);
    assert.equal(repos.length, 300);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHub App helpers build install URLs and JWTs', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const githubAppPrivateKey = privateKey.export({ type: 'pkcs1', format: 'pem' });
  assert.equal(
    buildGitHubAppInstallUrl({ githubAppId: '123', githubAppSlug: 'spanner-test', githubAppPrivateKey }, 'state-1'),
    'https://github.com/apps/spanner-test/installations/new?state=state-1',
  );
  assert.equal(githubRepoOwner('https://github.com/Acme/demo.git'), 'acme');
  assert.equal(buildGitHubAppJwt({ githubAppId: '123', githubAppPrivateKey }, 1000).split('.').length, 3);
});

test('buildGitHubCloneAuthHeader encodes a basic auth header for git clone', () => {
  assert.equal(
    buildGitHubCloneAuthHeader('secret-token'),
    `AUTHORIZATION: basic ${Buffer.from('x-access-token:secret-token').toString('base64')}`,
  );
});
