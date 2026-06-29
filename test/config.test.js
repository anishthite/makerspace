import test from 'node:test';
import assert from 'node:assert/strict';

import { collectForwardedEnv, getConfig } from '../src/config.js';

function withEnv(patch, fn) {
  const keys = Object.keys(patch);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('collectForwardedEnv prefers saved Anthropic key', () => {
  const env = collectForwardedEnv(
    { forwardEnvKeys: ['ANTHROPIC_API_KEY'] },
    { anthropicApiKey: 'fake-anthropic-key' },
  );

  assert.deepEqual(env, [{ key: 'ANTHROPIC_API_KEY', value: 'fake-anthropic-key' }]);
});

test('getConfig names the visible project from env or explicit home', () => {
  withEnv({ INFRA_PROVIDER: 'local', MAKERSPACE_PROJECT: 'site-ui', MAKERSPACE_NAME: undefined, MAKERSPACE_HOME: '/tmp/makerspace/site', RECENT_PROJECTS_DATA_PATH: undefined }, () => {
    assert.equal(getConfig().projectName, 'site-ui');
  });

  withEnv({ INFRA_PROVIDER: 'local', MAKERSPACE_PROJECT: undefined, MAKERSPACE_NAME: undefined, MAKERSPACE_HOME: '/tmp/makerspace/api', RECENT_PROJECTS_DATA_PATH: undefined }, () => {
    const config = getConfig();
    assert.equal(config.projectName, 'api');
    assert.equal(config.recentProjectsFile, '/tmp/makerspace/api/recent-projects.json');
  });
});

test('host dispatch is opt-in for remote providers', () => {
  withEnv({ INFRA_PROVIDER: 'daytona', PI_HOST_DISPATCH: undefined, PI_LOCAL_DISPATCH: undefined }, () => {
    assert.equal(getConfig().hostDispatchEnabled, false);
  });

  withEnv({ INFRA_PROVIDER: 'daytona', PI_HOST_DISPATCH: '1', PI_LOCAL_DISPATCH: undefined }, () => {
    assert.equal(getConfig().hostDispatchEnabled, true);
  });
});
