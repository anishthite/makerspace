import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { buildGitHubCloneAuthHeader, parseGitHubRepoUrl } from '../src/github.js';
import { buildGitHubAppInstallUrl, buildGitHubAppJwt, githubRepoOwner } from '../src/github-app.js';

test('parseGitHubRepoUrl handles https and ssh forms', () => {
  assert.deepEqual(parseGitHubRepoUrl('https://github.com/acme/demo.git'), { owner: 'acme', repo: 'demo' });
  assert.deepEqual(parseGitHubRepoUrl('git@github.com:acme/demo.git'), { owner: 'acme', repo: 'demo' });
  assert.equal(parseGitHubRepoUrl('https://example.com/acme/demo.git'), null);
});

test('GitHub App helpers build install URLs and JWTs', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const githubAppPrivateKey = privateKey.export({ type: 'pkcs1', format: 'pem' });
  assert.equal(
    buildGitHubAppInstallUrl({ githubAppId: '123', githubAppSlug: 'workbench-test', githubAppPrivateKey }, 'state-1'),
    'https://github.com/apps/workbench-test/installations/new?state=state-1',
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
