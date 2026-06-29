import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildGitHubAuthorizeUrl,
  buildGitHubCloneAuthHeader,
  exchangeGitHubCode,
  fetchGitHubUser,
  githubAuthConfigured,
  listGitHubRepos,
} from '../github.js';
import { resolvePiSdkPackageDir } from '../pi-sdk-package.js';
import { pruneBrowserSessions } from '../resource-utils.js';

export function createAuthService({ config, http }) {
  const { sendJson, requestToken, originFor, clientError } = http;
  const BROWSER_SESSION_HEADER = 'x-makerspace-session';
  const authLogins = new Map();
  const githubLogins = new Map();
  let browserSessions = new Map();
  let sdkPromise = null;
  let piAiPromise = null;

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
      return url.origin === originFor(request) ? url.toString() : fallback;
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
    if (config.controlApiToken) return false;

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
    if (!config.controlApiToken || !url.pathname.startsWith('/api/')) return false;
    if (url.pathname === '/api/auth/github/callback') return false;
    if (requestToken(request, url) === config.controlApiToken) return false;
    sendJson(response, 401, { error: 'Unauthorized' });
    return true;
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

  async function loadPiDefaults() {
    let model = 'Pi default model';
    let thinking = 'medium';
    const settings = await readPiSettingsFile();
    const provider = String(settings.defaultProvider || '').trim();
    const modelId = String(settings.defaultModel || '').trim();
    const configuredThinking = String(settings.defaultThinkingLevel || '').trim();
    if (provider && modelId) model = `${provider}/${modelId}`;
    else if (modelId) model = modelId;
    if (configuredThinking) thinking = configuredThinking;

    return {
      model,
      agent: model,
      thinking,
      models: uniqueModelRefs([model, ...configuredModelRefs(settings)]),
    };
  }

  async function codexAuthStatus() {
    const { AuthStorage } = await loadPiSdk();
    const authStorage = AuthStorage.create();
    return authStorage.getAuthStatus('openai-codex');
  }

  async function startCodexDeviceLogin() {
    const { AuthStorage } = await loadPiSdk();
    const authStorage = AuthStorage.create();
    const id = randomUUID();
    const controller = new AbortController();
    const job = {
      id,
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

    authStorage.login('openai-codex', {
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
    }).then(() => {
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

  function publicGitHubAuth(session) {
    return {
      configured: githubAuthConfigured(config),
      connected: Boolean(session?.githubToken),
      user: session?.githubUser || null,
    };
  }

  async function githubRepoPayload(sessionId, session) {
    if (!session?.githubToken) {
      throw clientError('GitHub is not connected in this browser.', 401);
    }

    const repos = await listGitHubRepos(session.githubToken);
    writeBrowserSession(sessionId, { githubRepos: repos });

    return {
      ...publicGitHubAuth(session),
      repos,
    };
  }

  async function enrichGitHubRepoSession(session, browserSession) {
    if (session.repoSource !== 'github') return session;

    if (!browserSession?.githubToken) {
      throw clientError('Reconnect GitHub and pick the repo again.', 401);
    }

    const repo = (browserSession.githubRepos || []).find((entry) => entry.cloneUrl === session.repoUrl);
    if (!repo) {
      throw clientError('Pick the GitHub repo again from the repo list before creating the main agent.', 400);
    }

    return {
      ...session,
      branch: session.branch || repo.defaultBranch || '',
      repoProvider: 'github',
      repoVisibility: repo.private ? 'private' : 'public',
      repoAuthHeader: repo.private ? buildGitHubCloneAuthHeader(browserSession.githubToken) : '',
    };
  }

  function hasTrustedControlToken(request, url) {
    return Boolean(config.controlApiToken && requestToken(request, url) === config.controlApiToken);
  }

  function canAccessSession(session, viewerSessionId, trusted = false) {
    return trusted || !session?.githubOwnerSessionId || (viewerSessionId && session.githubOwnerSessionId === viewerSessionId);
  }

  function requireSessionAccess(request, response, session, url) {
    if (canAccessSession(session, browserSessionId(request), hasTrustedControlToken(request, url))) return false;
    sendJson(response, 403, { error: `${session.name} belongs to a different browser session.` });
    return true;
  }

  async function readLocalPiAuth() {
    try {
      const text = await readFile(path.join(homedir(), '.pi', 'agent', 'auth.json'), 'utf8');
      return text.trim() ? text : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function readLocalPiSettings() {
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
      const user = await fetchGitHubUser(token);
      writeBrowserSession(login.sessionId, { githubToken: token, githubUser: user, githubRepos: [] });
      const redirectTo = new URL(login.returnTo);
      redirectTo.searchParams.set('github', 'connected');
      return { location: redirectTo.toString() };
    } catch (error) {
      const redirectTo = new URL(login.returnTo);
      redirectTo.searchParams.set('github', 'error');
      redirectTo.searchParams.set('message', error.message);
      return { location: redirectTo.toString() };
    }
  }

  function getAuthLogin(id) {
    return authLogins.get(id);
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
    canAccessSession,
    requireSessionAccess,
    readLocalPiAuth,
    readLocalPiSettings,
  };
}
