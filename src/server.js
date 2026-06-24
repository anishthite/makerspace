import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { getConfig } from './config.js';
import { preloadHostPiRunner, runHostPiSession } from './host-pi-runner.js';
import {
  buildGitHubAuthorizeUrl,
  buildGitHubCloneAuthHeader,
  exchangeGitHubCode,
  fetchGitHubUser,
  githubAuthConfigured,
  listGitHubRepos,
} from './github.js';
import { buildAndPushImage } from './image-builder.js';
import { timestampSystemLines } from './log-format.js';
import { createProvider } from './provider.js';
import { report } from './report.js';
import { decorateSession, normalizeChatRequest, normalizeClientId, normalizeCreateRequest, normalizeThreadRequest } from './session.js';
import { readAppSettings, readSavedSettings, saveAppSettings } from './settings.js';
import { getStoredSession, listStoredSessions, removeStoredSession, upsertSession } from './store.js';

const config = getConfig();
const provider = createProvider(config);
const publicDir = path.join(config.rootDir, 'public');
const activeRuns = new Map();
const warmLaunches = new Set();
const authLogins = new Map();
const githubLogins = new Map();
const browserSessions = new Map();
const BROWSER_SESSION_HEADER = 'x-makerspace-session';
let sdkPromise = null;

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,x-api-token,x-makerspace-session',
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(response, statusCode, payload, contentType = 'text/plain; charset=utf-8', headers = {}) {
  response.writeHead(statusCode, { 'content-type': contentType, ...corsHeaders, ...headers });
  response.end(payload);
}

