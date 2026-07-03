import test from 'node:test';
import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';

import { createProvider, isTransientSandboxError } from '../src/provider.js';

const config = {
  daytonaApiKey: 'test-key',
  daytonaApiUrl: 'https://app.daytona.io/api',
  daytonaTarget: 'us',
  daytonaSnapshot: 'makerspace-base',
  daytonaAutostopMinutes: 60,
  daytonaAutodeleteMinutes: 120,
  remoteUser: 'daytona',
  remoteHomeDir: '/home/daytona',
  remoteControlDir: '/srv/makerspace',
  remoteWorkspaceDir: '/srv/workspace',
  bridgePort: 4310,
  bridgeReadyTimeoutMs: 240000,
  defaultCpu: '2',
  defaultMemory: '8',
  defaultDisk: '10',
  image: '',
  forwardEnvKeys: [],
  piInstallCommand: 'npm install -g pi',
  defaultTaskPrompt: 'Do the task.',
};

function makeSandbox(overrides = {}) {
  const calls = [];
  return {
    id: 'sandbox-123',
    name: 'thread-one',
    state: 'started',
    calls,
    fs: {
      async uploadFile(content, filePath) {
        calls.push(['uploadFile', filePath, Buffer.byteLength(content)]);
      },
    },
    process: {
      async executeCommand(command, cwd, env, timeout) {
        calls.push(['executeCommand', command, cwd, env, timeout]);
        return { exitCode: 0, result: '' };
      },
    },
    async refreshData() {
      calls.push(['refreshData']);
    },
    async waitUntilStarted() {
      calls.push(['waitUntilStarted']);
      this.state = 'started';
    },
    async setAutostopInterval(minutes) {
      calls.push(['setAutostopInterval', minutes]);
    },
    async setAutoDeleteInterval(minutes) {
      calls.push(['setAutoDeleteInterval', minutes]);
    },
    async getPreviewLink(port) {
      calls.push(['getPreviewLink', port]);
      return { url: `https://preview.example/${port}`, token: 'preview-token' };
    },
    async delete() {
      calls.push(['delete']);
    },
    ...overrides,
  };
}

test('isTransientSandboxError catches startup reachability failures', () => {
  assert.equal(isTransientSandboxError(new Error('ECONNREFUSED while starting')), true);
  assert.equal(isTransientSandboxError(new Error('sandbox did not reach started')), true);
  assert.equal(isTransientSandboxError(new Error('invalid api key')), false);
});

test('createProvider exposes Daytona metadata without importing the SDK', () => {
  const provider = createProvider(config, { daytonaClient: { list: async () => [] } });

  assert.equal(provider.kind, 'daytona');
  assert.equal(provider.info().kind, 'daytona');
  assert.equal(provider.info().transport, '@daytona/sdk');
  assert.equal(provider.info().ready, true);
  assert.deepEqual(provider.bridgeHeaders({ previewToken: 'preview-token' }), { 'x-daytona-preview-token': 'preview-token' });
  assert.deepEqual(provider.bridgeHeaders({}), {});
  assert.equal(provider.shouldRefreshSession({ updatedAt: '2000-01-01T00:00:00.000Z' }), true);
  assert.equal(provider.shouldRefreshSession({ updatedAt: new Date().toISOString() }), false);
  assert.deepEqual(provider.info().env, {
    apiKey: true,
    apiUrl: true,
    target: true,
    snapshot: true,
    autostopMinutes: 60,
    autodeleteMinutes: 120,
  });
});

test('createProvider rejects unknown infrastructure providers', () => {
  assert.throws(
    () => createProvider({ ...config, provider: 'nope' }, { daytonaClient: { list: async () => [] } }),
    /Unknown infrastructure provider: nope/,
  );
});

test('createProvider exposes local metadata and validates repo paths', async () => {
  const provider = createProvider({ ...config, provider: 'local', projectName: 'api', localDataDir: '/tmp/makerspace-test' });

  assert.equal(provider.kind, 'local');
  assert.equal(provider.info().transport, 'local-process');
  assert.equal(provider.info().ready, true);
  assert.deepEqual(provider.info().project, { name: 'api', home: '/tmp/makerspace-test' });
  assert.equal(await provider.resolveRepoPath('.'), await realpath('.'));
  await assert.rejects(() => provider.resolveRepoPath('/definitely/missing/makerspace'), /ENOENT|no such file/i);
});

