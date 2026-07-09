import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createD1StateClient, d1StateRequested, stateStoreFromEnv } from '../src/d1-state.js';

function makeFakeFetch() {
  const sessions = new Map();
  const kv = new Map();
  const calls = [];

  async function run({ sql = '', params = [] }) {
    calls.push({ sql, params });
    if (/^CREATE TABLE|^CREATE INDEX/i.test(sql)) return { success: true, results: [] };

    if (/INSERT INTO workbench_sessions/i.test(sql)) {
      const [name, data, createdAt, updatedAt] = params;
      sessions.set(name, { name, data, created_at: createdAt, updated_at: updatedAt });
      return { success: true, results: [] };
    }

    if (/SELECT data FROM workbench_sessions WHERE name/i.test(sql)) {
      const row = sessions.get(params[0]);
      return { success: true, results: row ? [{ data: row.data }] : [] };
    }

    if (/SELECT data FROM workbench_sessions ORDER BY/i.test(sql)) {
      return {
        success: true,
        results: [...sessions.values()]
          .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
          .map((row) => ({ data: row.data })),
      };
    }

    if (/DELETE FROM workbench_sessions/i.test(sql)) {
      sessions.delete(params[0]);
      return { success: true, results: [] };
    }

    if (/INSERT INTO workbench_kv/i.test(sql)) {
      const [key, value, updatedAt] = params;
      kv.set(key, { key, value, updated_at: updatedAt });
      return { success: true, results: [] };
    }

    if (/SELECT value FROM workbench_kv/i.test(sql)) {
      const row = kv.get(params[0]);
      return { success: true, results: row ? [{ value: row.value }] : [] };
    }

    throw new Error(`Unhandled SQL: ${sql}`);
  }

  const fetchImpl = async (_url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    const result = body.batch ? await Promise.all(body.batch.map(run)) : await run(body);
    return { ok: true, status: 200, json: async () => ({ success: true, result }) };
  };

  return { fetchImpl, calls };
}

test('d1StateRequested recognizes explicit and production D1 mode', () => {
  const d1Env = {
    NODE_ENV: 'production',
    CLOUDFLARE_ACCOUNT_ID: 'acct',
    CLOUDFLARE_D1_DATABASE_ID: 'db',
    CLOUDFLARE_API_TOKEN: 'token',
  };

  assert.equal(d1StateRequested({ WORKBENCH_STATE_STORE: 'd1' }), true);
  assert.equal(d1StateRequested({ STATE_STORE: 'cloudflare-d1' }), true);
  assert.equal(stateStoreFromEnv(d1Env), 'd1');
  assert.equal(d1StateRequested(d1Env), true);
  assert.equal(d1StateRequested({ ...d1Env, WORKBENCH_STATE_STORE: 'file' }), false);
  assert.equal(d1StateRequested({ ...d1Env, NODE_ENV: 'development' }), false);
  assert.equal(d1StateRequested({}), false);
});

test('D1 client stores sessions and singleton values', async () => {
  const { fetchImpl, calls } = makeFakeFetch();
  const client = createD1StateClient({
    fetchImpl,
    env: {
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_D1_DATABASE_ID: 'db',
      CLOUDFLARE_API_TOKEN: 'token',
    },
  });

  await client.upsertSession({ name: 'later', createdAt: '2026-06-26T11:00:00.000Z', value: 1 });
  await client.upsertSession({ name: 'earlier', createdAt: '2026-06-26T10:00:00.000Z', value: 2 });

  assert.equal((await client.getSession('later')).value, 1);
  assert.deepEqual((await client.listSessions()).map((session) => session.name), ['later', 'earlier']);

  await client.upsertSession({ name: 'later', createdAt: '2026-06-26T11:00:00.000Z', value: 3 });
  assert.equal((await client.getSession('later')).value, 3);
  assert.equal(await client.removeSession('earlier'), true);
  assert.equal(await client.removeSession('missing'), false);

  await client.writeKv('settings', { imageRef: 'ghcr.io/acme/img:latest' });
  assert.deepEqual(await client.readKv('settings'), { imageRef: 'ghcr.io/acme/img:latest' });
  assert.deepEqual(await client.readKv('missing', { ok: true }), { ok: true });

  assert.equal(calls.filter((call) => /^CREATE TABLE/i.test(call.sql)).length, 2);
});
