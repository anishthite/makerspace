import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { portHostname, stablePortUrl } from '../cloudflare-sandbox-worker/src/ports.js';

test('Cloudflare worker uses routed domain when broker is workers.dev', () => {
  assert.equal(portHostname(new URL('https://spanner-sandbox-broker.example.workers.dev/sessions/t/ports/4310'), {}), 'spanner.sh');
  assert.equal(portHostname(new URL('https://sandbox.spanner.sh/sessions/t/ports/4310'), {}), 'spanner.sh');
  assert.equal(portHostname(new URL('https://broker.example.com/sessions/t/ports/4310'), {}), 'broker.example.com');
  assert.equal(portHostname(new URL('https://ignored.example.com/sessions/t/ports/4310'), { CLOUDFLARE_SANDBOX_PORT_HOSTNAME: 'preview.example.com' }), 'preview.example.com');
});

test('Cloudflare worker can synthesize stable bridge URLs', () => {
  assert.equal(stablePortUrl(4310, 'thread-one', 'spanner.sh'), 'https://4310-thread-one-bridge.spanner.sh');
});

test('Cloudflare worker awaits async route handlers inside error guard', async () => {
  const source = await readFile(new URL('../cloudflare-sandbox-worker/src/index.js', import.meta.url), 'utf8');
  assert.match(source, /return await portRoute\(/);
  assert.doesNotMatch(source, /box\.tunnels/);
});

test('Cloudflare worker uses production backup transfer by default', async () => {
  const source = await readFile(new URL('../cloudflare-sandbox-worker/src/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localBucket:\s*body\.localBucket\s*!==\s*false/);
  assert.match(source, /if \(localBucketForRequest\(env, body\)\) options\.localBucket = true;/);
  assert.match(source, /restoreBackup\(normalizeBackupForRestore\(env, body\.backup\)\)/);
});
