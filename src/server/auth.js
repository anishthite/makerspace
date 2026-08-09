import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createAuthStore, hashAuthSessionId } from '../auth-store.js';
import {
  buildGitHubAuthorizeUrl,
  buildGitHubCloneAuthHeader,
  exchangeGitHubCode,
  fetchGitHubRepo,
  parseGitHubRepoUrl,
  fetchGitHubUser,
  GITHUB_OAUTH_SCOPES,
  GITHUB_REMOTE_GIT_SCOPES,
  githubAuthConfigured,
  listGitHubRepos,
  missingGitHubOAuthScopes,
} from '../github.js';
import {
  buildGitHubAppInstallUrl,
  createGitHubAppInstallationToken,
  fetchGitHubAppInstallation,
  githubAppConfigured,
  githubAppInstallConfigured,
  githubRepoOwner,
} from '../github-app.js';
import { createInMemoryCredentialStore, createPiModelRegistry, createPiModelRuntime, writeCredentialFile } from '../pi-runtime.js';
import { resolvePiSdkPackageDir } from '../pi-sdk-package.js';
import { pruneBrowserSessions } from '../resource-utils.js';

const CODEX_AUTH_PROVIDER = 'openai-codex';
const CODEX_USER_SECRET_KEY = 'openai-codex-auth';
const CLAUDE_CODE_AUTH_PROVIDER = 'anthropic';
const CLAUDE_CODE_USER_SECRET_KEY = 'claude-code-auth';
const USER_PI_AUTH_PROVIDERS = [CODEX_AUTH_PROVIDER, CLAUDE_CODE_AUTH_PROVIDER];
const GITHUB_APP_INSTALLATIONS_KEY = 'githubAppInstallations';
const GITHUB_REPOS_CACHE_KEY = 'githubRepos';
const DEFAULTS_CACHE_TTL_MS = 30_000;
const AUTH_USER_CACHE_TTL_MS = 5_000;
const CLAUDE_CODE_CLIENT_ID = Buffer.from('OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl', 'base64').toString('utf8');
const CLAUDE_CODE_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const CLAUDE_CODE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLAUDE_CODE_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const CLAUDE_CODE_SCOPES = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload';

function normalizeOAuthCredential(raw, provider = '') {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  const source = provider && parsed?.[provider] ? parsed[provider] : parsed;
  if (!source || typeof source !== 'object' || source.type !== 'oauth') return null;
  const access = typeof source.access === 'string' ? source.access : '';
  const refresh = typeof source.refresh === 'string' ? source.refresh : '';
  const expires = typeof source.expires === 'number' ? source.expires : Number(source.expires);
  if (!access || !refresh || !Number.isFinite(expires)) return null;
  return {
    type: 'oauth',
    access,
    refresh,
    expires,
    ...(typeof source.accountId === 'string' ? { accountId: source.accountId } : {}),
  };
}

function piAuthText(credentialsByProvider = {}) {
  const credentials = Object.fromEntries(Object.entries(credentialsByProvider).filter(([, credential]) => credential));
  return Object.keys(credentials).length ? `${JSON.stringify(credentials, null, 2)}\n` : null;
}