function clientError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requestToken(request, url) {
  const authorization = String(request.headers.authorization || '');
  if (authorization.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();
  return String(request.headers['x-api-token'] || url.searchParams.get('token') || '').trim();
}

function originFor(request) {
  return `${request.headers['x-forwarded-proto'] || 'http'}://${request.headers['x-forwarded-host'] || request.headers.host || 'localhost'}`;
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

function writeBrowserSession(sessionId, patch) {
  const timestamp = new Date().toISOString();
  const next = {
    ...(readBrowserSession(sessionId) || {}),
    ...patch,
    createdAt: readBrowserSession(sessionId)?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  browserSessions.set(sessionId, next);
  return next;
}

function clearBrowserSessionGithub(sessionId) {
  return writeBrowserSession(sessionId, { githubToken: '', githubUser: null, githubRepos: [] });
}

function requireApiToken(request, response, url) {
  if (!config.controlApiToken || !url.pathname.startsWith('/api/')) return false;
  if (url.pathname === '/api/auth/github/callback') return false;
  if (requestToken(request, url) === config.controlApiToken) return false;
  sendJson(response, 401, { error: 'Unauthorized' });
  return true;
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

async function serveStatic(requestPath, response) {
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const filePath = path.normalize(path.join(publicDir, relativePath));

  if (!filePath.startsWith(publicDir)) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  try {
    const file = await readFile(filePath);
    sendText(response, 200, file, contentTypeFor(filePath));
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendText(response, 404, 'Not found');
      return;
    }

    throw error;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getDefaultPiPackageDir() {
  const nodePrefix = path.resolve(path.dirname(process.execPath), '..');
  return path.join(nodePrefix, 'lib', 'node_modules', '@earendil-works', 'pi-coding-agent');
}

async function loadPiSdk() {
  if (!sdkPromise) {
    const packageDir = config.piSdkPackageDir || getDefaultPiPackageDir();
    sdkPromise = import(pathToFileURL(path.join(packageDir, 'dist', 'index.js')).href);
  }

  return sdkPromise;
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
    createdAt: new Date().toISOString(),
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
    throw clientError('Pick the GitHub repo again from the repo list before creating the thread.', 400);
  }

  return {
    ...session,
    branch: session.branch || repo.defaultBranch || '',
    repoProvider: 'github',
    repoVisibility: repo.private ? 'private' : 'public',
    repoAuthHeader: repo.private ? buildGitHubCloneAuthHeader(browserSession.githubToken) : '',
  };
}

function canAccessSession(session, viewerSessionId) {
  return !session?.githubOwnerSessionId || (viewerSessionId && session.githubOwnerSessionId === viewerSessionId);
}

function requireSessionAccess(request, response, session) {
  if (canAccessSession(session, browserSessionId(request))) return false;
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

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeSubmittedAtMs(value) {
  const submittedAtMs = Number(value);
  return Number.isFinite(submittedAtMs) && submittedAtMs > 0 ? submittedAtMs : Date.now();
}

function normalizeBridgeClientId(value) {
  return normalizeClientId(value) || randomUUID();
}

function ensureRunState(name) {
  if (!activeRuns.has(name)) {
    activeRuns.set(name, {
      output: '',
      remoteLogOffset: 0,
      runStatus: 'unknown',
      warning: null,
      events: [],
      nextEventId: 1,
      bridgeFollowing: false,
    });
  }

  return activeRuns.get(name);
}

function recordRunEvent(name, event) {
  const run = ensureRunState(name);
  const payload = {
    id: run.nextEventId++,
    timestamp: new Date().toISOString(),
    ...event,
  };

  if (payload.chunk) {
    run.output += payload.chunk;
  }

  if (payload.runStatus) {
    run.runStatus = payload.runStatus;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'warning')) {
    run.warning = payload.warning || null;
  }

  run.events.push(payload);
  if (run.events.length > 2000) {
    run.events.shift();
  }

  return payload;
}

function appendRunOutput(name, text, runStatus = ensureRunState(name).runStatus) {
  if (!text) return;
  recordRunEvent(name, {
    type: 'chunk',
    chunk: timestampSystemLines(text),
    runStatus,
  });
}

function appendRunStatus(name, runStatus, extra = {}) {
  recordRunEvent(name, {
    type: 'status',
    runStatus,
    ...extra,
  });
}

function setRunState(name, patch) {
  const run = ensureRunState(name);
  Object.assign(run, patch);
  return run;
}

function statusFromRunStatus(runStatus, fallbackStatus = 'unknown') {
  if (runStatus === 'launching') return 'launching';
  if (runStatus === 'queued') return 'launching';
  if (runStatus === 'starting') return 'launching';
  if (runStatus === 'running') return 'running';
  if (runStatus === 'completed') return 'completed';
  if (runStatus === 'failed') return 'failed';
  if (runStatus === 'ready') return 'ready';
  return fallbackStatus;
}

function decorateLiveSession(session) {
  const run = activeRuns.get(session.name);
  const decorated = decorateSession(session, config);

  if (!run) {
    return decorated;
  }

  return {
    ...decorated,
    status: statusFromRunStatus(run.runStatus, decorated.status),
    runStatus: run.runStatus,
    warning: run.warning,
  };
}

function mergeSessions(storedSessions, liveSessions) {
  const byName = new Map();

  for (const session of liveSessions) {
    byName.set(session.name, { ...session, source: 'provider' });
  }

  for (const session of storedSessions) {
    byName.set(session.name, {
      ...byName.get(session.name),
      ...session,
      source: byName.has(session.name) ? 'provider+store' : 'store',
    });
  }

  return [...byName.values()].sort((left, right) =>
    String(right.createdAt || '').localeCompare(String(left.createdAt || '')),
  );
}

async function listSessionsPayload(viewerSessionId = '') {
  const storedSessions = await listStoredSessions(config.sessionFile);
  let liveSessions = [];
  let liveError = null;

  try {
    liveSessions = await provider.listSessions();
  } catch (error) {
    liveError = error.message;
  }

  return {
    provider: provider.info(),
    liveError,
    sessions: mergeSessions(storedSessions, liveSessions)
      .filter((session) => canAccessSession(session, viewerSessionId))
      .map((session) => decorateLiveSession(session)),
  };
}

async function persistRunStatus(session, runStatus) {
  const nextStatus = statusFromRunStatus(runStatus, session.status);

  if (nextStatus === session.status && session.runStatus === runStatus) {
    return session;
  }

  return upsertSession(config.sessionFile, {
    ...session,
    status: nextStatus,
    runStatus,
    updatedAt: new Date().toISOString(),
  });
}

function getBridgeBaseUrl(session) {
  const baseUrl = trimTrailingSlash(session.bridgeUrl || session.httpsUrl || '');
  if (!baseUrl) throw new Error(`No bridge URL is available for ${session.name || 'session'}.`);
  return baseUrl;
}

function bridgeHeaders(session, extra = {}) {
  return {
    authorization: `Bearer ${session.bridgeToken}`,
    ...(provider.bridgeHeaders?.(session) || {}),
    ...extra,
  };
}

async function fetchBridgeJson(session, pathname, options = {}) {
  const response = await fetch(`${getBridgeBaseUrl(session)}${pathname}`, {
    ...options,
    headers: bridgeHeaders(session, options.headers || {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.trim() || `Bridge request failed: ${response.status}`);
  }

  return response.json();
}

async function waitForBridge(session) {
  const startedAt = Date.now();
  let attempts = 0;

  while (Date.now() - startedAt < config.bridgeReadyTimeoutMs) {
    attempts += 1;

    try {
      const response = await fetch(`${getBridgeBaseUrl(session)}/healthz`, {
        headers: provider.bridgeHeaders?.(session) || {},
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return;
      }
    } catch {}

    if (attempts % 5 === 0) {
      appendRunOutput(session.name, '[system] Waiting for the bridge to come up...\n', 'launching');
    }

    await sleep(config.bridgeReadyPollMs);
  }

  throw new Error(`Timed out waiting for the bridge at ${getBridgeBaseUrl(session)}.`);
}

async function consumeSse(response, onEvent) {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });

    while (true) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary === -1) break;

      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
        .trim();

      if (!data) continue;
      await onEvent(JSON.parse(data));
    }
  }
}

function isIdleReusableBridge(session) {
  if (session?.threadBridge) return false;
  if (!session?.bridgeMode || session.bridgeClaimed || session.status !== 'ready' || !session.bridgeUrl || !session.bridgeToken) return false;
  const ttlMs = Number(config.idleBridgeTtlMs);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;
  const updatedAtMs = Date.parse(session.updatedAt || session.createdAt || '');
  return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= ttlMs;
}

function isExpiredIdleBridge(session) {
  if (session?.threadBridge) return false;
  if (!session?.bridgeMode || session.bridgeClaimed || session.status !== 'ready') return false;
  const ttlMs = Number(config.idleBridgeTtlMs);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;
  const updatedAtMs = Date.parse(session.updatedAt || session.createdAt || '');
  return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs > ttlMs;
}

async function pruneExpiredIdleBridges() {
  const sessions = await listStoredSessions(config.sessionFile);

  for (const session of sessions.filter(isExpiredIdleBridge)) {
    try {
      await provider.destroySession(session.name);
      await removeStoredSession(config.sessionFile, session.name);
      activeRuns.delete(session.name);
    } catch (error) {
      console.warn(`[micro-cloud] failed to destroy expired idle sandbox ${session.name}: ${error.message}`);
    }
  }
}

function isClientOwnedBridge(session, clientId) {
  return Boolean(clientId && session?.bridgeOwnerId === clientId);
}

function isLaunchingIntentBridge(session, clientId) {
  return Boolean(
    session?.intentBridge &&
      isClientOwnedBridge(session, clientId) &&
      !session.bridgeClaimed &&
      session.status === 'launching' &&
      session.runStatus !== 'failed',
  );
}

function isReusableIntentBridge(session, clientId) {
  return isIdleReusableBridge(session) && isClientOwnedBridge(session, clientId);
}

function scheduleBridgeRelease(sessionName) {
  setTimeout(async () => {
    const session = await getStoredSession(config.sessionFile, sessionName);
    if (!session?.bridgeMode || !session.bridgeClaimed || session.runStatus !== 'completed') return;

    await upsertSession(config.sessionFile, {
      ...session,
      taskPrompt: '',
      bridgeClaimed: false,
      warmClaimed: false,
      status: 'ready',
      runStatus: 'ready',
      updatedAt: new Date().toISOString(),
    });
    setRunState(sessionName, { runStatus: 'ready', warning: null });
  }, 5000);
}

async function followBridgeRun(sessionName) {
  const run = ensureRunState(sessionName);
  if (run.bridgeFollowing) return;
  run.bridgeFollowing = true;

  let after = 0;
  let done = false;

  try {
    while (!done) {
      const session = await getStoredSession(config.sessionFile, sessionName);
      if (!session?.bridgeUrl || !session?.bridgeRunId || !session?.bridgeToken) {
        return;
      }

      try {
        const response = await fetch(
          `${getBridgeBaseUrl(session)}/runs/${encodeURIComponent(session.bridgeRunId)}/stream?after=${after}`,
          {
            headers: bridgeHeaders(session, { accept: 'text/event-stream' }),
          },
        );

        if (!response.ok || !response.body) {
          const text = await response.text();
          throw new Error(text.trim() || `Bridge stream failed: ${response.status}`);
        }

        await consumeSse(response, async (event) => {
          after = Math.max(after, Number(event.index) || after);

          if (event.type === 'metric') {
            const current = await getStoredSession(config.sessionFile, sessionName);
            const submittedAtMs = Number(current?.submittedAtMs || event.submittedAtMs);
            const hostLatencyMs = Number.isFinite(submittedAtMs) && submittedAtMs > 0 ? Date.now() - submittedAtMs : null;
            const runStatus = event.runStatus || ensureRunState(sessionName).runStatus || 'running';
            recordRunEvent(sessionName, {
              ...event,
              type: 'metric',
              runStatus,
              bridgeLatencyMs: event.latencyMs ?? null,
              latencyMs: hostLatencyMs ?? event.latencyMs ?? null,
            });
            setRunState(sessionName, { warning: event.warning || null });
            if (current) {
              await upsertSession(config.sessionFile, {
                ...current,
                runStatus,
                firstLlmLatencyMs: hostLatencyMs ?? event.latencyMs ?? null,
                updatedAt: new Date().toISOString(),
              });
            }
            return;
          }

          if (event.type === 'tool') {
            recordRunEvent(sessionName, {
              ...event,
              type: 'tool',
              runStatus: event.runStatus || ensureRunState(sessionName).runStatus || 'running',
            });
            return;
          }

          if (event.chunk) {
            appendRunOutput(sessionName, String(event.chunk), event.runStatus || ensureRunState(sessionName).runStatus || 'running');
          }

          if (event.type === 'status' || event.runStatus || event.done || event.warning) {
            const runStatus = event.runStatus || ensureRunState(sessionName).runStatus || 'running';
            appendRunStatus(sessionName, runStatus, {
              warning: event.warning || null,
              exitCode: Object.prototype.hasOwnProperty.call(event, 'exitCode') ? event.exitCode : null,
              done: Boolean(event.done),
            });
            setRunState(sessionName, { warning: event.warning || null });
            const current = await getStoredSession(config.sessionFile, sessionName);
            if (current) {
              await persistRunStatus(current, runStatus);
            }
            if (event.done || runStatus === 'completed' || runStatus === 'failed') {
              if (runStatus === 'completed') {
                scheduleBridgeRelease(sessionName);
              }
              done = true;
            }
          }
        });

        if (!done) {
          await sleep(500);
        }
      } catch (error) {
        setRunState(sessionName, { warning: error.message });
        if (!done) {
          await sleep(1000);
        }
      }
    }
  } finally {
    run.bridgeFollowing = false;
  }
}

async function pushBridgeAuth(session, authText) {
  const settingsText = await readLocalPiSettings();
  if (!authText && !settingsText) return false;

  await fetchBridgeJson(session, '/auth', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ authText: authText || '', settingsText: settingsText || '' }),
  });

  return true;
}

