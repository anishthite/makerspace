import assert from 'node:assert/strict';
import test from 'node:test';

import { createProvider, isTransientSandboxError } from '../src/provider.js';

const config = {
  provider: 'cloudflare',
  cloudflareBrokerUrl: 'https://broker.example.test',
  cloudflareBrokerToken: 'broker-token',
  cloudflareMachine: 'standard-2',
  cloudflareSleepAfter: '15m',
  remoteUser: 'root',
  remoteHomeDir: '/home/root',
  remoteWorkspaceDir: '/workspace',
  remoteControlDir: '/home/root/.spanner/control',
  remotePiDefaultsPackageDir: '/home/root/.pi/agent/spanner-pi-defaults',
  bridgePort: 4310,
  forwardEnvKeys: ['ANTHROPIC_API_KEY'],
  piInstallCommand: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
  defaultTaskPrompt: 'Do the thing.',
};

function fakeFetch() {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {}, body });
    if (String(url).endsWith('/sessions')) return Response.json({ id: body.name, name: body.name, state: 'ready' });
    if (String(url).includes('/ports/')) return Response.json({ bridgeUrl: 'https://bridge.example.test/', httpsUrl: 'https://bridge.example.test/' });
    if (String(url).includes('/backup')) return Response.json({ backup: { id: `${body.name || 'backup'}-id`, dir: body.dir } });
    if (String(url).includes('/files') && (options.method || 'GET') === 'GET') {
      const search = new URL(String(url)).searchParams;
      if (search.get('encoding') === 'base64') return Response.json({ content: Buffer.from([0, 255, 1, 2]).toString('base64'), encoding: 'base64' });
      return Response.json({ content: 'file text' });
    }
    if (String(url).includes('/exec')) return Response.json({ success: true, exitCode: 0, stdout: 'ok\n', stderr: '' });
    return Response.json({ ok: true });
  };
  fetch.calls = calls;
  return fetch;
}

test('createProvider exposes Cloudflare metadata without touching the broker', () => {
  const provider = createProvider(config, { fetch: fakeFetch() });

  assert.equal(provider.kind, 'cloudflare');
  assert.equal(provider.info().kind, 'cloudflare');
  assert.equal(provider.info().transport, 'cloudflare-sandbox-broker');
  assert.equal(provider.info().ready, true);
  assert.equal(provider.info().machine, 'standard-2');
  assert.deepEqual(provider.bridgeHeaders({ bridgeToken: 'secret' }), { authorization: 'Bearer secret' });
});

test('createProvider rejects unknown remote providers', () => {
  assert.throws(() => createProvider({ ...config, provider: 'legacy-remote' }, { fetch: fakeFetch() }), /Unknown infrastructure provider: legacy-remote/);
});

test('createSession provisions through the broker and runs root setup', async () => {
  const fetch = fakeFetch();
  const provider = createProvider(config, { fetch });

  const remote = await provider.createSession({
    name: 'thread-one',
    bridgeMode: true,
    sharePort: 4310,
    taskPrompt: 'Test prompt',
    bridgeToken: 'bridge-token',
    repoAuthHeader: `AUTHORIZATION: basic ${Buffer.from('x-access-token:repo-token').toString('base64')}`,
  }, { anthropicApiKey: 'anthropic-key' });

  assert.equal(remote.cloudflareSandboxId, 'thread-one');
  assert.equal(remote.bridgeUrl, 'https://bridge.example.test/');
  assert.equal(fetch.calls[0].method, 'POST');
  assert.equal(fetch.calls[0].url, 'https://broker.example.test/sessions');
  assert.equal(fetch.calls[0].headers.authorization, 'Bearer broker-token');
  assert.equal(fetch.calls[0].body.machine, 'standard-2');
  assert.equal(fetch.calls[0].body.sleepAfter, '15m');
  assert.equal(fetch.calls[0].body.keepAlive, true);
  assert.deepEqual(fetch.calls[0].body.envVars, [{ key: 'ANTHROPIC_API_KEY', value: 'anthropic-key' }]);

  const setupWrite = fetch.calls.find((call) => call.method === 'PUT' && call.url.endsWith('/files'));
  assert.match(setupWrite.body.content, /mkdir -p '\/home\/root' '\/home\/root\/\.config\/gh'/);
  assert.match(setupWrite.body.content, /printf 'export PI_BRIDGE_PACKAGE_DIR=%s\\n' '\/home\/root\/\.pi\/agent\/npm'/);

  const setupExec = fetch.calls.find((call) => call.url.endsWith('/exec') && call.body.command.includes('/tmp/spanner-setup.sh'));
  assert.equal(setupExec.body.cwd, '/');
  assert.deepEqual(setupExec.body.env, [{ key: 'ANTHROPIC_API_KEY', value: 'anthropic-key' }]);
  assert.equal(fetch.calls.at(-1).url, 'https://broker.example.test/sessions/thread-one/ports/4310');
});

test('remote script and file helpers use broker endpoints', async () => {
  const fetch = fakeFetch();
  const provider = createProvider(config, { fetch });
  let streamed = '';

  const result = await provider.runRemoteScript('thread-one', 'echo hi', { cwd: '/workspace', onData: (text) => { streamed += text; } });
  await provider.writeRemoteFile('thread-one', '/tmp/a.txt', 'hello');
  const content = await provider.readRemoteFile('thread-one', '/tmp/a.txt');
  const binary = await provider.readRemoteFile('thread-one', '/tmp/a.png', { encoding: 'base64' });

  assert.equal(result.exitCode, 0);
  assert.equal(streamed, 'ok\n');
  assert.equal(content, 'file text');
  assert.deepEqual([...binary], [0, 255, 1, 2]);
  assert.match(fetch.calls[0].body.command, /cd '\/workspace' && bash -lc 'echo hi'/);
  assert.equal(fetch.calls[1].method, 'PUT');
  assert.equal(fetch.calls[2].method, 'GET');
  assert.equal(new URL(fetch.calls[3].url).searchParams.get('encoding'), 'base64');
});

test('suspend and delete create Cloudflare backups before destroying sandbox', async () => {
  const fetch = fakeFetch();
  const provider = createProvider(config, { fetch });

  const suspended = await provider.suspendSession({ name: 'thread-one' });
  const deleted = await provider.deleteSessionWithBackup({ name: 'thread-two', cloudflareSandboxId: 'thread-two' });

  assert.equal(suspended.status, 'suspended');
  assert.equal(suspended.cloudflareBackups.length, 2);
  assert.equal(deleted.cloudflareBackups.length, 2);
  assert.deepEqual(
    fetch.calls.filter((call) => call.url.endsWith('/backup')).map((call) => call.body.dir),
    ['/workspace', '/home/root/.spanner/control/pi-sessions', '/workspace', '/home/root/.spanner/control/pi-sessions'],
  );
  assert.equal(fetch.calls.filter((call) => call.method === 'DELETE').length, 2);
});

test('transient sandbox error detection stays provider-neutral', () => {
  assert.equal(isTransientSandboxError(new Error('503 timeout from broker')), true);
  assert.equal(isTransientSandboxError(new Error('validation failed')), false);
});
