import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
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
  fetchGitHubUser,
  githubAuthConfigured,
  listGitHubRepos,
} from '../github.js';
import { resolvePiSdkPackageDir } from '../pi-sdk-package.js';
import { pruneBrowserSessions } from '../resource-utils.js';

const CODEX_AUTH_PROVIDER = 'openai-codex';
const CODEX_USER_SECRET_KEY = 'openai-codex-auth';

function normalizeCodexCredential(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  const source = parsed?.[CODEX_AUTH_PROVIDER] || parsed;
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

function codexAuthText(credential) {
  return `${JSON.stringify({ [CODEX_AUTH_PROVIDER]: credential }, null, 2)}\n`;
}

export function createAuthService({ config, http }) {
  const { sendJson, requestToken, originFor, clientError } = http;
  const BROWSER_SESSION_HEADER = 'x-makerspace-session';
  const authLogins = new Map();
  const githubLogins = new Map();
  const authStore = createAuthStore(config);
  let browserSessions = new Map();
  let sdkPromise = null;
  let piAiPromise = null;

  function authRequired() {
    return Boolean(config.authRequired);
  }

  function cookieName() {
    return config.authCookieName || 'makerspace_auth';
  }

  function authSecret() {
    return String(
      config.authSecret ||
      process.env.MAKERSPACE_AUTH_SECRET ||
      process.env.AUTH_SECRET ||
      config.controlApiToken ||
      config.githubClientSecret ||
      'makerspace-dev-auth-secret',
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

  function cookieSameSite() {
    return String(config.authCookieSameSite || (config.allowedOrigin ? 'None' : 'Lax')).trim() || 'Lax';
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
      return url.origin === originFor(request) || config.allowedOrigin && url.origin === config.allowedOrigin ? url.toString() : fallback;
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

  async function currentUser(request) {
    const token = authCookieToken(request);
    if (!token) return null;
    const session = await authStore.getAuthSession(hashAuthSessionId(token));
    if (!session?.userId) return null;
    const user = await authStore.getUser(session.userId);
    return user ? { ...user, authSessionHash: session.idHash } : null;
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

  async function requireUser(request, response, url) {
    const trusted = hasTrustedControlToken(request, url);
    const user = await currentUser(request);
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

  async function readPiSettingsFile() {
    if (authRequired()) return {};
    try {
      const settingsPath = path.join(homedir(), '.pi', 'agent', 'settings.json');
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
      ...(enabledModels.length ? enabledModels : availableModels.map(modelRefFromPiModel)),
      'inference/nvidia/nemotron3-super',
    ]);
  }

  async function availablePiModels(user = null) {
    try {
      const { AuthStorage, ModelRegistry } = await loadPiSdk();
      const authStorage = authRequired()
        ? await authStorageForSession({ ownerUserId: user?.id || '' })
        : AuthStorage.create();
      return ModelRegistry.create(authStorage).getAvailable();
    } catch {
      return [];
    }
  }

  async function loadPiDefaults(user = null) {
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

  async function readUserCodexCredential(user) {
    if (!user?.id) return null;
    const stored = await authStore.readUserSecret(user.id, CODEX_USER_SECRET_KEY);
    const credential = normalizeCodexCredential(stored?.value || '');
    return credential ? { credential, updatedAt: stored.updatedAt || null } : null;
  }

  async function readFreshUserCodexCredential(userId) {
    const stored = await readUserCodexCredential({ id: userId });
    if (!stored) return null;
    if (Date.now() + 30_000 < stored.credential.expires) return stored;

    const { AuthStorage } = await loadPiSdk();
    const authStorage = AuthStorage.inMemory({ [CODEX_AUTH_PROVIDER]: stored.credential });
    const apiKey = await authStorage.getApiKey(CODEX_AUTH_PROVIDER, { includeFallback: false });
    const credential = normalizeCodexCredential(authStorage.get(CODEX_AUTH_PROVIDER));
    if (!apiKey || !credential) throw new Error('Codex auth expired. Sign in again in Settings → Codex.');
    await authStore.writeUserSecret(userId, CODEX_USER_SECRET_KEY, JSON.stringify(credential));
    return { credential, updatedAt: new Date().toISOString() };
  }

  async function codexAuthStatus(user = null) {
    if (authRequired()) {
      const stored = await readUserCodexCredential(user);
      return {
        configured: Boolean(stored),
        source: stored ? 'user' : '',
        expiresAt: stored?.credential?.expires || null,
        updatedAt: stored?.updatedAt || null,
        ...(user?.id ? {} : { disabled: 'sign-in-required' }),
      };
    }
    const { AuthStorage } = await loadPiSdk();
    const authStorage = AuthStorage.create();
    return authStorage.getAuthStatus(CODEX_AUTH_PROVIDER);
  }

  async function startCodexDeviceLogin(user = null) {
    if (authRequired() && !user?.id) throw clientError('Sign in with GitHub before Codex.', 401);
    const { AuthStorage } = await loadPiSdk();
    const authStorage = authRequired() ? AuthStorage.inMemory() : AuthStorage.create();
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

    authStorage.login(CODEX_AUTH_PROVIDER, {
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
    }).then(async () => {
      const credential = normalizeCodexCredential(authStorage.get(CODEX_AUTH_PROVIDER));
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

  function publicAuthLogin(job) {
    return {
      id: job.id,
      status: job.status,
      device: job.device,
      progress: job.progress || null,
      error: job.error,
    };
  }

  async function githubTokenForUser(user) {
    if (!user?.id) return '';
    return (await authStore.getOAuthToken(user.id, 'github'))?.accessToken || '';
  }

  async function publicGitHubAuth(sessionOrUser) {
    const maybeUser = sessionOrUser?.id ? sessionOrUser : null;
    if (maybeUser) {
      return {
        configured: githubAuthConfigured(config),
        connected: Boolean(await githubTokenForUser(maybeUser)),
        user: publicUser(maybeUser),
      };
    }
    const session = sessionOrUser;
    return {
      configured: githubAuthConfigured(config),
      connected: Boolean(session?.githubToken),
      user: session?.githubUser || null,
    };
  }

  async function githubRepoPayload(sessionId, session, user = null) {
    const token = user ? await githubTokenForUser(user) : session?.githubToken;
    if (!token) {
      throw clientError(user ? 'Sign in with GitHub again.' : 'GitHub is not connected in this browser.', 401);
    }

    const repos = await listGitHubRepos(token);
    if (user?.id) await authStore.writeUserKv(user.id, 'githubRepos', repos);
    else writeBrowserSession(sessionId, { githubRepos: repos });

    return {
      ...(await publicGitHubAuth(user || session)),
      repos,
    };
  }

  async function enrichGitHubRepoSession(session, browserSession, user = null) {
    if (session.repoSource !== 'github') return session;

    const token = user ? await githubTokenForUser(user) : browserSession?.githubToken;
    if (!token) {
      throw clientError('Reconnect GitHub and pick the repo again.', 401);
    }

    let repo = null;
    if (user?.id) {
      repo = await fetchGitHubRepo(token, session.repoUrl);
    } else {
      repo = (browserSession.githubRepos || []).find((entry) => entry.cloneUrl === session.repoUrl);
    }

    if (!repo) {
      throw clientError('Pick the GitHub repo again from the repo list before creating the main agent.', 400);
    }

    return {
      ...session,
      branch: session.branch || repo.defaultBranch || '',
      repoProvider: 'github',
      repoVisibility: repo.private ? 'private' : 'public',
      repoAuthHeader: repo.private ? buildGitHubCloneAuthHeader(token) : '',
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
      const text = await readFile(path.join(homedir(), '.pi', 'agent', 'auth.json'), 'utf8');
      return text.trim() ? text : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function readPiAuthForSession(session = {}) {
    if (!authRequired()) return readLocalPiAuth();
    if (!session?.ownerUserId) return null;
    const stored = await readFreshUserCodexCredential(session.ownerUserId);
    return stored ? codexAuthText(stored.credential) : null;
  }

  async function authStorageForSession(session = {}) {
    if (!authRequired()) return null;
    const { AuthStorage } = await loadPiSdk();
    const stored = await readFreshUserCodexCredential(session.ownerUserId);
    return AuthStorage.inMemory(stored ? { [CODEX_AUTH_PROVIDER]: stored.credential } : {});
  }

  async function readLocalPiSettings() {
    if (authRequired()) return null;
    try {
      const text = await readFile(path.join(homedir(), '.pi', 'agent', 'settings.json'), 'utf8');
      return text.trim() ? text : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  function isGitHubAuthConfigured() {
    return githubAuthConfigured(config);
  }

  function startGitHubLogin(request, sessionId, body = {}) {
    const state = randomUUID();
    githubLogins.set(state, {
      returnTo: trimReturnTo(body.returnTo, request),
      sessionId,
    });
    return {
      loginUrl: buildGitHubAuthorizeUrl(config, githubCallbackUrl(request), state),
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

    try {
      const token = await exchangeGitHubCode(config, code, githubCallbackUrl(request));
      const githubUser = await fetchGitHubUser(token);
      const user = await authStore.upsertUser({
        id: `github-${githubUser.id}`,
        githubId: githubUser.id,
        login: githubUser.login,
        name: githubUser.name,
        avatarUrl: githubUser.avatarUrl,
      });
      await authStore.upsertOAuthToken({ userId: user.id, provider: 'github', accessToken: token, scopes: ['repo', 'read:user'] });
      writeBrowserSession(login.sessionId, { githubToken: token, githubUser, githubRepos: [] });

      const sessionToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + Math.max(1, Number(config.authSessionDays || 30)) * 24 * 60 * 60 * 1000).toISOString();
      await authStore.createAuthSession({ idHash: hashAuthSessionId(sessionToken), userId: user.id, expiresAt });

      const redirectTo = new URL(login.returnTo);
      redirectTo.searchParams.set('github', 'connected');
      return { location: redirectTo.toString(), headers: { 'set-cookie': authCookieHeader(request, sessionToken) } };
    } catch (error) {
      const redirectTo = new URL(login.returnTo);
      redirectTo.searchParams.set('github', 'error');
      redirectTo.searchParams.set('message', error.message);
      return { location: redirectTo.toString() };
    }
  }

  async function logout(request, sessionId = '') {
    const token = authCookieToken(request);
    if (token) await authStore.deleteAuthSession(hashAuthSessionId(token));
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
    publicAuthLogin,
    getAuthLogin,
    isGitHubAuthConfigured,
    publicGitHubAuth,
    githubRepoPayload,
    enrichGitHubRepoSession,
    startGitHubLogin,
    completeGitHubLogin,
    browserSessionId,
    requireTrustedBrowserRequest,
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
    authStorageForSession,
    readLocalPiSettings,
    authStore,
  };
}
