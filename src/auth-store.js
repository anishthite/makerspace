import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { d1StateRequested, readD1Kv, writeD1Kv } from './d1-state.js';

let writeQueue = Promise.resolve();

function keyPart(value) {
  return encodeURIComponent(String(value || '').trim());
}

function nowIso() {
  return new Date().toISOString();
}

function blankStore() {
  return { users: {}, authSessions: {}, oauthTokens: {}, userKv: {} };
}

function authFile(config = {}) {
  return config.authFile || path.join(config.rootDir || process.cwd(), 'data', 'auth.json');
}

async function ensureStore(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(filePath, `${JSON.stringify(blankStore(), null, 2)}\n`, 'utf8');
  }
}

async function readFileStore(filePath) {
  await ensureStore(filePath);
  try {
    return { ...blankStore(), ...JSON.parse(await readFile(filePath, 'utf8')) };
  } catch {
    return blankStore();
  }
}

async function writeFileStore(filePath, store) {
  const tempPath = `${filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

function mutateFileStore(filePath, fn) {
  const operation = async () => {
    const store = await readFileStore(filePath);
    const result = await fn(store);
    await writeFileStore(filePath, store);
    return result;
  };
  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  return result;
}

function authSecret(config = {}) {
  return String(
    config.authSecret ||
    process.env.MAKERSPACE_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    config.controlApiToken ||
    config.githubClientSecret ||
    'makerspace-dev-auth-secret',
  );
}

function encryptionKey(config = {}) {
  return createHash('sha256').update(authSecret(config)).digest();
}

export function hashAuthSessionId(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

export function encryptSecret(config, value) {
  const text = String(value || '');
  if (!text) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(config), iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSecret(config, value) {
  const text = String(value || '');
  if (!text) return '';
  const [version, ivText, tagText, ciphertextText] = text.split('.');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText) return '';
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(config), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function normalizeUser(input = {}) {
  const githubId = String(input.githubId || input.github_id || input.id || '').trim();
  const id = String(input.id || (githubId ? `github-${githubId}` : '')).trim();
  if (!id) throw new Error('User id is required.');
  return {
    id,
    githubId,
    login: String(input.login || '').trim(),
    name: input.name || null,
    avatarUrl: input.avatarUrl || input.avatar_url || null,
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

function tokenKey(userId, provider) {
  return `${keyPart(userId)}:${keyPart(provider)}`;
}

function userKvKey(userId, key) {
  return `${keyPart(userId)}:${keyPart(key)}`;
}

export function createAuthStore(config = {}) {
  const filePath = authFile(config);

  return {
    async upsertUser(input) {
      const user = normalizeUser(input);
      if (d1StateRequested()) {
        const existing = await readD1Kv(`auth:user:${keyPart(user.id)}`, null);
        const next = { ...(existing || {}), ...user, createdAt: existing?.createdAt || user.createdAt, updatedAt: nowIso() };
        await writeD1Kv(`auth:user:${keyPart(next.id)}`, next);
        if (next.githubId) await writeD1Kv(`auth:github-user:${keyPart(next.githubId)}`, next.id);
        return next;
      }
      return mutateFileStore(filePath, (store) => {
        const existing = store.users[user.id] || {};
        const next = { ...existing, ...user, createdAt: existing.createdAt || user.createdAt, updatedAt: nowIso() };
        store.users[next.id] = next;
        if (next.githubId) store.users[`github:${next.githubId}`] = next.id;
        return next;
      });
    },

    async getUser(id) {
      const userId = String(id || '').trim();
      if (!userId) return null;
      if (d1StateRequested()) return readD1Kv(`auth:user:${keyPart(userId)}`, null);
      const store = await readFileStore(filePath);
      return store.users[userId] && typeof store.users[userId] === 'object' ? store.users[userId] : null;
    },

    async getUserByGitHubId(githubId) {
      const id = String(githubId || '').trim();
      if (!id) return null;
      if (d1StateRequested()) {
        const userId = await readD1Kv(`auth:github-user:${keyPart(id)}`, '');
        return userId ? this.getUser(userId) : null;
      }
      const store = await readFileStore(filePath);
      const userId = store.users[`github:${id}`];
      return userId ? store.users[userId] || null : null;
    },

    async createAuthSession({ idHash, userId, expiresAt }) {
      const session = { idHash, userId, expiresAt, createdAt: nowIso() };
      if (d1StateRequested()) {
        await writeD1Kv(`auth:session:${keyPart(idHash)}`, session);
        return session;
      }
      return mutateFileStore(filePath, (store) => {
        store.authSessions[idHash] = session;
        return session;
      });
    },

    async getAuthSession(idHash) {
      const hash = String(idHash || '').trim();
      if (!hash) return null;
      const session = d1StateRequested()
        ? await readD1Kv(`auth:session:${keyPart(hash)}`, null)
        : (await readFileStore(filePath)).authSessions[hash] || null;
      if (!session?.userId) return null;
      const expiresAt = Date.parse(session.expiresAt || '');
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return null;
      return session;
    },

    async deleteAuthSession(idHash) {
      const hash = String(idHash || '').trim();
      if (!hash) return false;
      if (d1StateRequested()) {
        await writeD1Kv(`auth:session:${keyPart(hash)}`, null);
        return true;
      }
      return mutateFileStore(filePath, (store) => {
        const existed = Boolean(store.authSessions[hash]);
        delete store.authSessions[hash];
        return existed;
      });
    },

    async upsertOAuthToken({ userId, provider, accessToken, scopes = [] }) {
      const record = {
        userId: String(userId || '').trim(),
        provider: String(provider || '').trim(),
        accessTokenEncrypted: encryptSecret(config, accessToken),
        scopes: Array.isArray(scopes) ? scopes.map(String) : [],
        updatedAt: nowIso(),
      };
      if (!record.userId || !record.provider) throw new Error('OAuth token needs userId and provider.');
      if (d1StateRequested()) {
        await writeD1Kv(`auth:oauth:${tokenKey(record.userId, record.provider)}`, record);
        return record;
      }
      return mutateFileStore(filePath, (store) => {
        store.oauthTokens[tokenKey(record.userId, record.provider)] = record;
        return record;
      });
    },

    async getOAuthToken(userId, provider) {
      const key = tokenKey(userId, provider);
      const record = d1StateRequested()
        ? await readD1Kv(`auth:oauth:${key}`, null)
        : (await readFileStore(filePath)).oauthTokens[key] || null;
      if (!record?.accessTokenEncrypted) return null;
      return { ...record, accessToken: decryptSecret(config, record.accessTokenEncrypted) };
    },

    async readUserKv(userId, key, fallback = null) {
      const storeKey = userKvKey(userId, key);
      if (!String(userId || '').trim() || !String(key || '').trim()) return fallback;
      if (d1StateRequested()) return readD1Kv(`auth:user-kv:${storeKey}`, fallback);
      const store = await readFileStore(filePath);
      return Object.prototype.hasOwnProperty.call(store.userKv, storeKey) ? store.userKv[storeKey] : fallback;
    },

    async writeUserKv(userId, key, value) {
      const storeKey = userKvKey(userId, key);
      if (!String(userId || '').trim() || !String(key || '').trim()) throw new Error('User KV needs userId and key.');
      if (d1StateRequested()) return writeD1Kv(`auth:user-kv:${storeKey}`, value);
      return mutateFileStore(filePath, (store) => {
        store.userKv[storeKey] = value;
        return value;
      });
    },

    async writeUserSecret(userId, key, value) {
      const text = String(value || '');
      const record = { valueEncrypted: encryptSecret(config, text), updatedAt: nowIso() };
      await this.writeUserKv(userId, `secret:${key}`, record);
      return record;
    },

    async readUserSecret(userId, key) {
      const record = await this.readUserKv(userId, `secret:${key}`, null);
      if (!record?.valueEncrypted) return null;
      return {
        value: decryptSecret(config, record.valueEncrypted),
        updatedAt: record.updatedAt || null,
      };
    },
  };
}