test('createSession creates a Daytona sandbox and returns bridge preview metadata', async () => {
  const sandbox = makeSandbox();
  let createParams = null;
  const client = {
    async list() {
      return [];
    },
    async create(params) {
      createParams = params;
      return sandbox;
    },
  };
  const provider = createProvider(config, { daytonaClient: client });

  const session = {
    name: 'thread-one',
    repoMode: 'empty',
    branch: '',
    taskPrompt: 'Run pi.',
    bridgeMode: true,
    bridgeToken: 'bridge-token',
    autoRunAgent: true,
  };
  const remote = await provider.createSession(session, {});

  assert.equal(createParams.name, 'thread-one');
  assert.equal(createParams.snapshot, 'makerspace-base');
  assert.equal(createParams.resources, undefined);
  assert.equal(createParams.labels.makerspace, '1');
  assert.equal(createParams.labels.makerspaceSession, 'thread-one');
  assert.equal(remote.name, 'thread-one');
  assert.equal(remote.bridgeUrl, 'https://preview.example/4310');
  assert.equal(remote.previewToken, 'preview-token');
  assert.equal(remote.daytonaSandboxId, 'sandbox-123');
  assert.equal(remote.connectCommand, 'daytona ssh sandbox-123');
  assert.equal(sandbox.calls.some((call) => call[0] === 'uploadFile' && call[1] === '/tmp/makerspace-setup.sh'), true);
  assert.equal(sandbox.calls.some((call) => call[0] === 'executeCommand' && String(call[1]).includes('/tmp/makerspace-setup.sh')), true);
});

test('createSession reuses a stored Daytona sandbox id before creating', async () => {
  const sandbox = makeSandbox({ id: 'stored-id', name: 'thread-one' });
  let createCalled = false;
  const provider = createProvider(config, {
    daytonaClient: {
      async get(id) {
        assert.equal(id, 'stored-id');
        return sandbox;
      },
      async list() {
        return [];
      },
      async create() {
        createCalled = true;
        throw new Error('should not create');
      },
    },
  });

  const remote = await provider.createSession({
    name: 'thread-one',
    daytonaSandboxId: 'stored-id',
    repoMode: 'empty',
    branch: '',
    taskPrompt: 'Run pi.',
    bridgeMode: true,
    bridgeToken: 'bridge-token',
  }, {});

  assert.equal(createCalled, false);
  assert.equal(remote.daytonaSandboxId, 'stored-id');
  assert.equal(remote.bridgeUrl, 'https://preview.example/4310');
});

test('createSession falls back to existing sandbox lookup on duplicate create', async () => {
  const sandbox = makeSandbox({ id: 'duplicate-id', name: 'thread-one' });
  const gets = [];
  const provider = createProvider(config, {
    daytonaClient: {
      async list() {
        return [];
      },
      async create() {
        throw new Error('Sandbox with name thread-one already exists');
      },
      async get(id) {
        gets.push(id);
        return sandbox;
      },
    },
  });

  const remote = await provider.createSession({
    name: 'thread-one',
    repoMode: 'empty',
    branch: '',
    taskPrompt: 'Run pi.',
    bridgeMode: true,
    bridgeToken: 'bridge-token',
  }, {});

  assert.deepEqual(gets, ['thread-one']);
  assert.equal(remote.daytonaSandboxId, 'duplicate-id');
  assert.equal(remote.bridgeUrl, 'https://preview.example/4310');
});

test('readOutput returns launching before a sandbox id is known', async () => {
  const provider = createProvider(config, { daytonaClient: { list: async () => [] } });
  const output = await provider.readOutput({}, { offset: 0 });

  assert.deepEqual(output, {
    chunk: '',
    nextOffset: 0,
    runStatus: 'launching',
  });
});
