import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGitHubCloneAuthHeader, parseGitHubRepoUrl } from '../src/github.js';

test('parseGitHubRepoUrl handles https and ssh forms', () => {
  assert.deepEqual(parseGitHubRepoUrl('https://github.com/acme/demo.git'), { owner: 'acme', repo: 'demo' });
  assert.deepEqual(parseGitHubRepoUrl('git@github.com:acme/demo.git'), { owner: 'acme', repo: 'demo' });
  assert.equal(parseGitHubRepoUrl('https://example.com/acme/demo.git'), null);
});

test('buildGitHubCloneAuthHeader encodes a basic auth header for git clone', () => {
  assert.equal(
    buildGitHubCloneAuthHeader('secret-token'),
    `AUTHORIZATION: basic ${Buffer.from('x-access-token:secret-token').toString('base64')}`,
  );
});