async function startBridgeRun(session) {
  await fetchBridgeJson(session, '/runs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: session.bridgeRunId,
      name: session.name,
      prompt: session.taskPrompt,
      submittedAtMs: session.submittedAtMs,
    }),
  });

  ensureRunState(session.name);
  void followBridgeRun(session.name);
}

function makeWarmBridgeSession() {
  const suffix = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
  return {
    name: `warm-bridge-${suffix}`,
    repoUrl: '',
    repoMode: 'empty',
    branch: '',
    taskPrompt: '',
    visibility: 'public',
    sharePort: config.bridgePort,
    autoRunAgent: false,
    bridgeMode: true,
    warmBridge: true,
    bridgeToken: randomBytes(24).toString('hex'),
    bridgeRunId: randomUUID(),
  };
}

function makeIntentBridgeSession(clientId) {
  const suffix = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
  return {
    name: `intent-bridge-${suffix}`,
    repoUrl: '',
    repoMode: 'empty',
    branch: '',
    taskPrompt: '',
    visibility: 'public',
    sharePort: config.bridgePort,
    autoRunAgent: false,
    bridgeMode: true,
    intentBridge: true,
    bridgeOwnerId: clientId,
    preparedAt: new Date().toISOString(),
    bridgeToken: randomBytes(24).toString('hex'),
    bridgeRunId: randomUUID(),
  };
}

async function startWarmBridgeLaunch(imageSettings) {
  const session = makeWarmBridgeSession();
  warmLaunches.add(session.name);
  const now = new Date().toISOString();

  await upsertSession(config.sessionFile, {
    ...session,
    provider: provider.kind,
    imageRef: imageSettings.imageRef || config.image || '',
    status: 'launching',
    runStatus: 'launching',
    createdAt: now,
    updatedAt: now,
  });

  ensureRunState(session.name);
  setRunState(session.name, {
    output: '',
    remoteLogOffset: 0,
    runStatus: 'launching',
    warning: null,
    events: [],
    nextEventId: 1,
    bridgeFollowing: false,
  });
  appendRunOutput(session.name, '[system] Prewarming a bridge sandbox...\n', 'launching');

  void (async () => {
    try {
      const piAuthText = await readLocalPiAuth();
      const remote = await provider.createSession(session, imageSettings);
      const bridgeUrl = trimTrailingSlash(remote.bridgeUrl || remote.httpsUrl || '');
      const updated = await upsertSession(config.sessionFile, {
        ...session,
        ...remote,
        bridgeUrl,
        status: 'launching',
        runStatus: 'launching',
        updatedAt: new Date().toISOString(),
      });
      appendRunOutput(session.name, `[system] Warm sandbox ready: ${updated.name}.\n`, 'launching');
      await waitForBridge(updated);
      if (piAuthText) {
        await pushBridgeAuth(updated, piAuthText);
        appendRunOutput(session.name, '[system] Loaded local Pi auth into the warm bridge.\n', 'launching');
      }
      await upsertSession(config.sessionFile, {
        ...updated,
        warmBridge: true,
        bridgeClaimed: false,
        warmClaimed: false,
        status: 'ready',
        runStatus: 'ready',
        updatedAt: new Date().toISOString(),
      });
      setRunState(session.name, { runStatus: 'ready', warning: null });
      appendRunOutput(session.name, '[system] Warm bridge ready for the next prompt.\n', 'ready');
    } catch (error) {
      setRunState(session.name, { runStatus: 'failed', warning: error.message });
      appendRunOutput(session.name, `[system] Warm bridge failed: ${error.message}\n`, 'failed');
      appendRunStatus(session.name, 'failed', { warning: error.message, done: true });
      const existing = await getStoredSession(config.sessionFile, session.name);
      if (existing) {
        await upsertSession(config.sessionFile, {
          ...existing,
          status: 'failed',
          runStatus: 'failed',
          warning: error.message,
          updatedAt: new Date().toISOString(),
        });
      }
    } finally {
      warmLaunches.delete(session.name);
    }
  })();
}