function parseClaudeCodeAuthorizationInput(input) {
  const value = String(input || '').trim();
  if (!value) return {};

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') || undefined,
      state: url.searchParams.get('state') || undefined,
    };
  } catch {}

  const queryMatch = value.match(/(?:^|[?&#\s])code=([^\s&#]+)(?:.*(?:^|[?&#\s])state=([^\s&#]+))?/);
  if (queryMatch) return { code: queryMatch[1], state: queryMatch[2] || undefined };

  const hashMatch = value.match(/([A-Za-z0-9._~-]+)#([A-Za-z0-9._~-]+)/);
  if (hashMatch) return { code: hashMatch[1], state: hashMatch[2] };

  return { code: value };
}

function buildClaudeCodeAuth() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({
    code: 'true',
    client_id: CLAUDE_CODE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: CLAUDE_CODE_REDIRECT_URI,
    scope: CLAUDE_CODE_SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: verifier,
  });
  return { verifier, url: `${CLAUDE_CODE_AUTHORIZE_URL}?${params.toString()}` };
}

async function exchangeClaudeCode(code, state, verifier) {
  const response = await fetch(CLAUDE_CODE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLAUDE_CODE_CLIENT_ID,
      code,
      state,
      redirect_uri: CLAUDE_CODE_REDIRECT_URI,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Claude Code token exchange failed: ${response.status} ${text}`);

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Claude Code token exchange returned invalid JSON.');
  }

  const access = String(payload.access_token || '');
  const refresh = String(payload.refresh_token || '');
  const expiresIn = Number(payload.expires_in || 0);
  if (!access || !refresh || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Claude Code token exchange returned incomplete credentials.');
  }

  return {
    type: 'oauth',
    access,
    refresh,
    expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
  };
}

export function createAuthService({ config, http }) {
  const { sendJson, requestToken, originFor, clientError } = http;
  const BROWSER_SESSION_HEADER = 'x-spanner-session';
  const authLogins = new Map();
  const githubLogins = new Map();
  const githubAppInstalls = new Map();
  const defaultsCache = new Map();
  const currentUserCache = new Map();
  const authStore = createAuthStore(config);
  let browserSessions = new Map();
  let sdkPromise = null;
  let piAiPromise = null;

  function authRequired() {
    return Boolean(config.authRequired);
  }

  function cookieName() {
    return config.authCookieName || 'spanner_auth';
  }

  function githubNonceCookieName() {
    return `${cookieName()}_github_oauth`;
  }

  function authSecret() {
    return String(
      config.authSecret ||
      process.env.SPANNER_AUTH_SECRET ||
      process.env.AUTH_SECRET ||
      config.controlApiToken ||
      config.githubClientSecret ||
      'spanner-dev-auth-secret',
    );
  }

  function signValue(value) {
    return createHmac('sha256', authSecret()).update(String(value || '')).digest('base64url');
  }

  function signedValue(value) {
    return `${value}.${signValue(value)}`;
  }

  function verifySignedValue(value) {
    const text = String(value || '');
    const dot = text.lastIndexOf('.');
    if (dot <= 0) return '';
    const raw = text.slice(0, dot);
    const signature = text.slice(dot + 1);
    const expected = signValue(raw);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return '';
    return raw;
  }

  function parseCookies(request) {
    const header = String(request.headers.cookie || '');
    const cookies = new Map();
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (name) cookies.set(name, decodeURIComponent(value));
    }
    return cookies;
  }

  function authCookieToken(request) {
    return verifySignedValue(parseCookies(request).get(cookieName()) || '');
  }

  function cookieSecureFlag(request) {
    const proto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const host = String(request.headers.host || '').toLowerCase();
    if (host.startsWith('localhost:') || host.startsWith('127.0.0.1:')) return false;
    return proto === 'https' || Boolean(request.headers['x-forwarded-host']);
  }

  function configuredAllowedOrigins() {
    return Array.isArray(config.allowedOrigins) && config.allowedOrigins.length ? config.allowedOrigins : [config.allowedOrigin].filter(Boolean);
  }

  function isConfiguredAllowedOrigin(origin) {
    return configuredAllowedOrigins().includes(origin);
  }

  function cookieSameSite() {
    return String(config.authCookieSameSite || (configuredAllowedOrigins().length ? 'None' : 'Lax')).trim() || 'Lax';
  }

  function authCookieHeader(request, token) {
    const maxAge = Math.max(1, Number(config.authSessionDays || 30)) * 24 * 60 * 60;
    return [
      `${cookieName()}=${encodeURIComponent(signedValue(token))}`,
      'Path=/',
      'HttpOnly',
      `SameSite=${cookieSameSite()}`,
      `Max-Age=${maxAge}`,
      ...(cookieSecureFlag(request) || cookieSameSite().toLowerCase() === 'none' ? ['Secure'] : []),
    ].join('; ');
  }

  function clearAuthCookieHeader(request) {
    return [
      `${cookieName()}=`,
      'Path=/',
      'HttpOnly',
      `SameSite=${cookieSameSite()}`,
      'Max-Age=0',
      ...(cookieSecureFlag(request) || cookieSameSite().toLowerCase() === 'none' ? ['Secure'] : []),
    ].join('; ');
  }

  function githubNonceCookieHeader(request, nonce) {
    return [
      `${githubNonceCookieName()}=${encodeURIComponent(signedValue(nonce))}`,
      'Path=/api/auth/github/callback',
      'HttpOnly',
      `SameSite=${cookieSameSite()}`,
      'Max-Age=600',
      ...(cookieSecureFlag(request) || cookieSameSite().toLowerCase() === 'none' ? ['Secure'] : []),
    ].join('; ');
  }

  function clearGitHubNonceCookieHeader(request) {
    return [
      `${githubNonceCookieName()}=`,
      'Path=/api/auth/github/callback',
      'HttpOnly',
      `SameSite=${cookieSameSite()}`,
      'Max-Age=0',
      ...(cookieSecureFlag(request) || cookieSameSite().toLowerCase() === 'none' ? ['Secure'] : []),
    ].join('; ');
  }

  function githubNonceCookie(request) {
    return verifySignedValue(parseCookies(request).get(githubNonceCookieName()) || '');
  }

  function githubCallbackUrl(request) {
    return `${originFor(request)}/api/auth/github/callback`;
  }

  function trimReturnTo(value, request) {
    const fallback = `${originFor(request)}/settings.html`;
    const text = String(value || '').trim();
    if (!text) return fallback;

    try {
      if (text.startsWith('/')) {
        return new URL(text, originFor(request)).toString();
      }

      const url = new URL(text);
      return url.origin === originFor(request) || isConfiguredAllowedOrigin(url.origin) ? url.toString() : fallback;
    } catch {
      return fallback;
    }
  }

  function browserSessionId(request) {
    const headerValue = String(request.headers[BROWSER_SESSION_HEADER] || '').trim();
    const queryValue = (() => {
      try {
        return String(new URL(request.url || '/', originFor(request)).searchParams.get('browserSession') || '').trim();
      } catch {
        return '';
      }
    })();
    const value = headerValue || queryValue;
    return /^[a-z0-9-]{20,120}$/i.test(value) ? value : '';
  }

  function requestSiteOrigin(request) {
    const origin = String(request.headers.origin || '').trim();
    if (origin) return origin;

    const referer = String(request.headers.referer || '').trim();
    if (!referer) return '';

    try {
      return new URL(referer).origin;
    } catch {
      return '';
    }
  }

  function requireTrustedBrowserRequest(request, response) {
    if (config.controlApiToken || authRequired()) return false;

    const fetchSite = String(request.headers['sec-fetch-site'] || '').trim();
    if (fetchSite === 'same-origin') return false;
    if (requestSiteOrigin(request) === originFor(request)) return false;

    sendJson(response, 403, { error: 'GitHub browser auth needs a same-origin request or CONTROL_API_TOKEN.' });
    return true;
  }

  function requireAuthMutationOrigin(request, response, url) {
    if (!authRequired() || hasTrustedControlToken(request, url)) return false;
    const fetchSite = String(request.headers['sec-fetch-site'] || '').trim().toLowerCase();
    if (fetchSite && !['same-origin', 'same-site'].includes(fetchSite)) {
      sendJson(response, 403, { error: 'Auth changes need a same-origin request.' });
      return true;
    }
    const origin = requestSiteOrigin(request);
    if (origin && origin !== originFor(request) && !isConfiguredAllowedOrigin(origin)) {
      sendJson(response, 403, { error: 'Auth changes need a same-origin request.' });
      return true;
    }
    return false;
  }

  function requireBrowserSessionId(request, response) {
    const sessionId = browserSessionId(request);
    if (sessionId) return sessionId;
    sendJson(response, 400, { error: 'Browser session is required. Reload the page and try again.' });
    return null;
  }

  function readBrowserSession(sessionId) {
    return sessionId ? browserSessions.get(sessionId) || null : null;
  }

  function pruneBrowserSessionStore(now = Date.now()) {
    browserSessions = pruneBrowserSessions(browserSessions, { now });
  }

  function writeBrowserSession(sessionId, patch) {
    pruneBrowserSessionStore();
    const timestamp = new Date().toISOString();
    const existing = readBrowserSession(sessionId);
    const next = {
      ...(existing || {}),
      ...patch,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    browserSessions.set(sessionId, next);
    return next;
  }

  function clearBrowserSession(sessionId) {
    browserSessions.delete(sessionId);
    return null;
  }

  function requireApiToken(request, response, url) {
    if (!config.controlApiToken || authRequired() || !url.pathname.startsWith('/api/')) return false;
    if (url.pathname === '/api/auth/github/callback') return false;
    if (requestToken(request, url) === config.controlApiToken) return false;
    sendJson(response, 401, { error: 'Unauthorized' });
    return true;
  }

  function hasTrustedControlToken(request, url) {
    return Boolean(config.controlApiToken && requestToken(request, url) === config.controlApiToken);
  }

  function userAllowed(user = {}) {
    const allowed = Array.isArray(config.allowedUsers) ? config.allowedUsers.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean) : [];
    if (!allowed.length) return true;
    const values = [user.login, user.githubId, user.id].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
    return values.some((value) => allowed.includes(value));
  }

  function currentUserCacheTtlMs() {
    const value = Number(config.authUserCacheTtlMs || process.env.SPANNER_AUTH_USER_CACHE_TTL_MS || AUTH_USER_CACHE_TTL_MS);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function cacheCurrentUser(idHash, user, session = {}) {
    const ttlMs = currentUserCacheTtlMs();
    if (!ttlMs || !idHash) return;
    const sessionExpiresAt = Date.parse(session.expiresAt || '');
    const expiresAt = Number.isFinite(sessionExpiresAt)
      ? Math.min(Date.now() + ttlMs, sessionExpiresAt)
      : Date.now() + ttlMs;
    currentUserCache.set(idHash, { expiresAt, user });
  }

  async function currentUser(request) {
    const token = authCookieToken(request);
    if (!token) return null;

    const idHash = hashAuthSessionId(token);
    const cached = currentUserCache.get(idHash);
    if (cached && cached.expiresAt > Date.now()) return cached.promise ? cached.promise : cached.user;
    currentUserCache.delete(idHash);

    const promise = (async () => {
      const session = await authStore.getAuthSession(idHash);
      if (!session?.userId) {
        cacheCurrentUser(idHash, null);
        return null;
      }
      const user = await authStore.getUser(session.userId);
      const publicSessionUser = user && userAllowed(user) ? { ...user, authSessionHash: session.idHash } : null;
      cacheCurrentUser(idHash, publicSessionUser, session);
      return publicSessionUser;
    })();

    const ttlMs = currentUserCacheTtlMs();
    if (ttlMs) currentUserCache.set(idHash, { expiresAt: Date.now() + ttlMs, promise });

    try {
      return await promise;
    } catch (error) {
      currentUserCache.delete(idHash);
      throw error;
    }
  }

  function publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      login: user.login,
      name: user.name || null,
      avatarUrl: user.avatarUrl || null,
    };
  }

  function publicMe(user, trusted = false) {
    return {
      authenticated: Boolean(user),
      authRequired: authRequired(),
      admin: Boolean(trusted),
      user: publicUser(user),
      githubConfigured: githubAuthConfigured(config),
    };
  }

  async function requireUser(request, response, url, knownUser = undefined) {
    const trusted = hasTrustedControlToken(request, url);
    const user = knownUser === undefined ? await currentUser(request) : knownUser;
    if (trusted || user || !authRequired()) return { trusted, user, authRequired: authRequired() };
    sendJson(response, 401, {
      error: githubAuthConfigured(config) ? 'Sign in with GitHub to continue.' : 'Sign-in is required but GitHub OAuth is not configured.',
      authRequired: true,
      githubConfigured: githubAuthConfigured(config),
    });
    return null;
  }

  async function loadPiSdk() {
    if (!sdkPromise) {
      const packageDir = config.piSdkPackageDir || resolvePiSdkPackageDir();
      sdkPromise = import(pathToFileURL(path.join(packageDir, 'dist', 'index.js')).href);
    }

    return sdkPromise;
  }

  async function loadPiAi() {
    if (!piAiPromise) {
      const packageDir = config.piSdkPackageDir || resolvePiSdkPackageDir();
      piAiPromise = import(pathToFileURL(path.join(packageDir, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'index.js')).href);
    }

    return piAiPromise;
  }

  function localPiAgentDir() {
    return config.piAgentDir || process.env.PI_CODING_AGENT_DIR || path.join(homedir(), '.pi', 'agent');
  }

  function localPiAuthPath() {
    return path.join(localPiAgentDir(), 'auth.json');
  }

  function localPiModelsPath() {
    return path.join(localPiAgentDir(), 'models.json');
  }

  async function readPiSettingsFile() {
    if (authRequired()) return {};
    try {
      const settingsPath = path.join(localPiAgentDir(), 'settings.json');
      return JSON.parse(await readFile(settingsPath, 'utf8'));
    } catch {
      return {};
    }
  }

  function modelRefFromPiModel(model) {
    return model?.provider && model?.id ? `${model.provider}/${model.id}` : '';
  }

  function uniqueModelRefs(values = []) {
    const refs = [];
    const seen = new Set();
    for (const value of values) {
      const text = String(value || '').trim();
      if (!text || text === 'Pi default model' || seen.has(text)) continue;
      seen.add(text);
      refs.push(text);
    }
    return refs;
  }

  function configuredModelRefs(settings = {}, availableModels = []) {
    const enabledModels = Array.isArray(settings.enabledModels) ? settings.enabledModels : [];
    return uniqueModelRefs([
      ...enabledModels,
      ...availableModels.map(modelRefFromPiModel),
    ]);
  }

  async function availablePiModels(user = null) {
    try {
      const sdk = await loadPiSdk();
      const credentials = authRequired()
        ? await authStorageForSession({ ownerUserId: user?.id || '' })
        : undefined;
      const modelRuntime = await createPiModelRuntime(sdk, {
        credentials,
        authPath: credentials ? undefined : localPiAuthPath(),
        modelsPath: authRequired() ? null : localPiModelsPath(),
      });
      if (modelRuntime?.getAvailable) return [...await modelRuntime.getAvailable()];

      const authStorage = credentials || sdk.AuthStorage.create(localPiAuthPath());
      const modelRegistry = createPiModelRegistry(sdk, { authStorage, modelsPath: authRequired() ? undefined : localPiModelsPath() });
      return modelRegistry?.getAvailable?.() || [];
    } catch {
      return [];
    }
  }

  function cheapPiDefaults() {
    return {
      model: 'Pi default model',
      agent: 'Pi default model',
      thinking: 'medium',
      models: [],
    };
  }

  async function computePiDefaults(user = null) {
    let model = 'Pi default model';
    let thinking = 'medium';
    const settings = await readPiSettingsFile();
    const provider = String(settings.defaultProvider || '').trim();
    const modelId = String(settings.defaultModel || '').trim();
    const configuredThinking = String(settings.defaultThinkingLevel || '').trim();
    const availableModels = await availablePiModels(user);
    if (provider && modelId) model = `${provider}/${modelId}`;
    else if (modelId) model = modelId;
    if (configuredThinking) thinking = configuredThinking;

    return {
      model,
      agent: model,
      thinking,
      models: uniqueModelRefs([model, ...configuredModelRefs(settings, availableModels)]),
    };
  }

  function isPromiseLike(value) {
    return value && typeof value.then === 'function';
  }

  function refreshPiDefaults(key, user, cached = {}) {
    if (cached.refreshing) return cached.refreshing;
    const refreshing = computePiDefaults(user);
    defaultsCache.set(key, { ...cached, refreshing, refreshScheduled: false });
    refreshing.then((resolved) => {
      defaultsCache.set(key, { expiresAt: Date.now() + DEFAULTS_CACHE_TTL_MS, value: resolved, fallback: false });
    }).catch(() => {
      if (cached.value && !isPromiseLike(cached.value)) {
        defaultsCache.set(key, { expiresAt: Date.now() + 5000, value: cached.value, fallback: cached.fallback !== false });
      } else {
        defaultsCache.delete(key);
      }
    });
    return refreshing;
  }

  function schedulePiDefaultsRefresh(key, user, cached = {}) {
    if (cached.refreshing || cached.refreshScheduled) return;
    defaultsCache.set(key, { ...cached, refreshScheduled: true });
    const timer = setTimeout(() => {
      const latest = defaultsCache.get(key) || cached;
      if (latest.expiresAt > Date.now() && latest.fallback === false && !isPromiseLike(latest.value)) return;
      refreshPiDefaults(key, user, { ...latest, refreshScheduled: false });
    }, 1000);
    timer.unref?.();
  }

  async function loadPiDefaults(user = null, options = {}) {
    const key = `${authRequired() ? 'hosted' : 'local'}:${user?.id || 'anonymous'}`;
    const cached = defaultsCache.get(key);
    const now = Date.now();
    const staleOk = Boolean(options.staleOk);
    if (cached && cached.expiresAt > now && (!cached.fallback || staleOk)) return cached.value;
    if (cached?.fallback && cached.refreshing && !staleOk) return cached.refreshing;

    if (staleOk) {
      const fallback = cached?.value && !isPromiseLike(cached.value) ? cached.value : cheapPiDefaults();
      schedulePiDefaultsRefresh(key, user, { ...cached, value: fallback, fallback: cached?.fallback ?? true, expiresAt: now + 5000 });
      return fallback;
    }

    const value = computePiDefaults(user);
    defaultsCache.set(key, { expiresAt: now + DEFAULTS_CACHE_TTL_MS, value, fallback: false });
    try {
      const resolved = await value;
      defaultsCache.set(key, { expiresAt: Date.now() + DEFAULTS_CACHE_TTL_MS, value: resolved, fallback: false });
      return resolved;
    } catch (error) {
      defaultsCache.delete(key);
      throw error;
    }
  }

  function providerSecretKey(provider) {
    if (provider === CODEX_AUTH_PROVIDER) return CODEX_USER_SECRET_KEY;
    if (provider === CLAUDE_CODE_AUTH_PROVIDER) return CLAUDE_CODE_USER_SECRET_KEY;
    throw new Error(`Unknown auth provider: ${provider}`);
  }

  function providerLabel(provider) {
    return provider === CLAUDE_CODE_AUTH_PROVIDER ? 'Claude Code' : 'Codex';
  }

  async function readUserProviderCredential(user, provider) {
    if (!user?.id) return null;
    const stored = await authStore.readUserSecret(user.id, providerSecretKey(provider));
    const credential = normalizeOAuthCredential(stored?.value || '', provider);
    return credential ? { credential, updatedAt: stored.updatedAt || null } : null;
  }

  async function readFreshUserProviderCredential(userId, provider) {
    const stored = await readUserProviderCredential({ id: userId }, provider);
    if (!stored) return null;
    if (Date.now() + 30_000 < stored.credential.expires) return stored;

    const sdk = await loadPiSdk();
    const credentials = createInMemoryCredentialStore({ [provider]: stored.credential });
    const modelRuntime = await createPiModelRuntime(sdk, { credentials, modelsPath: null });
    const auth = await modelRuntime?.getAuth?.(provider);
    const credential = normalizeOAuthCredential(await credentials.read(provider), provider);
    if (!auth || !credential) throw new Error(`${providerLabel(provider)} auth expired. Sign in again in Settings → ${providerLabel(provider)}.`);
    await authStore.writeUserSecret(userId, providerSecretKey(provider), JSON.stringify(credential));
    return { credential, updatedAt: new Date().toISOString() };
  }

  async function readUserCodexCredential(user) {
    return readUserProviderCredential(user, CODEX_AUTH_PROVIDER);
  }

  async function readFreshUserCodexCredential(userId) {
    return readFreshUserProviderCredential(userId, CODEX_AUTH_PROVIDER);
  }

  async function readFreshUserClaudeCodeCredential(userId) {
    return readFreshUserProviderCredential(userId, CLAUDE_CODE_AUTH_PROVIDER);
  }

  async function hostedProviderAuthStatus(user, provider) {
    const stored = await readUserProviderCredential(user, provider);
    return {
      configured: Boolean(stored),
      source: stored ? 'user' : '',
      expiresAt: stored?.credential?.expires || null,
      updatedAt: stored?.updatedAt || null,
      ...(user?.id ? {} : { disabled: 'sign-in-required' }),
    };
  }

  async function localProviderAuthStatus(provider) {
    const sdk = await loadPiSdk();
    const modelRuntime = await createPiModelRuntime(sdk, { authPath: localPiAuthPath(), modelsPath: localPiModelsPath() });
    if (modelRuntime?.getProviderAuthStatus) return modelRuntime.getProviderAuthStatus(provider);
    const authStorage = sdk.AuthStorage.create(localPiAuthPath());
    return authStorage.getAuthStatus(provider);
  }

  async function codexAuthStatus(user = null) {
    return authRequired() ? hostedProviderAuthStatus(user, CODEX_AUTH_PROVIDER) : localProviderAuthStatus(CODEX_AUTH_PROVIDER);
  }

  async function claudeCodeAuthStatus(user = null) {
    return authRequired() ? hostedProviderAuthStatus(user, CLAUDE_CODE_AUTH_PROVIDER) : localProviderAuthStatus(CLAUDE_CODE_AUTH_PROVIDER);
  }

  async function logoutProviderAuth(provider, user = null) {
    if (authRequired()) {
      if (!user?.id) throw clientError(`Sign in with GitHub before ${providerLabel(provider)}.`, 401);
      await authStore.writeUserSecret(user.id, providerSecretKey(provider), '');
      return hostedProviderAuthStatus(user, provider);
    }

    const sdk = await loadPiSdk();
    const modelRuntime = await createPiModelRuntime(sdk, { authPath: localPiAuthPath(), modelsPath: localPiModelsPath() });
    if (modelRuntime?.logout) await modelRuntime.logout(provider);
    else sdk.AuthStorage.create(localPiAuthPath()).logout(provider);
    return localProviderAuthStatus(provider);
  }

  async function logoutCodexAuth(user = null) {
    return logoutProviderAuth(CODEX_AUTH_PROVIDER, user);
  }

  async function logoutClaudeCodeAuth(user = null) {
    return logoutProviderAuth(CLAUDE_CODE_AUTH_PROVIDER, user);
  }

  async function startCodexDeviceLogin(user = null) {
    if (authRequired() && !user?.id) throw clientError('Sign in with GitHub before Codex.', 401);
    const sdk = await loadPiSdk();
    const credentials = authRequired() ? createInMemoryCredentialStore() : undefined;
    const modelRuntime = await createPiModelRuntime(sdk, {
      credentials,
      authPath: credentials ? undefined : localPiAuthPath(),
      modelsPath: authRequired() ? null : localPiModelsPath(),
    });
    const authStorage = modelRuntime ? null : authRequired() ? sdk.AuthStorage.inMemory() : sdk.AuthStorage.create(localPiAuthPath());
    const id = randomUUID();
    const controller = new AbortController();
    const job = {
      id,
      ownerUserId: user?.id || '',
      status: 'starting',
      device: null,
      error: null,
      controller,
    };
    authLogins.set(id, job);

    const deviceReady = new Promise((resolve, reject) => {
      job.resolveDevice = resolve;
      job.rejectDevice = reject;
    });

    const loginPromise = modelRuntime
      ? modelRuntime.login(CODEX_AUTH_PROVIDER, 'oauth', {
          signal: controller.signal,
          prompt: async (prompt) => {
            if (prompt.type === 'select') return prompt.options.find((option) => /device/i.test(option.label))?.id;
            if (prompt.type === 'manual_code') throw new Error('Manual code input is not supported here.');
            throw new Error(prompt.message || 'Login needs input.');
          },
          notify: (event) => {
            if (event.type === 'device_code') {
              job.status = 'waiting';
              job.device = event;
              job.resolveDevice?.();
            } else if (event.type === 'progress') {
              job.progress = event.message;
            }
          },
        })
      : authStorage.login(CODEX_AUTH_PROVIDER, {
          signal: controller.signal,
          onSelect: async (prompt) => prompt.options.find((option) => /device/i.test(option.label))?.id,
          onAuth: () => {},
          onDeviceCode: (info) => {
            job.status = 'waiting';
            job.device = info;
            job.resolveDevice?.();
          },
          onPrompt: async (prompt) => {
            if (prompt.allowEmpty) return '';
            throw new Error(prompt.message || 'Login needs input.');
          },
          onManualCodeInput: async () => {
            throw new Error('Manual code input is not supported here.');
          },
          onProgress: (message) => {
            job.progress = message;
          },
        });

    loginPromise.then(async (result) => {
      const credential = normalizeOAuthCredential(
        result || await credentials?.read(CODEX_AUTH_PROVIDER) || authStorage?.get?.(CODEX_AUTH_PROVIDER),
        CODEX_AUTH_PROVIDER,
      );
      if (authRequired() && credential) {
        await authStore.writeUserSecret(user.id, CODEX_USER_SECRET_KEY, JSON.stringify(credential));
      }
      job.status = 'complete';
      job.completedAt = new Date().toISOString();
    }).catch((error) => {
      job.status = 'failed';
      job.error = error.message;
      job.rejectDevice?.(error);
    });

    await deviceReady;
    return publicAuthLogin(job);
  }

  async function startClaudeCodeLogin(user = null) {
    if (authRequired() && !user?.id) throw clientError('Sign in with GitHub before Claude Code.', 401);
    const { verifier, url } = buildClaudeCodeAuth();
    const job = {
      id: randomUUID(),
      provider: CLAUDE_CODE_AUTH_PROVIDER,
      ownerUserId: user?.id || '',
      status: 'waiting',
      auth: {
        url,
        instructions: 'Approve Claude Code access, then paste the code Claude shows.',
      },
      manual: true,
      verifier,
      error: null,
    };
    authLogins.set(job.id, job);
    return publicAuthLogin(job);
  }

  async function persistClaudeCodeCredential(job, credential) {
    if (authRequired()) {
      await authStore.writeUserSecret(job.ownerUserId, CLAUDE_CODE_USER_SECRET_KEY, JSON.stringify(credential));
      return;
    }

    await writeCredentialFile(localPiAuthPath(), CLAUDE_CODE_AUTH_PROVIDER, credential);
  }

  function submitManualClaudeCodeLoginCode(job, body = {}) {
    const input = String(body.code || body.authorizationCode || body.redirectUrl || '').trim();
    if (!input) throw clientError('Paste the Claude Code code or callback URL.');
    if (job.exchangePromise) return publicAuthLogin(job);

    const parsed = parseClaudeCodeAuthorizationInput(input);
    if (!parsed.code) throw clientError('Paste the Claude Code code or a callback URL with a code parameter.');
    if (parsed.state && parsed.state !== job.verifier) throw clientError('Claude Code OAuth state mismatch. Start sign-in again.', 400);
    const state = parsed.state || job.verifier;

    job.status = 'exchanging';
    job.progress = 'Exchanging authorization code for tokens...';
    job.exchangePromise = exchangeClaudeCode(parsed.code, state, job.verifier)
      .then(async (credential) => {
        await persistClaudeCodeCredential(job, credential);
        job.status = 'complete';
        job.progress = null;
        job.completedAt = new Date().toISOString();
      })
      .catch((error) => {
        job.status = 'failed';
        job.error = error.message;
      });
    return publicAuthLogin(job);
  }

  function submitClaudeCodeLoginCode(id, user = null, body = {}) {
    const job = getAuthLogin(id, user);
    if (!job || job.provider !== CLAUDE_CODE_AUTH_PROVIDER) throw clientError('Login not found', 404);
    if (job.status === 'complete' || job.status === 'failed') return publicAuthLogin(job);
    if (!job.verifier) throw clientError('Claude Code login is not ready for a pasted code yet.', 409);
    return submitManualClaudeCodeLoginCode(job, body);
  }

  function publicAuthLogin(job) {
    return {
      id: job.id,
      status: job.status,
      device: job.device,
      auth: job.auth || null,
      manual: Boolean(job.manual && job.status !== 'complete'),
      progress: job.progress || null,
      error: job.error,
    };
  }

  async function githubOAuthTokenRecordForUser(user) {
    return user?.id ? authStore.getOAuthToken(user.id, 'github') : null;
  }

  async function githubTokenForUser(user, requiredScopes = GITHUB_REMOTE_GIT_SCOPES) {
    const record = await githubOAuthTokenRecordForUser(user);
    if (!record?.accessToken) return '';
    return missingGitHubOAuthScopes(record, requiredScopes).length ? '' : record.accessToken;
  }

  async function githubAppInstallationsForUser(userId) {
    return await authStore.readUserKv(userId, GITHUB_APP_INSTALLATIONS_KEY, {}) || {};
  }

  function githubAuthIdentity(user, token) {
    return token ? {
      token,
      login: user?.login || '',
      name: user?.name || user?.login || '',
      email: user?.githubId && user?.login
        ? `${user.githubId}+${user.login}@users.noreply.github.com`
        : '',
    } : null;
  }

  async function githubOAuthAuthForUser(user) {
    const record = await githubOAuthTokenRecordForUser(user);
    if (!record?.accessToken) return null;
    const missingScopes = missingGitHubOAuthScopes(record, GITHUB_REMOTE_GIT_SCOPES);
    if (missingScopes.length) {
      throw clientError(`Reconnect GitHub to allow remote git workflow writes (${missingScopes.join(', ')} scope).`, 401);
    }
    return githubAuthIdentity(user, record.accessToken);
  }

  async function githubAppAuthForSession(session = {}, user = null) {
    if (!githubAppConfigured(config) || !session?.repoUrl || !user?.id) return null;
    const owner = githubRepoOwner(session.repoUrl);
    if (!owner) return null;
    const installations = await githubAppInstallationsForUser(user.id);
    const installation = installations[owner] || installations[owner.toLowerCase()];
    if (!installation?.id) return null;
    const { token } = await createGitHubAppInstallationToken(config, installation.id);
    return githubAuthIdentity(user, token);
  }

  async function readGitHubAuthForSession(session = {}) {
    if (session?.ownerUserId) {
      const user = await authStore.getUser(session.ownerUserId);
      return await githubAppAuthForSession(session, user) || await githubOAuthAuthForUser(user);
    }

    // In multi-user mode every sandbox belongs to a specific user; never
    // hand out the server-level token as a shared fallback.
    if (authRequired()) return null;

    const envToken = String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
    return envToken ? { token: envToken, login: '', name: '', email: '' } : null;
  }

  async function publicGitHubAppAuth(user) {
    if (!githubAppConfigured(config)) return { configured: false, installable: false, installed: false, installations: [] };
    const installations = user?.id ? await githubAppInstallationsForUser(user.id) : {};
    const entries = Object.values(installations || {}).map((entry) => ({
      id: String(entry.id || ''),
      accountLogin: String(entry.accountLogin || ''),
      accountType: String(entry.accountType || ''),
    })).filter((entry) => entry.id);
    return {
      configured: true,
      installable: githubAppInstallConfigured(config),
      installed: Boolean(entries.length),
      installations: entries,
    };
  }

  function publicGitHubRepo(repo) {
    const fullName = String(repo?.fullName || repo?.full_name || '').trim();
    const name = String(repo?.name || fullName.split('/').pop() || '').trim();
    if (!fullName || !name) return null;
    const owner = repo.owner?.login || repo.owner || fullName.split('/')[0] || null;
    return {
      id: repo.id,
      name,
      fullName,
      private: Boolean(repo.private),
      cloneUrl: String(repo.cloneUrl || repo.clone_url || '').trim(),
      defaultBranch: repo.defaultBranch || repo.default_branch || null,
      visibility: repo.private ? 'private' : repo.visibility || 'public',
      owner: owner ? String(owner) : null,
    };
  }

  function normalizeCachedGitHubRepos(rawRepos) {
    if (!Array.isArray(rawRepos)) return [];
    return rawRepos.map(publicGitHubRepo).filter(Boolean);
  }

  async function cachedGitHubReposFor(sessionOrUser, connected) {
    if (!connected) return [];
    if (sessionOrUser?.id) return normalizeCachedGitHubRepos(await authStore.readUserKv(sessionOrUser.id, GITHUB_REPOS_CACHE_KEY, []));
    return normalizeCachedGitHubRepos(sessionOrUser?.githubRepos);
  }

  function gitHubRepoCachePayload(repos) {
    return {
      repos,
      repoCache: {
        cached: repos.length > 0,
        count: repos.length,
      },
    };
  }

  async function publicGitHubAuth(sessionOrUser) {
    const maybeUser = sessionOrUser?.id ? sessionOrUser : null;
    if (maybeUser) {
      const tokenRecord = await githubOAuthTokenRecordForUser(maybeUser);
      const missingScopes = tokenRecord?.accessToken ? missingGitHubOAuthScopes(tokenRecord, GITHUB_REMOTE_GIT_SCOPES) : [];
      const connected = Boolean(tokenRecord?.accessToken);
      const repos = await cachedGitHubReposFor(maybeUser, connected);
      return {
        configured: githubAuthConfigured(config),
        connected,
        needsReconnect: Boolean(missingScopes.length),
        missingScopes,
        user: publicUser(maybeUser),
        app: await publicGitHubAppAuth(maybeUser),
        ...gitHubRepoCachePayload(repos),
      };
    }
    if (authRequired()) {
      return {
        configured: githubAuthConfigured(config),
        connected: false,
        user: null,
        app: await publicGitHubAppAuth(null),
        ...gitHubRepoCachePayload([]),
      };
    }
    const session = sessionOrUser;
    const connected = Boolean(session?.githubToken);
    const repos = await cachedGitHubReposFor(session, connected);
    return {
      configured: githubAuthConfigured(config),
      connected,
      user: session?.githubUser || null,
      app: await publicGitHubAppAuth(null),
      ...gitHubRepoCachePayload(repos),
    };
  }

  async function githubRepoPayload(sessionId, session, user = null) {
    const token = user ? await githubTokenForUser(user, []) : session?.githubToken;
    if (!token) {
      throw clientError(user ? 'Sign in with GitHub again.' : 'GitHub is not connected in this browser.', 401);
    }

    const repos = await listGitHubRepos(token);
    if (user?.id) await authStore.writeUserKv(user.id, GITHUB_REPOS_CACHE_KEY, repos);
    else writeBrowserSession(sessionId, { [GITHUB_REPOS_CACHE_KEY]: repos });

    return {
      ...(await publicGitHubAuth(user || session)),
      repos,
      repoCache: {
        cached: false,
        count: repos.length,
      },
    };
  }

  async function enrichGitHubRepoSession(session, browserSession, user = null) {
    const parsed = parseGitHubRepoUrl(session.repoUrl);
    const explicitGitHubPick = session.repoSource === 'github';
    if (!explicitGitHubPick && !parsed) return session;

    const githubAuth = user?.id
      ? await githubAppAuthForSession(session, user) || await githubOAuthAuthForUser(user)
      : browserSession?.githubToken ? { token: browserSession.githubToken } : null;

    if (!githubAuth?.token) {
      if (explicitGitHubPick) throw clientError('Reconnect GitHub and pick the repo again.', 401);
      return session;
    }

    let repo = null;
    try {
      repo = await fetchGitHubRepo(githubAuth.token, session.repoUrl);
    } catch (error) {
      if (explicitGitHubPick) throw clientError(`GitHub cannot access this repo: ${error.message}`, 403);
    }

    return {
      ...session,
      repoUrl: parsed ? `https://github.com/${parsed.owner}/${parsed.repo}.git` : session.repoUrl,
      branch: session.branch || repo?.defaultBranch || '',
      repoProvider: 'github',
      repoFullName: repo?.fullName || session.repoFullName || (parsed ? `${parsed.owner}/${parsed.repo}` : ''),
      repoDefaultBranch: repo?.defaultBranch || '',
      repoVisibility: repo ? (repo.private ? 'private' : 'public') : session.repoVisibility || '',
      repoAuthHeader: buildGitHubCloneAuthHeader(githubAuth.token),
    };
  }

  function canAccessSession(session, viewerSessionId = '', trusted = false, user = null) {
    if (trusted) return true;
    if (session?.ownerUserId) return Boolean(user?.id && session.ownerUserId === user.id);
    if (authRequired()) return false;
    return !session?.githubOwnerSessionId || (viewerSessionId && session.githubOwnerSessionId === viewerSessionId);
  }

  function requireSessionAccess(request, response, session, url, user = null) {
    if (canAccessSession(session, browserSessionId(request), hasTrustedControlToken(request, url), user)) return false;
    sendJson(response, 403, { error: `${session.name} belongs to a different user.` });
    return true;
  }

  async function readLocalPiAuth() {
    if (authRequired()) return null;
    try {
      const text = await readFile(path.join(localPiAgentDir(), 'auth.json'), 'utf8');
      return text.trim() ? text : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function readFreshUserPiCredentials(userId) {
    const codex = await readFreshUserCodexCredential(userId);
    const claudeCode = await readFreshUserClaudeCodeCredential(userId);
    return {
      ...(codex ? { [CODEX_AUTH_PROVIDER]: codex.credential } : {}),
      ...(claudeCode ? { [CLAUDE_CODE_AUTH_PROVIDER]: claudeCode.credential } : {}),
    };
  }

  async function syncPiAuthForSession(session = {}, authText = '') {
    if (!authRequired() || !session?.ownerUserId || !String(authText || '').trim()) return 0;

    let parsed;
    try {
      parsed = JSON.parse(authText);
    } catch {
      throw new Error('Remote Pi auth JSON is invalid.');
    }

    let updated = 0;
    for (const provider of USER_PI_AUTH_PROVIDERS) {
      const credential = normalizeOAuthCredential(parsed, provider);
      if (!credential) continue;
      await authStore.writeUserSecret(session.ownerUserId, providerSecretKey(provider), JSON.stringify(credential));
      updated += 1;
    }
    return updated;
  }

  async function readPiAuthForSession(session = {}) {
    if (!authRequired()) return readLocalPiAuth();
    if (!session?.ownerUserId) return null;
    return piAuthText(await readFreshUserPiCredentials(session.ownerUserId));
  }

  async function authStorageForSession(session = {}) {
    if (!authRequired()) return null;
    return createInMemoryCredentialStore(session?.ownerUserId ? await readFreshUserPiCredentials(session.ownerUserId) : {});
  }

  async function readLocalPiSettings() {
    if (authRequired()) return null;
    try {
      const text = await readFile(path.join(localPiAgentDir(), 'settings.json'), 'utf8');
      return text.trim() ? text : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  function isGitHubAuthConfigured() {
    return githubAuthConfigured(config);
  }

  function isGitHubAppConfigured() {
    return githubAppConfigured(config);
  }

  function startGitHubAppInstall(request, user, body = {}) {
    if (!user?.id) throw clientError('Sign in with GitHub before installing the GitHub App.', 401);
    if (!githubAppInstallConfigured(config)) throw clientError('Missing GITHUB_APP_ID, GITHUB_APP_SLUG, or GITHUB_APP_PRIVATE_KEY.', 400);
    const state = randomUUID();
    githubAppInstalls.set(state, {
      userId: user.id,
      returnTo: trimReturnTo(body.returnTo, request),
    });
    return { installUrl: buildGitHubAppInstallUrl(config, state) };
  }

  async function rememberGitHubAppInstallation(userId, installationId) {
    const installation = await fetchGitHubAppInstallation(config, installationId);
    const accountLogin = String(installation?.account?.login || '').trim();
    if (!accountLogin) throw new Error('GitHub App installation has no account login.');
    const key = accountLogin.toLowerCase();
    const installations = await githubAppInstallationsForUser(userId);
    const next = {
      ...installations,
      [key]: {
        id: String(installationId),
        accountLogin,
        accountType: String(installation?.account?.type || ''),
        updatedAt: new Date().toISOString(),
      },
    };
    await authStore.writeUserKv(userId, GITHUB_APP_INSTALLATIONS_KEY, next);
    return next[key];
  }

  async function completeGitHubAppInstall(request, url) {
    const state = String(url.searchParams.get('state') || '').trim();
    const installationId = String(url.searchParams.get('installation_id') || '').trim();
    const pending = githubAppInstalls.get(state);
    githubAppInstalls.delete(state);
    const userId = pending?.userId || '';
    const returnTo = pending?.returnTo || `${originFor(request)}/settings.html`;

    if (!githubAppConfigured(config)) return { statusCode: 400, text: 'GitHub App is not configured.' };
    if (!pending || !userId || !installationId) return { statusCode: 400, text: 'GitHub App install expired or failed.' };

    try {
      await rememberGitHubAppInstallation(userId, installationId);
      const redirect = new URL(returnTo);
      redirect.searchParams.set('githubApp', 'installed');
      return { statusCode: 302, location: redirect.toString() };
    } catch (error) {
      return { statusCode: 400, text: error.message };
    }
  }

  function startGitHubLogin(request, sessionId, body = {}, user = null) {
    const state = randomUUID();
    const nonce = randomBytes(32).toString('base64url');
    githubLogins.set(state, {
      returnTo: trimReturnTo(body.returnTo, request),
      sessionId,
      userId: user?.id || '',
      nonce,
    });
    return {
      loginUrl: buildGitHubAuthorizeUrl(config, githubCallbackUrl(request), state),
      headers: { 'set-cookie': githubNonceCookieHeader(request, nonce) },
    };
  }

  async function completeGitHubLogin(request, url) {
    const code = String(url.searchParams.get('code') || '').trim();
    const state = String(url.searchParams.get('state') || '').trim();
    const login = githubLogins.get(state);
    githubLogins.delete(state);

    if (!login || !code) {
      return { statusCode: 400, text: 'GitHub login expired or failed.' };
    }
    if (login.nonce && githubNonceCookie(request) !== login.nonce) {
      return { statusCode: 400, text: 'GitHub login expired or failed.' };
    }
    const clearNonce = clearGitHubNonceCookieHeader(request);

    try {
      const token = await exchangeGitHubCode(config, code, githubCallbackUrl(request));
      const githubUser = await fetchGitHubUser(token);
      const nextUserId = `github-${githubUser.id}`;
      if (!userAllowed(githubUser)) {
        const redirectTo = new URL(login.returnTo);
        redirectTo.searchParams.set('github', 'denied');
        redirectTo.searchParams.set('message', 'This GitHub account is not enabled for this Spanner.');
        return { location: redirectTo.toString(), headers: { 'set-cookie': clearNonce } };
      }
      if (login.userId && login.userId !== nextUserId) {
        const redirectTo = new URL(login.returnTo);
        redirectTo.searchParams.set('github', 'denied');
        redirectTo.searchParams.set('message', 'Sign out before switching GitHub accounts.');
        return { location: redirectTo.toString(), headers: { 'set-cookie': clearNonce } };
      }
      const user = await authStore.upsertUser({
        id: nextUserId,
        githubId: githubUser.id,
        login: githubUser.login,
        name: githubUser.name,
        avatarUrl: githubUser.avatarUrl,
      });
      await authStore.upsertOAuthToken({ userId: user.id, provider: 'github', accessToken: token, scopes: GITHUB_OAUTH_SCOPES });
      if (!authRequired()) writeBrowserSession(login.sessionId, { githubToken: token, githubUser, [GITHUB_REPOS_CACHE_KEY]: [] });

      const sessionToken = randomBytes(32).toString('base64url');
      const sessionHash = hashAuthSessionId(sessionToken);
      const expiresAt = new Date(Date.now() + Math.max(1, Number(config.authSessionDays || 30)) * 24 * 60 * 60 * 1000).toISOString();
      await authStore.createAuthSession({ idHash: sessionHash, userId: user.id, expiresAt });
      cacheCurrentUser(sessionHash, { ...user, authSessionHash: sessionHash }, { expiresAt });

      const redirectTo = new URL(login.returnTo);
      redirectTo.searchParams.set('github', 'connected');
      return { location: redirectTo.toString(), headers: { 'set-cookie': [authCookieHeader(request, sessionToken), clearNonce] } };
    } catch (error) {
      const redirectTo = new URL(login.returnTo);
      redirectTo.searchParams.set('github', 'error');
      redirectTo.searchParams.set('message', error.message);
      return { location: redirectTo.toString(), headers: { 'set-cookie': clearNonce } };
    }
  }

  async function logout(request, sessionId = '') {
    const token = authCookieToken(request);
    if (token) {
      const idHash = hashAuthSessionId(token);
      currentUserCache.delete(idHash);
      await authStore.deleteAuthSession(idHash);
    }
    if (sessionId) clearBrowserSession(sessionId);
    return { body: publicMe(null, false), headers: { 'set-cookie': clearAuthCookieHeader(request) } };
  }

  function getAuthLogin(id, user = null) {
    const job = authLogins.get(id);
    if (!job) return null;
    if (job.ownerUserId && job.ownerUserId !== user?.id) return null;
    return job;
  }

  return {
    loadPiSdk,
    loadPiAi,
    loadPiDefaults,
    codexAuthStatus,
    startCodexDeviceLogin,
    logoutCodexAuth,
    claudeCodeAuthStatus,
    startClaudeCodeLogin,
    logoutClaudeCodeAuth,
    submitClaudeCodeLoginCode,
    publicAuthLogin,
    getAuthLogin,
    isGitHubAuthConfigured,
    isGitHubAppConfigured,
    startGitHubAppInstall,
    completeGitHubAppInstall,
    githubTokenForUser,
    publicGitHubAuth,
    githubRepoPayload,
    enrichGitHubRepoSession,
    startGitHubLogin,
    completeGitHubLogin,
    browserSessionId,
    requireTrustedBrowserRequest,
    requireAuthMutationOrigin,
    requireBrowserSessionId,
    readBrowserSession,
    writeBrowserSession,
    clearBrowserSession,
    requireApiToken,
    hasTrustedControlToken,
    authRequired,
    currentUser,
    publicMe,
    requireUser,
    logout,
    canAccessSession,
    requireSessionAccess,
    readLocalPiAuth,
    readPiAuthForSession,
    syncPiAuthForSession,
    readGitHubAuthForSession,
    authStorageForSession,
    readLocalPiSettings,
    authStore,
  };
}
