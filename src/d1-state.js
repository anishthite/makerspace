const SESSION_TABLE = 'workbench_sessions';
const KV_TABLE = 'workbench_kv';

function clean(value) {
  return String(value || '').trim();
}

export function d1StateRequested(env = process.env) {
  return ['d1', 'cloudflare-d1'].includes(clean(env.WORKBENCH_STATE_STORE || env.STATE_STORE).toLowerCase());
}

function d1Config(env = process.env) {
  return {
    accountId: clean(env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_D1_ACCOUNT_ID || env.D1_ACCOUNT_ID),
    databaseId: clean(env.CLOUDFLARE_D1_DATABASE_ID || env.D1_DATABASE_ID),
    apiToken: clean(env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_D1_API_TOKEN || env.D1_API_TOKEN),
    apiBase: clean(env.CLOUDFLARE_API_BASE || env.D1_API_BASE) || 'https://api.cloudflare.com/client/v4',
  };
}

function requireD1Config(env = process.env) {
  const config = d1Config(env);
  const missing = [];
  if (!config.accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!config.databaseId) missing.push('CLOUDFLARE_D1_DATABASE_ID');
  if (!config.apiToken) missing.push('CLOUDFLARE_API_TOKEN');
  if (missing.length) throw new Error(`WORKBENCH_STATE_STORE=d1 needs ${missing.join(', ')}.`);
  return config;
}

function responseError(payload, fallback) {
  const errors = Array.isArray(payload?.errors) ? payload.errors.map((error) => error.message || String(error)).filter(Boolean) : [];
  return errors.join('; ') || fallback;
}

function firstResult(payload) {
  return Array.isArray(payload?.result) ? payload.result[0] : payload?.result;
}

function parseRows(payload) {
  const result = firstResult(payload);
  if (result?.success === false) throw new Error(responseError(result, 'Cloudflare D1 query failed.'));
  return Array.isArray(result?.results) ? result.results : [];
}

function normalizeSession(row) {
  if (!row?.data) return null;
  try {
    const session = JSON.parse(row.data);
    return session && typeof session === 'object' && session.provider !== 'mock' ? session : null;
  } catch {
    return null;
  }
}

export function createD1StateClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  let schemaReady = null;

  async function request(body) {
    const config = requireD1Config(env);
    if (typeof fetchImpl !== 'function') throw new Error('fetch is required for Cloudflare D1 state store.');
    const url = `${config.apiBase.replace(/\/$/, '')}/accounts/${encodeURIComponent(config.accountId)}/d1/database/${encodeURIComponent(config.databaseId)}/query`;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
      throw new Error(responseError(payload, `Cloudflare D1 request failed with ${response.status}.`));
    }
    return payload;
  }

  async function ensureSchema() {
    if (!schemaReady) {
      schemaReady = request({
        batch: [
          {
            sql: `CREATE TABLE IF NOT EXISTS ${SESSION_TABLE} (name TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, created_at TEXT, updated_at TEXT)`,
            params: [],
          },
          {
            sql: `CREATE TABLE IF NOT EXISTS ${KV_TABLE} (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
            params: [],
          },
          {
            sql: `CREATE INDEX IF NOT EXISTS workbench_sessions_created_at_idx ON ${SESSION_TABLE} (created_at DESC)`,
            params: [],
          },
        ],
      });
    }
    await schemaReady;
  }

  async function query(sql, params = []) {
    await ensureSchema();
    return parseRows(await request({ sql, params: params.map((value) => String(value ?? '')) }));
  }

  return {
    async listSessions() {
      const rows = await query(`SELECT data FROM ${SESSION_TABLE} ORDER BY created_at DESC`);
      return rows.map(normalizeSession).filter(Boolean);
    },

    async getSession(name) {
      const rows = await query(`SELECT data FROM ${SESSION_TABLE} WHERE name = ? LIMIT 1`, [name]);
      return normalizeSession(rows[0]) || null;
    },

    async upsertSession(session) {
      const createdAt = session.createdAt || session.updatedAt || new Date().toISOString();
      const updatedAt = session.updatedAt || createdAt;
      await query(
        `INSERT INTO ${SESSION_TABLE} (name, data, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data, created_at = excluded.created_at, updated_at = excluded.updated_at`,
        [session.name, JSON.stringify(session), createdAt, updatedAt],
      );
      return session;
    },

    async removeSession(name) {
      const existing = await this.getSession(name);
      if (!existing) return false;
      await query(`DELETE FROM ${SESSION_TABLE} WHERE name = ?`, [name]);
      return true;
    },

    async readKv(key, fallback = null) {
      const rows = await query(`SELECT value FROM ${KV_TABLE} WHERE key = ? LIMIT 1`, [key]);
      if (!rows[0]) return fallback;
      try {
        return JSON.parse(rows[0].value);
      } catch {
        return fallback;
      }
    },

    async writeKv(key, value) {
      await query(
        `INSERT INTO ${KV_TABLE} (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, JSON.stringify(value), new Date().toISOString()],
      );
      return value;
    },
  };
}

let defaultClient = null;

function client() {
  if (!defaultClient) defaultClient = createD1StateClient();
  return defaultClient;
}

export async function listD1Sessions() {
  return client().listSessions();
}

export async function getD1Session(name) {
  return client().getSession(name);
}

export async function upsertD1Session(session) {
  return client().upsertSession(session);
}

export async function removeD1Session(name) {
  return client().removeSession(name);
}

export async function readD1Kv(key, fallback = null) {
  return client().readKv(key, fallback);
}

export async function writeD1Kv(key, value) {
  return client().writeKv(key, value);
}