async function startIntentBridgeLaunch(clientId, imageSettings) {
  const session = makeIntentBridgeSession(clientId);
  const now = new Date().toISOString();
  const stored = await upsertSession(config.sessionFile, {
    ...session,
    provider: provider.kind,
    imageRef: imageSettings.imageRef || config.image || '',
    status: 'launching',
    runStatus: 'launching',
    createdAt: now,
    updatedAt: now,
  });

  ensureRunState(session.name);
  setRunState(session.name, {
    output: '',
    remoteLogOffset: 0,
    runStatus: 'launching',
    warning: null,
    events: [],
    nextEventId: 1,
    bridgeFollowing: false,
  });
  appendRunOutput(session.name, '[system] Preparing an on-demand bridge for this browser.\n', 'launching');

  void (async () => {
    try {
      const piAuthText = await readLocalPiAuth();
      const remote = await provider.createSession(session, imageSettings);
      const bridgeUrl = trimTrailingSlash(remote.bridgeUrl || remote.httpsUrl || '');
      const latest = (await getStoredSession(config.sessionFile, session.name)) || session;
      const updated = await upsertSession(config.sessionFile, {
        ...latest,
        ...remote,
        bridgeUrl,
        status: 'launching',
        runStatus: 'launching',
        updatedAt: new Date().toISOString(),
      });
      appendRunOutput(session.name, `[system] On-demand sandbox ready: ${updated.name}.\n`, 'launching');
      await waitForBridge(updated);
      if (piAuthText) {
        await pushBridgeAuth(updated, piAuthText);
        appendRunOutput(session.name, '[system] Loaded local Pi auth into the on-demand bridge.\n', 'launching');
      }

      const current = (await getStoredSession(config.sessionFile, session.name)) || updated;
      if (current.bridgeClaimed && current.taskPrompt) {
        appendRunOutput(session.name, '[system] On-demand bridge ready. Starting pi.\n\n', 'launching');
        await startBridgeRun(current);
        const running = await upsertSession(config.sessionFile, {
          ...current,
          status: 'running',
          runStatus: 'running',
          updatedAt: new Date().toISOString(),
        });
        setRunState(session.name, { runStatus: 'running', warning: null });
        await persistRunStatus(running, 'running');
        return;
      }

      await upsertSession(config.sessionFile, {
        ...current,
        bridgeClaimed: false,
        warmClaimed: false,
        status: 'ready',
        runStatus: 'ready',
        updatedAt: new Date().toISOString(),
      });
      setRunState(session.name, { runStatus: 'ready', warning: null });
      appendRunOutput(session.name, '[system] On-demand bridge ready for the next prompt.\n', 'ready');
    } catch (error) {
      setRunState(session.name, { runStatus: 'failed', warning: error.message });
      appendRunOutput(session.name, `[system] On-demand bridge failed: ${error.message}\n`, 'failed');
      appendRunStatus(session.name, 'failed', { warning: error.message, done: true });
      const existing = await getStoredSession(config.sessionFile, session.name);
      if (existing) {
        await upsertSession(config.sessionFile, {
          ...existing,
          status: 'failed',
          runStatus: 'failed',
          warning: error.message,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  })();

  return stored;
}

async function ensureWarmBridgePool() {
  if (!config.warmBridgePoolSize || config.warmBridgePoolSize < 1) return;

  const imageSettings = await readSavedSettings(config.settingsFile);
  const sessions = await listStoredSessions(config.sessionFile);
  const ready = sessions.filter((session) => session.warmBridge && !session.bridgeClaimed && session.status === 'ready').length;
  const needed = Math.max(0, config.warmBridgePoolSize - ready - warmLaunches.size);

  for (let index = 0; index < needed; index += 1) {
    await startWarmBridgeLaunch(imageSettings);
  }
}

async function claimReadyBridgeSession(reusable, normalized, submittedAtMs) {
  const claimed = await upsertSession(config.sessionFile, {
    ...reusable,
    taskPrompt: normalized.taskPrompt,
    submittedAtMs,
    bridgeRunId: randomUUID(),
    bridgeClaimed: true,
    warmClaimed: Boolean(reusable.warmBridge),
    bridgeOwnerId: reusable.bridgeOwnerId || normalized.clientId || null,
    firstLlmLatencyMs: null,
    status: 'launching',
    runStatus: 'launching',
    updatedAt: new Date(submittedAtMs).toISOString(),
  });

  setRunState(claimed.name, {
    output: '',
    remoteLogOffset: 0,
    runStatus: 'launching',
    warning: null,
    events: [],
    nextEventId: 1,
    bridgeFollowing: false,
  });
  appendRunOutput(claimed.name, '[system] Using a prepared idle bridge sandbox.\n', 'launching');
  await startBridgeRun(claimed);
  const running = await upsertSession(config.sessionFile, {
    ...claimed,
    status: 'running',
    runStatus: 'running',
    updatedAt: new Date().toISOString(),
  });
  setRunState(claimed.name, { runStatus: 'running', warning: null });
  void ensureWarmBridgePool();
  return running;
}

async function claimLaunchingIntentBridgeSession(reusable, normalized, submittedAtMs) {
  const claimed = await upsertSession(config.sessionFile, {
    ...reusable,
    taskPrompt: normalized.taskPrompt,
    submittedAtMs,
    bridgeRunId: randomUUID(),
    bridgeClaimed: true,
    firstLlmLatencyMs: null,
    status: 'launching',
    runStatus: 'launching',
    updatedAt: new Date(submittedAtMs).toISOString(),
  });

  ensureRunState(claimed.name);
  appendRunOutput(claimed.name, '[system] Attached the prompt to the preparing bridge.\n', 'launching');
  return claimed;
}

async function claimReusableBridgeSession(body) {
  const normalized = normalizeChatRequest(body, config);
  const sessions = await listStoredSessions(config.sessionFile);
  const submittedAtMs = normalizeSubmittedAtMs(body.submittedAtMs);
  const ownedReady = normalized.clientId
    ? sessions.find((session) => isReusableIntentBridge(session, normalized.clientId))
    : null;

  if (ownedReady) {
    return claimReadyBridgeSession(ownedReady, normalized, submittedAtMs);
  }

  const launching = normalized.clientId
    ? sessions.find((session) => isLaunchingIntentBridge(session, normalized.clientId))
    : null;

  if (launching) {
    return claimLaunchingIntentBridgeSession(launching, normalized, submittedAtMs);
  }

  const unownedReady = sessions.find((session) => isIdleReusableBridge(session) && !session.bridgeOwnerId);
  const reusable = unownedReady || sessions.find(isIdleReusableBridge);

  if (reusable) {
    return claimReadyBridgeSession(reusable, normalized, submittedAtMs);
  }

  void ensureWarmBridgePool();
  return null;
}

async function prepareIntentBridgeSession(body = {}) {
  const clientId = normalizeBridgeClientId(body.clientId);
  const sessions = await listStoredSessions(config.sessionFile);
  const existing = sessions.find((session) => {
    if (!session?.intentBridge || !isClientOwnedBridge(session, clientId) || session.runStatus === 'failed') return false;
    if (isReusableIntentBridge(session, clientId) || isLaunchingIntentBridge(session, clientId)) return true;
    return session.bridgeClaimed && (session.status === 'launching' || session.status === 'running');
  });

  if (existing) {
    return { clientId, session: existing };
  }

  const imageSettings = await readSavedSettings(config.settingsFile);
  const session = await startIntentBridgeLaunch(clientId, imageSettings);
  return { clientId, session };
}

async function startThreadBridgeLaunch(session, imageSettings) {
  const repoAuthHeader = session.repoAuthHeader || '';
  const prepared = {
    ...session,
    bridgeToken: session.bridgeToken || randomBytes(24).toString('hex'),
    bridgeRunId: session.bridgeRunId || randomUUID(),
    bridgeClaimed: Boolean(session.taskPrompt),
  };
  const persisted = repoAuthHeader ? { ...prepared, repoAuthHeader: '' } : prepared;
  const now = new Date().toISOString();
  const stored = await upsertSession(config.sessionFile, {
    ...persisted,
    provider: provider.kind,
    imageRef: imageSettings.imageRef || config.image || '',
    status: 'launching',
    runStatus: 'launching',
    createdAt: now,
    updatedAt: now,
  });

  ensureRunState(stored.name);
  setRunState(stored.name, {
    output: '',
    remoteLogOffset: 0,
    runStatus: 'launching',
    warning: null,
    events: [],
    nextEventId: 1,
    bridgeFollowing: false,
  });
  appendRunOutput(stored.name, `[system] Creating cloud Pi thread for ${stored.repoUrl}.\n`, 'launching');

  void (async () => {
    try {
      if (imageSettings.imageRef) {
        appendRunOutput(stored.name, `[system] Using image ${imageSettings.imageRef}.\n`, 'launching');
      } else if (config.image) {
        appendRunOutput(stored.name, `[system] Using image ${config.image}.\n`, 'launching');
      } else {
        appendRunOutput(stored.name, '[system] Using the default image.\n', 'launching');
      }

      const piAuthText = await readLocalPiAuth();
      const remote = await provider.createSession(repoAuthHeader ? { ...prepared, repoAuthHeader } : prepared, imageSettings);
      const bridgeUrl = trimTrailingSlash(remote.bridgeUrl || remote.httpsUrl || '');
      const latest = (await getStoredSession(config.sessionFile, prepared.name)) || prepared;
      const updated = await upsertSession(config.sessionFile, {
        ...latest,
        ...remote,
        bridgeUrl,
        status: 'launching',
        runStatus: 'launching',
        updatedAt: new Date().toISOString(),
      });
      appendRunOutput(prepared.name, `[system] Thread sandbox ready: ${updated.name}.\n`, 'launching');
      await waitForBridge(updated);
      if (piAuthText) {
        await pushBridgeAuth(updated, piAuthText);
        appendRunOutput(prepared.name, '[system] Loaded local Pi auth into the thread bridge.\n', 'launching');
      }

      const current = (await getStoredSession(config.sessionFile, prepared.name)) || updated;
      if (current.bridgeClaimed && current.taskPrompt) {
        appendRunOutput(prepared.name, '[system] Thread bridge ready. Starting pi.\n\n', 'launching');
        await startBridgeRun(current);
        const running = await upsertSession(config.sessionFile, {
          ...current,
          status: 'running',
          runStatus: 'running',
          updatedAt: new Date().toISOString(),
        });
        setRunState(prepared.name, { runStatus: 'running', warning: null });
        await persistRunStatus(running, 'running');
        return;
      }

      await upsertSession(config.sessionFile, {
        ...current,
        bridgeClaimed: false,
        warmClaimed: false,
        status: 'ready',
        runStatus: 'ready',
        updatedAt: new Date().toISOString(),
      });
      setRunState(prepared.name, { runStatus: 'ready', warning: null });
      appendRunOutput(prepared.name, '[system] Thread bridge ready. Send a prompt.\n', 'ready');
    } catch (error) {
      setRunState(prepared.name, { runStatus: 'failed', warning: error.message });
      appendRunOutput(prepared.name, `[system] Thread bridge failed: ${error.message}\n`, 'failed');
      appendRunStatus(prepared.name, 'failed', { warning: error.message, done: true });
      const existing = await getStoredSession(config.sessionFile, prepared.name);
      if (existing) {
        await upsertSession(config.sessionFile, {
          ...existing,
          status: 'failed',
          runStatus: 'failed',
          warning: error.message,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  })();

  return stored;
}

async function listThreadsPayload(viewerSessionId = '') {
  const sessions = await listStoredSessions(config.sessionFile);
  return {
    provider: provider.info(),
    threads: sessions
      .filter((session) => session.threadBridge && canAccessSession(session, viewerSessionId))
      .map((session) => decorateLiveSession(session)),
  };
}

async function getThreadSession(name) {
  const session = await getStoredSession(config.sessionFile, name);
  if (!session?.threadBridge) {
    throw new Error(`No thread named ${name}.`);
  }
  return session;
}

async function refreshBridgeSessionIfNeeded(session, refreshReference = session) {
  if (!provider.shouldRefreshSession?.(refreshReference)) return session;

  appendRunOutput(session.name, '[system] Waking the idle thread sandbox...\n', 'launching');
  const imageSettings = await readSavedSettings(config.settingsFile);
  const piAuthText = await readLocalPiAuth();
  const remote = await provider.createSession(session, imageSettings);
  const bridgeUrl = trimTrailingSlash(remote.bridgeUrl || remote.httpsUrl || session.bridgeUrl || '');
  const updated = await upsertSession(config.sessionFile, {
    ...session,
    ...remote,
    bridgeUrl,
    status: 'launching',
    runStatus: 'launching',
    updatedAt: new Date().toISOString(),
  });

  await waitForBridge(updated);
  if (piAuthText) {
    await pushBridgeAuth(updated, piAuthText);
  }
  return updated;
}

async function createThreadSession(body, browserSession = null, browserSessionIdValue = '') {
  const session = await enrichGitHubRepoSession({
    ...normalizeThreadRequest(body, config),
    ...(browserSessionIdValue ? { githubOwnerSessionId: browserSessionIdValue } : {}),
    submittedAtMs: normalizeSubmittedAtMs(body.submittedAtMs),
  }, browserSession);
  const existing = await getStoredSession(config.sessionFile, session.name);
  if (existing) {
    throw new Error(`A thread named ${session.name} already exists.`);
  }

  const imageSettings = await readSavedSettings(config.settingsFile);
  return startThreadBridgeLaunch(session, imageSettings);
}

async function promptThreadSession(name, body, viewerSessionId = '') {
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('Prompt is required.');

  const existing = await getThreadSession(name);
  if (!canAccessSession(existing, viewerSessionId)) {
    throw clientError(`Thread ${name} belongs to a different browser session.`, 403);
  }
  if (existing.runStatus === 'failed') throw new Error(`Thread ${name} failed; create a new thread.`);
  if (existing.bridgeClaimed && existing.taskPrompt) throw new Error(`Thread ${name} is already running.`);

  const submittedAtMs = normalizeSubmittedAtMs(body.submittedAtMs);
  const claimed = await upsertSession(config.sessionFile, {
    ...existing,
    taskPrompt: prompt,
    submittedAtMs,
    bridgeRunId: randomUUID(),
    bridgeClaimed: true,
    warmClaimed: false,
    firstLlmLatencyMs: null,
    status: 'launching',
    runStatus: 'launching',
    updatedAt: new Date(submittedAtMs).toISOString(),
  });

  setRunState(name, {
    output: '',
    remoteLogOffset: 0,
    runStatus: 'launching',
    warning: null,
    events: [],
    nextEventId: 1,
    bridgeFollowing: false,
  });

  if (existing.status === 'ready' && existing.bridgeUrl && existing.bridgeToken) {
    appendRunOutput(name, '[system] Starting pi on this repo thread.\n', 'launching');
    try {
      const runnable = await refreshBridgeSessionIfNeeded(claimed, existing);
      await startBridgeRun(runnable);
    } catch (error) {
      const current = (await getStoredSession(config.sessionFile, name)) || claimed;
      const rolledBack = await upsertSession(config.sessionFile, {
        ...current,
        taskPrompt: '',
        bridgeClaimed: false,
        warmClaimed: false,
        status: 'ready',
        runStatus: 'ready',
        warning: error.message,
        updatedAt: new Date().toISOString(),
      });
      setRunState(name, { runStatus: 'failed', warning: error.message });
      appendRunOutput(name, `[system] Failed to start pi: ${error.message}\n`, 'failed');
      appendRunStatus(name, 'failed', { warning: error.message, done: true });
      throw new Error(`Failed to start pi for ${rolledBack.name}: ${error.message}`);
    }
    const running = await upsertSession(config.sessionFile, {
      ...((await getStoredSession(config.sessionFile, name)) || claimed),
      status: 'running',
      runStatus: 'running',
      warning: null,
      updatedAt: new Date().toISOString(),
    });
    setRunState(name, { runStatus: 'running', warning: null });
    return running;
  }

  appendRunOutput(name, '[system] Prompt queued until the thread bridge is ready.\n', 'launching');
  return claimed;
}

async function startSessionLaunch(session, imageSettings) {
  const submittedAtMs = Number(session.submittedAtMs) || Date.now();
  const now = new Date(submittedAtMs).toISOString();
  const preparedSession = session.bridgeMode
    ? {
        ...session,
        submittedAtMs,
        bridgeClaimed: true,
        bridgeOwnerId: session.clientId || session.bridgeOwnerId || null,
        bridgeToken: randomBytes(24).toString('hex'),
        bridgeRunId: randomUUID(),
      }
    : { ...session, submittedAtMs };

  const stored = await upsertSession(config.sessionFile, {
    ...preparedSession,
    provider: provider.kind,
    imageRef: imageSettings.imageRef || config.image || '',
    status: 'launching',
    runStatus: 'launching',
    createdAt: now,
    updatedAt: now,
  });

  ensureRunState(session.name);
  setRunState(session.name, {
    output: '',
    remoteLogOffset: 0,
    runStatus: 'launching',
    warning: null,
    events: [],
    nextEventId: 1,
    bridgeFollowing: false,
  });

  appendRunOutput(session.name, '[system] Starting a fresh cloud sandbox...\n', 'launching');

  void (async () => {
    try {
      if (imageSettings.autoBuildImage && imageSettings.imageRef) {
        appendRunOutput(session.name, `[system] Building and pushing ${imageSettings.imageRef}...\n`, 'launching');
        await buildAndPushImage(config, imageSettings);
        appendRunOutput(session.name, '[system] Image pushed.\n', 'launching');
      } else if (imageSettings.imageRef) {
        appendRunOutput(session.name, `[system] Using image ${imageSettings.imageRef}.\n`, 'launching');
      } else {
        appendRunOutput(session.name, '[system] Using the default image.\n', 'launching');
      }

      appendRunOutput(session.name, '[system] Provisioning the cloud sandbox...\n', 'launching');
      const piAuthText = preparedSession.bridgeMode ? await readLocalPiAuth() : null;
      const remote = await provider.createSession(preparedSession, imageSettings);
      const bridgeUrl = preparedSession.bridgeMode
        ? trimTrailingSlash(remote.bridgeUrl || remote.httpsUrl || '')
        : null;
      const updated = await upsertSession(config.sessionFile, {
        ...stored,
        ...remote,
        bridgeUrl,
        status: preparedSession.bridgeMode ? 'ready' : preparedSession.autoRunAgent ? 'running' : 'ready',
        runStatus: preparedSession.bridgeMode ? 'ready' : preparedSession.autoRunAgent ? 'running' : 'ready',
        updatedAt: new Date().toISOString(),
      });

      setRunState(session.name, {
        runStatus: preparedSession.bridgeMode ? 'ready' : preparedSession.autoRunAgent ? 'running' : 'ready',
        warning: null,
      });

      appendRunOutput(session.name, `[system] Sandbox ready: ${updated.name}.\n`, preparedSession.bridgeMode ? 'ready' : 'running');

      if (updated.connectCommand) {
        appendRunOutput(session.name, `[system] Connect: ${updated.connectCommand}\n`, preparedSession.bridgeMode ? 'ready' : 'running');
      }

      if (preparedSession.bridgeMode) {
        appendRunOutput(session.name, '[system] Waiting for the bridge...\n', 'launching');
        await waitForBridge(updated);
        if (piAuthText) {
          await pushBridgeAuth(updated, piAuthText);
          appendRunOutput(session.name, '[system] Loaded local Pi auth into the bridge.\n', 'launching');
        }
        appendRunOutput(session.name, '[system] Bridge ready. Starting pi...\n\n', 'launching');
        await startBridgeRun(updated);
        const running = await upsertSession(config.sessionFile, {
          ...updated,
          status: 'running',
          runStatus: 'running',
          updatedAt: new Date().toISOString(),
        });
        setRunState(session.name, { runStatus: 'running', warning: null });
        await persistRunStatus(running, 'running');
        return;
      }

      if (preparedSession.autoRunAgent) {
        appendRunOutput(session.name, '[system] pi is running. Streaming output...\n\n', 'running');
      } else {
        appendRunOutput(session.name, '[system] Sandbox is ready. Start pi from the session table below.\n', 'ready');
      }
    } catch (error) {
      setRunState(session.name, {
        runStatus: 'failed',
        warning: error.message,
      });
      appendRunOutput(session.name, `[system] Launch failed: ${error.message}\n`, 'failed');
      appendRunStatus(session.name, 'failed', {
        warning: error.message,
        done: true,
      });
      const existing = await getStoredSession(config.sessionFile, session.name);

      if (existing) {
        await upsertSession(config.sessionFile, {
          ...existing,
          status: 'failed',
          runStatus: 'failed',
          updatedAt: new Date().toISOString(),
        });
      }
    }
  })();

  return stored;
}

async function provisionHostDispatchRemote(session, imageSettings, stored) {
  try {
    if (imageSettings.autoBuildImage && imageSettings.imageRef) {
      appendRunOutput(session.name, `[system] Building and pushing ${imageSettings.imageRef} for remote tools...\n`, 'launching');
      await buildAndPushImage(config, imageSettings);
      appendRunOutput(session.name, '[system] Image pushed for remote tools.\n', 'launching');
    } else if (imageSettings.imageRef) {
      appendRunOutput(session.name, `[system] Provisioning remote tools with image ${imageSettings.imageRef}.\n`, 'launching');
    } else {
      appendRunOutput(session.name, '[system] Provisioning remote tools with the default image.\n', 'launching');
    }

    const remote = await provider.createSession(session, imageSettings);
    const updated = await upsertSession(config.sessionFile, {
      name: session.name,
      ...remote,
      bridgeUrl: null,
      remoteProvisionStatus: 'ready',
      remoteReadyAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    appendRunOutput(session.name, `[system] Remote tool sandbox ready: ${updated.name}.\n`, ensureRunState(session.name).runStatus);
    if (updated.connectCommand) {
      appendRunOutput(session.name, `[system] Connect: ${updated.connectCommand}\n`, ensureRunState(session.name).runStatus);
    }

    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setRunState(session.name, { warning: message });
    appendRunOutput(session.name, `[system] Remote tool sandbox failed: ${message}\n`, ensureRunState(session.name).runStatus);
    await upsertSession(config.sessionFile, {
      name: session.name,
      remoteProvisionStatus: 'failed',
      remoteProvisionWarning: message,
      warning: message,
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
}

function persistHostDispatchMetric(sessionName, event) {
  recordRunEvent(sessionName, {
    ...event,
    type: 'metric',
    runStatus: event.runStatus || 'running',
    bridgeLatencyMs: null,
    latencyMs: event.latencyMs,
  });

  void upsertSession(config.sessionFile, {
    name: sessionName,
    status: 'running',
    runStatus: 'running',
    firstLlmLatencyMs: event.latencyMs,
    firstLlmCallStartedAtMs: event.firstLlmCallStartedAtMs,
    updatedAt: new Date().toISOString(),
  });
}

function persistHostDispatchStatus(sessionName, runStatus, extra = {}) {
  appendRunStatus(sessionName, runStatus, extra);
  setRunState(sessionName, { runStatus, warning: extra.warning || null });

  void (async () => {
    const current = await getStoredSession(config.sessionFile, sessionName);
    await upsertSession(config.sessionFile, {
      name: sessionName,
      status: statusFromRunStatus(runStatus, current?.status || 'unknown'),
      runStatus,
      warning: Object.prototype.hasOwnProperty.call(extra, 'warning') ? extra.warning : current?.warning || null,
      updatedAt: new Date().toISOString(),
    });
  })();
}

async function startHostDispatchSession(session, imageSettings) {
  const submittedAtMs = Number(session.submittedAtMs) || Date.now();
  const now = new Date(submittedAtMs).toISOString();
  const preparedSession = {
    ...session,
    submittedAtMs,
    bridgeMode: false,
    bridgeClaimed: false,
    warmClaimed: false,
    autoRunAgent: false,
    sharePort: null,
    visibility: 'private',
    hostDispatchMode: true,
    firstLlmLatencyMs: null,
  };
  const stored = await upsertSession(config.sessionFile, {
    ...preparedSession,
    provider: provider.kind,
    imageRef: imageSettings.imageRef || config.image || '',
    status: 'launching',
    runStatus: 'launching',
    remoteProvisionStatus: 'launching',
    createdAt: now,
    updatedAt: now,
  });

  setRunState(session.name, {
    output: '',
    remoteLogOffset: 0,
    runStatus: 'launching',
    warning: null,
    events: [],
    nextEventId: 1,
    bridgeFollowing: false,
  });
  appendRunOutput(session.name, '[system] Starting host Pi dispatch for the cold prompt.\n', 'launching');
  appendRunOutput(session.name, '[system] Provisioning the remote tool sandbox in parallel.\n', 'launching');

  const remoteReadyPromise = provisionHostDispatchRemote(preparedSession, imageSettings, stored);
  remoteReadyPromise.catch(() => {});

  void runHostPiSession({
    session: stored,
    config,
    provider,
    remoteReadyPromise,
    emitOutput: (text, runStatus) => appendRunOutput(session.name, text, runStatus),
    emitMetric: (event) => persistHostDispatchMetric(session.name, event),
    emitStatus: (runStatus, extra) => persistHostDispatchStatus(session.name, runStatus, extra),
    emitEvent: (event) => recordRunEvent(session.name, event),
  });

  return stored;
}

async function syncRunOutput(session) {
  const run = ensureRunState(session.name);

  if (session.bridgeMode || session.hostDispatchMode || !provider.readOutput) {
    return run;
  }

  try {
    const remote = await provider.readOutput(session, {
      offset: run.remoteLogOffset,
    });

    if (remote.chunk) {
      run.output += remote.chunk;
    }

    if (typeof remote.nextOffset === 'number') {
      run.remoteLogOffset = remote.nextOffset;
    }

    if (remote.runStatus) {
      const previousStatus = run.runStatus;
      run.runStatus = remote.runStatus;

      if (previousStatus !== remote.runStatus) {
        await persistRunStatus(session, remote.runStatus);
      }
    }

    run.warning = remote.warning || null;
  } catch (error) {
    run.warning = error.message;
  }

  return run;
}

async function createChatSession(body) {
  if (!config.hostDispatchEnabled) {
    const warmSession = await claimReusableBridgeSession(body);
    if (warmSession) return warmSession;
  }

  const session = {
    ...normalizeChatRequest(body, config),
    submittedAtMs: normalizeSubmittedAtMs(body.submittedAtMs),
  };
  const existing = await getStoredSession(config.sessionFile, session.name);

  if (existing) {
    throw new Error(`A session named ${session.name} already exists in data/sessions.json.`);
  }

  const imageSettings = await readSavedSettings(config.settingsFile);
  return config.hostDispatchEnabled
    ? startHostDispatchSession(session, imageSettings)
    : startSessionLaunch(session, imageSettings);
}

async function createManualSession(body) {
  const session = normalizeCreateRequest(body, config);
  const existing = await getStoredSession(config.sessionFile, session.name);

  if (existing) {
    throw new Error(`A session named ${session.name} already exists in data/sessions.json.`);
  }

  const imageSettings = await readSavedSettings(config.settingsFile);
  return startSessionLaunch(session, imageSettings);
}

function sendSse(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    if (request.method === 'GET' && pathname === '/healthz') {
      sendJson(response, 200, { ok: true, provider: provider.info() });
      return;
    }

    if (requireApiToken(request, response, url)) return;
    if (pathname.startsWith('/api/') && pathname !== '/api/auth/github/callback' && requireTrustedBrowserRequest(request, response)) return;

    if (request.method === 'GET' && pathname === '/api/report') {
      sendJson(response, 200, { provider: provider.info(), report });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/settings') {
      sendJson(response, 200, await readAppSettings(config));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/auth/github') {
      if (requireTrustedBrowserRequest(request, response)) return;
      const sessionId = requireBrowserSessionId(request, response);
      if (!sessionId) return;
      sendJson(response, 200, publicGitHubAuth(readBrowserSession(sessionId)));
      return;
    }

    if (request.method === 'POST' && pathname === '/api/auth/github/login') {
      if (!githubAuthConfigured(config)) {
        sendJson(response, 400, { error: 'Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET.' });
        return;
      }
      if (requireTrustedBrowserRequest(request, response)) return;
      const sessionId = requireBrowserSessionId(request, response);
      if (!sessionId) return;
      const body = await readJsonBody(request);
      const state = randomUUID();
      githubLogins.set(state, {
        createdAt: Date.now(),
        returnTo: trimReturnTo(body.returnTo, request),
        sessionId,
      });
      sendJson(response, 200, {
        loginUrl: buildGitHubAuthorizeUrl(config, githubCallbackUrl(request), state),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/auth/github/callback') {
      const code = String(url.searchParams.get('code') || '').trim();
      const state = String(url.searchParams.get('state') || '').trim();
      const login = githubLogins.get(state);
      githubLogins.delete(state);

      if (!login || !code) {
        sendText(response, 400, 'GitHub login expired or failed.');
        return;
      }

      try {
        const token = await exchangeGitHubCode(config, code, githubCallbackUrl(request));
        const user = await fetchGitHubUser(token);
        writeBrowserSession(login.sessionId, { githubToken: token, githubUser: user, githubRepos: [] });
        const redirectTo = new URL(login.returnTo);
        redirectTo.searchParams.set('github', 'connected');
        sendText(response, 302, '', 'text/plain; charset=utf-8', { location: redirectTo.toString() });
      } catch (error) {
        const redirectTo = new URL(login.returnTo);
        redirectTo.searchParams.set('github', 'error');
        redirectTo.searchParams.set('message', error.message);
        sendText(response, 302, '', 'text/plain; charset=utf-8', { location: redirectTo.toString() });
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/api/auth/github/logout') {
      if (requireTrustedBrowserRequest(request, response)) return;
      const sessionId = requireBrowserSessionId(request, response);
      if (!sessionId) return;
      sendJson(response, 200, publicGitHubAuth(clearBrowserSessionGithub(sessionId)));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/github/repos') {
      if (requireTrustedBrowserRequest(request, response)) return;
      const sessionId = requireBrowserSessionId(request, response);
      if (!sessionId) return;
      sendJson(response, 200, await githubRepoPayload(sessionId, readBrowserSession(sessionId)));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/auth/openai-codex') {
      sendJson(response, 200, await codexAuthStatus());
      return;
    }

    if (request.method === 'POST' && pathname === '/api/auth/openai-codex/login') {
      sendJson(response, 202, await startCodexDeviceLogin());
      return;
    }

    if (request.method === 'GET' && pathname.startsWith('/api/auth/openai-codex/login/')) {
      const id = pathname.split('/').pop();
      const job = authLogins.get(id);
      if (!job) {
        sendJson(response, 404, { error: 'Login not found' });
        return;
      }
      sendJson(response, 200, publicAuthLogin(job));
      return;
    }

    if (request.method === 'POST' && pathname === '/api/settings') {
      const body = await readJsonBody(request);
      sendJson(response, 200, await saveAppSettings(config, body));
      return;
    }

    if (request.method === 'POST' && pathname === '/api/bridge-intents') {
      const body = await readJsonBody(request);
      const prepared = await prepareIntentBridgeSession(body);
      sendJson(response, 202, {
        provider: provider.info(),
        clientId: prepared.clientId,
        session: decorateLiveSession(prepared.session),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/threads') {
      sendJson(response, 200, await listThreadsPayload(browserSessionId(request)));
      return;
    }

    if (request.method === 'POST' && pathname === '/api/threads') {
      const body = await readJsonBody(request);
      const sessionId = browserSessionId(request);
      let browserSession = null;

      if (body.repoSource === 'github') {
        if (!sessionId) {
          sendJson(response, 400, { error: 'Browser session is required. Reload the page and try again.' });
          return;
        }
        browserSession = readBrowserSession(sessionId);
      }

      const thread = await createThreadSession(body, browserSession, sessionId);
      sendJson(response, 202, {
        provider: provider.info(),
        thread: decorateLiveSession(thread),
      });
      return;
    }

    const threadMatch = pathname.match(/^\/api\/threads\/([^/]+)$/);
    if (request.method === 'GET' && threadMatch) {
      const name = decodeURIComponent(threadMatch[1]);
      const thread = await getThreadSession(name);
      if (requireSessionAccess(request, response, thread)) return;
      sendJson(response, 200, {
        provider: provider.info(),
        thread: decorateLiveSession(thread),
      });
      return;
    }

    const threadMessageMatch = pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
    if (request.method === 'POST' && threadMessageMatch) {
      const name = decodeURIComponent(threadMessageMatch[1]);
      const body = await readJsonBody(request);
      const thread = await promptThreadSession(name, body, browserSessionId(request));
      sendJson(response, 202, {
        provider: provider.info(),
        thread: decorateLiveSession(thread),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/sessions') {
      sendJson(response, 200, await listSessionsPayload(browserSessionId(request)));
      return;
    }

    if (request.method === 'POST' && pathname === '/api/chat') {
      const body = await readJsonBody(request);
      const session = await createChatSession(body);
      sendJson(response, 202, {
        provider: provider.info(),
        session: decorateLiveSession(session),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/sessions') {
      const body = await readJsonBody(request);
      const session = await createManualSession(body);
      sendJson(response, 202, {
        provider: provider.info(),
        session: decorateLiveSession(session),
      });
      return;
    }

    const streamMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
    if (request.method === 'GET' && streamMatch) {
      const name = decodeURIComponent(streamMatch[1]);
      const session = await getStoredSession(config.sessionFile, name);

      if (!session) {
        sendJson(response, 404, { error: `No stored session named ${name}.` });
        return;
      }
      if (requireSessionAccess(request, response, session)) return;

      const after = Number(url.searchParams.get('after'));
      let lastId = Number.isFinite(after) && after > 0 ? after : 0;
      let closed = false;

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        ...corsHeaders,
      });
      response.write('retry: 1000\n\n');

      request.on('close', () => {
        closed = true;
      });

      while (!closed) {
        const currentSession = await getStoredSession(config.sessionFile, name);
        const run = activeRuns.get(name);

        if (run) {
          for (const event of run.events) {
            if (event.id <= lastId) continue;
            const decorated = currentSession ? decorateLiveSession(currentSession) : null;
            sendSse(response, {
              ...event,
              session: decorated,
            });
            lastId = event.id;
            if (event.done) {
              response.end();
              return;
            }
          }
        }

        if (!currentSession && !run) {
          response.end();
          return;
        }

        await sleep(100);
      }

      return;
    }

    const outputMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/output$/);
    if (request.method === 'GET' && outputMatch) {
      const name = decodeURIComponent(outputMatch[1]);
      const session = await getStoredSession(config.sessionFile, name);

      if (!session) {
        sendJson(response, 404, { error: `No stored session named ${name}.` });
        return;
      }
      if (requireSessionAccess(request, response, session)) return;

      const run = await syncRunOutput(session);
      const offset = Number(url.searchParams.get('offset'));
      const normalizedOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
      const chunk = run.output.slice(normalizedOffset);
      const decorated = decorateLiveSession({
        ...session,
        status: statusFromRunStatus(run.runStatus, session.status),
        runStatus: run.runStatus,
      });

      sendJson(response, 200, {
        session: decorated,
        chunk,
        nextOffset: run.output.length,
        runStatus: run.runStatus,
        warning: run.warning,
        events: run.events,
      });
      return;
    }

    const shareMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/share$/);
    if (request.method === 'POST' && shareMatch) {
      const name = decodeURIComponent(shareMatch[1]);
      const existing = await getStoredSession(config.sessionFile, name);

      if (!existing) {
        sendJson(response, 404, { error: `No stored session named ${name}.` });
        return;
      }
      if (requireSessionAccess(request, response, existing)) return;

      const body = await readJsonBody(request);
      const visibility = body.visibility === 'public' ? 'public' : 'private';
      const sharePort = Number(body.sharePort);
      const normalizedSharePort = Number.isFinite(sharePort) && sharePort > 0 ? sharePort : existing.sharePort || null;
      const remote = await provider.setShare(name, {
        visibility,
        sharePort: normalizedSharePort,
      });
      const updated = await upsertSession(config.sessionFile, {
        ...existing,
        ...remote,
        visibility,
        sharePort: normalizedSharePort,
        updatedAt: new Date().toISOString(),
      });

      sendJson(response, 200, {
        provider: provider.info(),
        session: decorateLiveSession(updated),
      });
      return;
    }

    if (request.method === 'GET') {
      await serveStatic(pathname, response);
      return;
    }

    sendJson(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    sendJson(response, Number(error.statusCode) || 500, {
      error: error.message,
      provider: provider.info(),
    });
  }
});

if (config.hostDispatchEnabled) {
  await preloadHostPiRunner(config);
}

server.listen(config.port, () => {
  console.log(`[micro-cloud] listening on http://localhost:${config.port} (${provider.kind})`);
  void pruneExpiredIdleBridges();
  void ensureWarmBridgePool();
  if (Number.isFinite(config.idleBridgeTtlMs) && config.idleBridgeTtlMs > 0) {
    setInterval(() => void pruneExpiredIdleBridges(), config.idleBridgeTtlMs).unref();
  }
});
