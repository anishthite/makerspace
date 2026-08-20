import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

test('collectForwardedEnv only forwards shared GitHub tokens in single-user mode', () => {
  withEnv({ GH_TOKEN: 'server-shared-token', GITHUB_TOKEN: 'server-shared-token' }, () => {
    const multiUser = collectForwardedEnv(
      { forwardEnvKeys: ['GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY'], authRequired: true },
      { anthropicApiKey: 'fake-anthropic-key' },
    );
    assert.deepEqual(multiUser, [{ key: 'ANTHROPIC_API_KEY', value: 'fake-anthropic-key' }]);

    const singleUser = collectForwardedEnv(
      { forwardEnvKeys: ['GH_TOKEN', 'GITHUB_TOKEN'], authRequired: false },
      {},
    );
    assert.deepEqual(singleUser, [
      { key: 'GH_TOKEN', value: 'server-shared-token' },
      { key: 'GITHUB_TOKEN', value: 'server-shared-token' },
    ]);
  });
});

test('default forwarded env includes Inference.net', () => {
  withEnv({ FORWARD_ENV_KEYS: undefined, INFRA_PROVIDER: 'local', SPANNER_HOME: '/tmp/spanner-test-home' }, () => {
    const keys = getConfig().forwardEnvKeys;
    assert.ok(keys.includes('ANTHROPIC_API_KEY'));
    assert.ok(keys.includes('INFERENCE_API_KEY'));
  });
});

test('getConfig names the visible project from env or explicit home', () => {
  withEnv({ INFRA_PROVIDER: 'local', SPANNER_PROJECT: 'site-ui', SPANNER_NAME: undefined, SPANNER_HOME: '/tmp/spanner/site', RECENT_PROJECTS_DATA_PATH: undefined }, () => {
    assert.equal(getConfig().projectName, 'site-ui');
  });

  withEnv({ INFRA_PROVIDER: 'local', SPANNER_PROJECT: '/Users/me/work/site-ui', SPANNER_NAME: undefined, SPANNER_HOME: '/tmp/spanner/site', RECENT_PROJECTS_DATA_PATH: undefined }, () => {
    assert.equal(getConfig().projectName, 'site-ui');
  });

  withEnv({ INFRA_PROVIDER: 'local', SPANNER_PROJECT: undefined, SPANNER_NAME: undefined, SPANNER_HOME: '/tmp/spanner/api', RECENT_PROJECTS_DATA_PATH: undefined, SPANNER_TRACE_STORE_DIR: undefined, TRACE_STORE_DIR: undefined }, () => {
    const config = getConfig();
    assert.equal(config.projectName, 'api');
    assert.equal(config.recentProjectsFile, '/tmp/spanner/api/recent-projects.json');
    assert.equal(config.traceStoreDir, '/tmp/spanner/api/traces');
  });
});

test('getConfig moves default local state from .workbench to .spanner', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'spanner-home-'));
  try {
    const legacyDir = path.join(home, '.workbench');
    const nextDir = path.join(home, '.spanner');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(path.join(legacyDir, 'sessions.json'), '[{"name":"old"}]\n');

    withEnv({ HOME: home, INFRA_PROVIDER: 'local', SPANNER_HOME: undefined, SPANNER_PROJECT: undefined, SPANNER_NAME: undefined }, () => {
      const config = getConfig();
      assert.equal(config.localDataDir, nextDir);
      assert.equal(existsSync(legacyDir), false);
      assert.equal(readFileSync(path.join(nextDir, 'sessions.json'), 'utf8'), '[{"name":"old"}]\n');
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('local defaults use localhost:8788 for GitHub OAuth callback stability', () => {
  withEnv({ HOST: undefined, PORT: undefined, INFRA_PROVIDER: 'local', PROVIDER: undefined, SPANNER_HOME: '/tmp/spanner-test-home' }, () => {
    const config = getConfig();
    assert.equal(config.host, 'localhost');
    assert.equal(config.port, 8788);
  });
});

test('getConfig infers D1 state store for production deployments with D1 credentials', () => {
  withEnv({
    NODE_ENV: 'production',
    SPANNER_STATE_STORE: undefined,
    STATE_STORE: undefined,
    CLOUDFLARE_ACCOUNT_ID: 'acct',
    CLOUDFLARE_D1_DATABASE_ID: 'db',
    CLOUDFLARE_API_TOKEN: 'token',
  }, () => {
    assert.equal(getConfig().stateStore, 'd1');
  });

  withEnv({
    NODE_ENV: 'production',
    SPANNER_STATE_STORE: 'file',
    STATE_STORE: undefined,
    CLOUDFLARE_ACCOUNT_ID: 'acct',
    CLOUDFLARE_D1_DATABASE_ID: 'db',
    CLOUDFLARE_API_TOKEN: 'token',
  }, () => {
    assert.equal(getConfig().stateStore, 'file');
  });
});

test('host dispatch is opt-in for remote providers', () => {
  withEnv({ INFRA_PROVIDER: 'cloudflare', PI_HOST_DISPATCH: undefined, PI_LOCAL_DISPATCH: undefined }, () => {
    assert.equal(getConfig().hostDispatchEnabled, false);
  });

  withEnv({ INFRA_PROVIDER: 'cloudflare', PI_HOST_DISPATCH: '1', PI_LOCAL_DISPATCH: undefined }, () => {
    assert.equal(getConfig().hostDispatchEnabled, true);
  });
});

test('default task prompt points workspace agents at Spanner defaults', () => {
  withEnv({ DEFAULT_TASK_PROMPT: undefined, INFRA_PROVIDER: 'local', SPANNER_HOME: '/tmp/spanner-test-home' }, () => {
    const prompt = getConfig().defaultTaskPrompt;
    assert.match(prompt, /\$SPANNER_PI_DEFAULTS_PACKAGE_DIR\/context\/AGENTS\.md/);
    assert.match(prompt, /packages\/spanner-pi-defaults\/context\/AGENTS\.md/);
    assert.doesNotMatch(prompt, /Read AGENTS\.md if present/);
  });
});

test('Cloudflare sandbox defaults use root paths and standard-2', () => {
  withEnv({ INFRA_PROVIDER: undefined, CLOUDFLARE_SANDBOX_MACHINE: undefined, CLOUDFLARE_SANDBOX_KEEPALIVE: undefined, REMOTE_HOME: undefined, REMOTE_CONTROL_DIR: undefined }, () => {
    const config = getConfig();
    assert.equal(config.provider, 'cloudflare');
    assert.equal(config.cloudflareMachine, 'standard-2');
    assert.equal(config.cloudflareKeepAlive, true);
    assert.equal(config.remoteUser, 'root');
    assert.equal(config.remoteHomeDir, '/home/root');
    assert.equal(config.remoteControlDir, '/home/root/.spanner/control');
    assert.equal(config.remotePiDefaultsPackageDir, '/home/root/.pi/agent/spanner-pi-defaults');
  });
});
