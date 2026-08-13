import { performance } from 'node:perf_hooks';

import { readPiProfile, savePiProfile } from '../pi-profile.js';
import { listRecentProjects, saveRecentProject } from '../recent-projects.js';
import { report } from '../report.js';
import { readAppSettings, saveAppSettings } from '../settings.js';
import { getStoredSession, upsertSession } from '../store.js';
import { mergeTraceEvents, readStoredTraceEvents } from '../trace-store.js';

export function createRequestHandler({ config, provider, http, auth, runState, threads, sessions }) {
  const { corsHeadersFor, bindCorsRequest, sendJson, sendText, readJsonBody, serveStatic } = http;
  const {
    requireApiToken,
    requireTrustedBrowserRequest,
    requireAuthMutationOrigin,
    browserSessionId,
    hasTrustedControlToken,
    requireBrowserSessionId,
    readBrowserSession,
    publicGitHubAuth,
    isGitHubAuthConfigured,
    startGitHubLogin,
    completeGitHubLogin,
    startGitHubAppInstall,
    completeGitHubAppInstall,
    githubRepoPayload,
    codexAuthStatus,
    startCodexDeviceLogin,
    logoutCodexAuth,
    claudeCodeAuthStatus,
    startClaudeCodeLogin,
    logoutClaudeCodeAuth,
    submitClaudeCodeLoginCode,
    getAuthLogin,
    publicAuthLogin,
    requireSessionAccess,
    loadPiDefaults,
    currentUser,
    publicMe,
    requireUser,
    logout,
  } = auth;
  const {
    activeRuns,
    decorateLiveSession,
    listSessionsPayload,
    inactiveStoredRunStatus,
    sendSse,
    addRunSubscriber,
    closeRunSubscriber,
    enqueueRunSubscriber,
    retainedOutputChunk,
    statusFromRunStatus,
    generateWorkspaceLaunchSuggestionsForThreads,
  } = runState;
  const {
    listThreadPerformancePayload,
    listThreadsPayload,
    createThreadSession,
    archiveThreadSession,
    unarchiveThreadSession,
    stopThreadSession,
    suspendThreadSession,
    resumeThreadSession,
    deleteThreadSession,
    threadDiffPayload,
    createThreadPullRequestPayload,
    threadWorkflowPayload,
    threadArtifactPayload,
    threadImageArtifactPayload,
    threadHtmlArtifactPayload,
    threadHtmlArtifactStatePayload,
    saveThreadHtmlArtifactStatePayload,
    saveThreadArtifactPayload,
    getThreadSession,
    promptThreadSession,
  } = threads;
  const { createChatSession, createManualSession, syncRunOutput } = sessions;

  function createTrace(url) {
    const enabled = ['1', 'true', 'yes'].includes(String(url.searchParams.get('trace') || '').toLowerCase());
    const started = performance.now();
    const steps = [];
    async function step(label, task) {
      if (!enabled) return task();
      const before = performance.now();
      try {
        return await task();
      } finally {
        steps.push({ label, ms: Math.round((performance.now() - before) * 10) / 10 });
      }
    }
    return {
      enabled,
      step,
      wrap(payload) {
        return enabled ? { ...payload, trace: { totalMs: Math.round((performance.now() - started) * 10) / 10, steps } } : payload;
      },
    };
  }

  function traceReadLimit(url) {
    const value = String(url.searchParams.get('traceLimit') || '').trim().toLowerCase();
    if (value === 'all') return Infinity;
    const limit = Number(value);
    return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
  }

  async function storedTraceEvents(name, limit) {
    try {
      return await readStoredTraceEvents(config, name, limit === undefined ? undefined : { limit });
    } catch (error) {
      console.warn(`[trace-store] Failed to read trace events for ${name}: ${error.message}`);
      return [];
    }
  }

  function wantsInteractiveHtmlArtifact(url) {
    const mode = String(url.searchParams.get('interactive') || url.searchParams.get('mode') || '').toLowerCase();
    return ['1', 'true', 'yes', 'interactive'].includes(mode);
  }

  function htmlArtifactCsp(interactive = false) {
    if (!interactive) return "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'none'; sandbox";
    return [
      "default-src 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      "img-src 'self' https: data: blob:",
      "media-src 'self' https: data: blob:",
      "font-src 'self' https: data:",
      "style-src 'self' 'unsafe-inline' https:",
      "script-src 'self' 'unsafe-inline' https: blob:",
      "connect-src 'self' https:",
      "worker-src 'self' blob:",
      "frame-src 'self' https:",
      'sandbox allow-scripts allow-forms allow-pointer-lock allow-popups allow-modals',
    ].join('; ');
  }

  const interactiveHtmlArtifactShim = `<script data-spanner-interaction-shim>(()=>{let t=null;const s='[tabindex],canvas,button,input,select,textarea,a[href]';const u=n=>n&&n!==document.body&&n!==document.documentElement;const p=e=>{const n=e.target?.closest?.(s)||e.target;if(u(n))t=n};window.addEventListener('pointerover',p,true);window.addEventListener('pointerdown',p,true);window.addEventListener('focusin',p,true);window.addEventListener('keydown',e=>{if(u(e.target))return;const r=t||document.querySelector(s);if(!r||r===e.target)return;const c=new KeyboardEvent(e.type,{key:e.key,code:e.code,location:e.location,ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,altKey:e.altKey,metaKey:e.metaKey,repeat:e.repeat,bubbles:true,cancelable:true});if(!r.dispatchEvent(c))e.preventDefault()},true);})();</script>`;

  function htmlArtifactData(artifact, interactive = false) {
    if (!interactive) return artifact.data;
    const html = String(artifact.data || '');
    return /<\/body\s*>/i.test(html)
      ? html.replace(/<\/body\s*>/i, `${interactiveHtmlArtifactShim}</body>`)
      : `${html}${interactiveHtmlArtifactShim}`;
  }

  return async function handleRequest(request, response) {
    try {
      bindCorsRequest?.(request, response);
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const trace = createTrace(url);

      if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeadersFor(request));
        response.end();
        return;
      }

      if (request.method === 'GET' && pathname === '/healthz') {
        sendJson(response, 200, { ok: true, provider: provider.info() });
        return;
      }

      if (requireApiToken(request, response, url)) return;
      if (request.method === 'POST' && pathname.startsWith('/api/auth/') && requireAuthMutationOrigin(request, response, url)) return;
      if (pathname.startsWith('/api/') && !['/api/auth/github/callback', '/api/auth/github/app/callback'].includes(pathname) && requireTrustedBrowserRequest(request, response)) return;

      const isApiRoute = pathname.startsWith('/api/');
      const viewerSessionId = isApiRoute ? browserSessionId(request) : '';
      const trusted = isApiRoute ? hasTrustedControlToken(request, url) : false;
      const publicApiRoute = pathname === '/api/me'
        || pathname === '/api/bootstrap'
        || pathname === '/api/auth/github'
        || pathname === '/api/auth/github/login'
        || pathname === '/api/auth/github/callback'
        || pathname === '/api/auth/github/app/callback'
        || pathname === '/api/auth/github/logout'
        || pathname === '/api/auth/logout';
      let user = null;
      if (isApiRoute) {
        user = await trace.step('auth.currentUser', () => currentUser(request));
        if (!publicApiRoute) {
          const context = await trace.step('auth.requireUser', () => requireUser(request, response, url, user));
          if (!context) return;
          user = context.user;
        }
      }

      if (request.method === 'GET' && pathname === '/api/me') {
        sendJson(response, 200, publicMe(user, trusted));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/bootstrap') {
        const page = String(url.searchParams.get('page') || 'workspace').trim().toLowerCase();
        const fast = ['1', 'true', 'yes'].includes(String(url.searchParams.get('fast') || '').trim().toLowerCase());
        const canReadProtected = trusted || Boolean(user) || !config.authRequired;

        if (!canReadProtected) {
          sendJson(response, 401, {
            error: isGitHubAuthConfigured() ? 'Sign in with GitHub to continue.' : 'Sign-in is required but GitHub OAuth is not configured.',
            authRequired: true,
            githubConfigured: isGitHubAuthConfigured(),
          });
          return;
        }

        if (page === 'thread') {
          const name = String(url.searchParams.get('name') || '').trim();
          if (!name) {
            sendJson(response, 400, { error: 'Missing main agent name.' });
            return;
          }

          const thread = await trace.step('thread.getSession', () => getThreadSession(name));
          if (!thread) {
            sendJson(response, 404, { error: `No stored session named ${name}.` });
            return;
          }
          if (requireSessionAccess(request, response, thread, url, user)) return;

          const defaults = await trace.step('defaults.load', () => loadPiDefaults(user, { staleOk: true }));
          if (fast) {
            const session = decorateLiveSession(thread);
            sendJson(response, 200, trace.wrap({
              provider: provider.info(),
              defaults,
              thread: session,
              output: { deferred: true, session, runStatus: session.runStatus || session.status || 'unknown' },
            }));
            return;
          }

          const offset = Number(url.searchParams.get('offset'));
          const run = await trace.step('thread.syncOutput', () => syncRunOutput(thread));
          const storedEvents = await trace.step('trace.readEvents', () => storedTraceEvents(name, traceReadLimit(url)));
          const output = retainedOutputChunk(run, Number.isFinite(offset) && offset > 0 ? offset : 0);
          const session = decorateLiveSession({
            ...thread,
            status: statusFromRunStatus(run.runStatus, thread.status),
            runStatus: run.runStatus,
          });

          sendJson(response, 200, trace.wrap({
            provider: provider.info(),
            defaults,
            thread: session,
            output: {
              session,
              ...output,
              runStatus: run.runStatus,
              warning: run.warning,
              events: mergeTraceEvents(storedEvents, run.events),
            },
          }));
          return;
        }

        const authStatusPromise = fast
          ? Promise.resolve({ codex: { deferred: true }, claudeCode: { deferred: true }, github: { deferred: true, configured: isGitHubAuthConfigured() } })
          : Promise.all([
              trace.step('auth.codex', () => codexAuthStatus(user)),
              trace.step('auth.claudeCode', () => claudeCodeAuthStatus(user)),
              trace.step('auth.github', () => publicGitHubAuth(user || readBrowserSession(viewerSessionId))),
            ]).then(([codex, claudeCode, github]) => ({ codex, claudeCode, github }));

        if (page === 'project') {
          const [authStatus, threadPayload, recentProjects] = await Promise.all([
            authStatusPromise,
            trace.step('threads.payload', () => listThreadsPayload(viewerSessionId, trusted, user, { traceStep: trace.step })),
            trace.step('projects.recent', () => listRecentProjects(config.recentProjectsFile, user?.id || '')).catch(() => []),
          ]);
          const basePayload = { provider: provider.info(), me: publicMe(user, trusted), ...authStatus, defaults: {}, threads: [] };
          sendJson(response, 200, trace.wrap({ ...basePayload, ...threadPayload, recentProjects }));
          return;
        }

        const [authStatus, threadPayload] = await Promise.all([
          authStatusPromise,
          trace.step('threads.payload', () => listThreadsPayload(viewerSessionId, trusted, user, { traceStep: trace.step })),
        ]);
        const basePayload = { provider: provider.info(), me: publicMe(user, trusted), ...authStatus, defaults: {}, threads: [] };
        sendJson(response, 200, trace.wrap({ ...basePayload, ...threadPayload }));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/report') {
        sendJson(response, 200, { provider: provider.info(), report });
        return;
      }

      if (request.method === 'GET' && (pathname === '/api/performance' || pathname === '/api/threads/performance')) {
        sendJson(response, 200, await listThreadPerformancePayload(viewerSessionId, trusted, user, { source: url.searchParams.get('source') }));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/settings') {
        sendJson(response, 200, await readAppSettings(config));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/pi-profile') {
        sendJson(response, 200, await readPiProfile(config, trusted ? null : user));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/pi-profile') {
        const body = await readJsonBody(request);
        sendJson(response, 200, await savePiProfile(config, body, trusted ? null : user));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/recent-projects') {
        sendJson(response, 200, { projects: await listRecentProjects(config.recentProjectsFile, user?.id || '') });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/auth/github') {
        const sessionId = requireBrowserSessionId(request, response);
        if (!sessionId) return;
        sendJson(response, 200, await publicGitHubAuth(user || readBrowserSession(sessionId)));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/auth/github/login') {
        if (!isGitHubAuthConfigured()) {
          sendJson(response, 400, { error: 'Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET.' });
          return;
        }
        const sessionId = requireBrowserSessionId(request, response);
        if (!sessionId) return;
        const body = await readJsonBody(request);
        const result = startGitHubLogin(request, sessionId, body, user);
        sendText(response, 200, `${JSON.stringify({ loginUrl: result.loginUrl }, null, 2)}\n`, 'application/json; charset=utf-8', result.headers || {});
        return;
      }

      if (request.method === 'GET' && pathname === '/api/auth/github/callback') {
        const result = await completeGitHubLogin(request, url);
        if (result.text) {
          sendText(response, result.statusCode, result.text);
          return;
        }
        sendText(response, 302, '', 'text/plain; charset=utf-8', { location: result.location, ...(result.headers || {}) });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/auth/github/app/install') {
        const context = user ? { user } : await requireUser(request, response, url, user);
        if (!context) return;
        const body = await readJsonBody(request);
        sendJson(response, 200, startGitHubAppInstall(request, context.user, body));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/auth/github/app/callback') {
        const result = await completeGitHubAppInstall(request, url);
        if (result.text) {
          sendText(response, result.statusCode, result.text);
          return;
        }
        sendText(response, 302, '', 'text/plain; charset=utf-8', { location: result.location });
        return;
      }

      if (request.method === 'POST' && (pathname === '/api/auth/github/logout' || pathname === '/api/auth/logout')) {
        const sessionId = requireBrowserSessionId(request, response);
        if (!sessionId) return;
        const result = await logout(request, sessionId);
        sendText(response, 200, `${JSON.stringify(result.body, null, 2)}\n`, 'application/json; charset=utf-8', result.headers);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/github/repos') {
        const sessionId = requireBrowserSessionId(request, response);
        if (!sessionId) return;
        sendJson(response, 200, await githubRepoPayload(sessionId, readBrowserSession(sessionId), user));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/auth/openai-codex') {
        sendJson(response, 200, await codexAuthStatus(user));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/auth/openai-codex/login') {
        sendJson(response, 202, await startCodexDeviceLogin(user));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/auth/openai-codex/logout') {
        sendJson(response, 200, await logoutCodexAuth(user));
        return;
      }

      if (request.method === 'GET' && pathname.startsWith('/api/auth/openai-codex/login/')) {
        const id = pathname.split('/').pop();
        const job = getAuthLogin(id, user);
        if (!job) {
          sendJson(response, 404, { error: 'Login not found' });
          return;
        }
        sendJson(response, 200, publicAuthLogin(job));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/auth/claude-code') {
        sendJson(response, 200, await claudeCodeAuthStatus(user));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/auth/claude-code/login') {
        sendJson(response, 202, await startClaudeCodeLogin(user));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/auth/claude-code/logout') {
        sendJson(response, 200, await logoutClaudeCodeAuth(user));
        return;
      }

      if (request.method === 'POST' && pathname.startsWith('/api/auth/claude-code/login/') && pathname.endsWith('/code')) {
        const id = pathname.split('/').at(-2);
        const body = await readJsonBody(request);
        sendJson(response, 200, submitClaudeCodeLoginCode(id, user, body));
        return;
      }

      if (request.method === 'GET' && pathname.startsWith('/api/auth/claude-code/login/')) {
        const id = pathname.split('/').pop();
        const job = getAuthLogin(id, user);
        if (!job) {
          sendJson(response, 404, { error: 'Login not found' });
          return;
        }
        sendJson(response, 200, publicAuthLogin(job));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/settings') {
        if (config.authRequired && !trusted) {
          sendJson(response, 403, { error: 'Backend settings require CONTROL_API_TOKEN.' });
          return;
        }
        const body = await readJsonBody(request);
        sendJson(response, 200, await saveAppSettings(config, body));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/recent-projects') {
        const body = await readJsonBody(request);
        sendJson(response, 200, { projects: await saveRecentProject(config.recentProjectsFile, body.project || body, user?.id || '') });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/bridge-intents') {
        const body = await readJsonBody(request);
        const prepared = await prepareIntentBridgeSession(body, user);
        sendJson(response, 202, {
          provider: provider.info(),
          clientId: prepared.clientId,
          session: decorateLiveSession(prepared.session),
        });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/threads') {
        sendJson(response, 200, trace.wrap(await listThreadsPayload(viewerSessionId, trusted, user, { traceStep: trace.step })));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/workspace-suggestions') {
        const body = await readJsonBody(request);
        sendJson(response, 200, { suggestions: await generateWorkspaceLaunchSuggestionsForThreads(body.threads, user) });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/threads') {
        const body = await readJsonBody(request);
        const sessionId = viewerSessionId;
        let browserSession = null;

        if (body.repoSource === 'github') {
          if (!sessionId) {
            sendJson(response, 400, { error: 'Browser session is required. Reload the page and try again.' });
            return;
          }
          browserSession = readBrowserSession(sessionId);
        }

        const thread = await createThreadSession(body, browserSession, sessionId, user);
        sendJson(response, 202, {
          provider: provider.info(),
          thread: decorateLiveSession(thread),
        });
        return;
      }

      const archiveThreadMatch = pathname.match(/^\/api\/threads\/([^/]+)\/archive$/);
      if (request.method === 'POST' && archiveThreadMatch) {
        const name = decodeURIComponent(archiveThreadMatch[1]);
        const thread = await archiveThreadSession(name, viewerSessionId, trusted, user);
        sendJson(response, 200, {
          provider: provider.info(),
          thread: decorateLiveSession(thread),
        });
        return;
      }

      const unarchiveThreadMatch = pathname.match(/^\/api\/threads\/([^/]+)\/unarchive$/);
      if (request.method === 'POST' && unarchiveThreadMatch) {
        const name = decodeURIComponent(unarchiveThreadMatch[1]);
        const thread = await unarchiveThreadSession(name, viewerSessionId, trusted, user);
        sendJson(response, 200, {
          provider: provider.info(),
          thread: decorateLiveSession(thread),
        });
        return;
      }

      const stopThreadMatch = pathname.match(/^\/api\/threads\/([^/]+)\/stop$/);
      if (request.method === 'POST' && stopThreadMatch) {
        const name = decodeURIComponent(stopThreadMatch[1]);
        const thread = await stopThreadSession(name, viewerSessionId, trusted, user);
        sendJson(response, 200, {
          provider: provider.info(),
          thread: decorateLiveSession(thread),
        });
        return;
      }

      const suspendThreadMatch = pathname.match(/^\/api\/threads\/([^/]+)\/suspend$/);
      if (request.method === 'POST' && suspendThreadMatch) {
        const name = decodeURIComponent(suspendThreadMatch[1]);
        const thread = await suspendThreadSession(name, viewerSessionId, trusted, user);
        sendJson(response, 200, {
          provider: provider.info(),
          thread: decorateLiveSession(thread),
        });
        return;
      }

      const resumeThreadMatch = pathname.match(/^\/api\/threads\/([^/]+)\/resume$/);
      if (request.method === 'POST' && resumeThreadMatch) {
        const name = decodeURIComponent(resumeThreadMatch[1]);
        const thread = await resumeThreadSession(name, viewerSessionId, trusted, user);
        sendJson(response, 202, {
          provider: provider.info(),
          thread: decorateLiveSession(thread),
        });
        return;
      }

      const deleteThreadMatch = pathname.match(/^\/api\/threads\/([^/]+)\/delete$/);
      if (request.method === 'POST' && deleteThreadMatch) {
        const name = decodeURIComponent(deleteThreadMatch[1]);
        const result = await deleteThreadSession(name, viewerSessionId, trusted, user);
        sendJson(response, 202, {
          provider: provider.info(),
          thread: decorateLiveSession(result.thread),
          backup: result.backup,
        });
        return;
      }

      const threadDiffMatch = pathname.match(/^\/api\/threads\/([^/]+)\/diff$/);
      if (request.method === 'GET' && threadDiffMatch) {
        const name = decodeURIComponent(threadDiffMatch[1]);
        sendJson(response, 200, await threadDiffPayload(name, viewerSessionId, trusted, user));
        return;
      }

      const threadPullRequestMatch = pathname.match(/^\/api\/threads\/([^/]+)\/pull-request$/);
      if (request.method === 'POST' && threadPullRequestMatch) {
        const name = decodeURIComponent(threadPullRequestMatch[1]);
        const body = await readJsonBody(request);
        sendJson(response, 200, await createThreadPullRequestPayload(name, body, viewerSessionId, trusted, user));
        return;
      }

      const threadWorkflowMatch = pathname.match(/^\/api\/threads\/([^/]+)\/workflows\/([^/]+)$/);
      if (request.method === 'GET' && threadWorkflowMatch) {
        const name = decodeURIComponent(threadWorkflowMatch[1]);
        const runId = decodeURIComponent(threadWorkflowMatch[2]);
        sendJson(response, 200, trace.wrap(await threadWorkflowPayload(name, runId, viewerSessionId, trusted, user, { traceStep: trace.step })));
        return;
      }

      const threadArtifactFileMatch = pathname.match(/^\/api\/threads\/([^/]+)\/artifacts\/file$/);
      if (request.method === 'GET' && threadArtifactFileMatch) {
        const name = decodeURIComponent(threadArtifactFileMatch[1]);
        const artifact = await threadImageArtifactPayload(name, url.searchParams.get('path'), viewerSessionId, trusted, user);
        sendText(response, 200, artifact.data, artifact.contentType, {
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; sandbox",
          'x-content-type-options': 'nosniff',
        });
        return;
      }

      const threadArtifactHtmlMatch = pathname.match(/^\/api\/threads\/([^/]+)\/artifacts\/html$/);
      if (request.method === 'GET' && threadArtifactHtmlMatch) {
        const name = decodeURIComponent(threadArtifactHtmlMatch[1]);
        const artifact = await threadHtmlArtifactPayload(name, url.searchParams.get('path'), viewerSessionId, trusted, user);
        const interactive = wantsInteractiveHtmlArtifact(url);
        sendText(response, 200, htmlArtifactData(artifact, interactive), artifact.contentType, {
          'cache-control': 'no-store',
          'content-security-policy': htmlArtifactCsp(interactive),
          'x-content-type-options': 'nosniff',
        });
        return;
      }

      const threadArtifactStateMatch = pathname.match(/^\/api\/threads\/([^/]+)\/artifacts\/state$/);
      if (request.method === 'GET' && threadArtifactStateMatch) {
        const name = decodeURIComponent(threadArtifactStateMatch[1]);
        sendJson(response, 200, await threadHtmlArtifactStatePayload(name, url.searchParams.get('path'), url.searchParams.get('key') || 'default', viewerSessionId, trusted, user));
        return;
      }
      if (request.method === 'POST' && threadArtifactStateMatch) {
        const name = decodeURIComponent(threadArtifactStateMatch[1]);
        const body = await readJsonBody(request);
        sendJson(response, 200, await saveThreadHtmlArtifactStatePayload(name, url.searchParams.get('path'), body, viewerSessionId, trusted, user));
        return;
      }

      const threadArtifactMatch = pathname.match(/^\/api\/threads\/([^/]+)\/artifacts$/);
      if (request.method === 'GET' && threadArtifactMatch) {
        const name = decodeURIComponent(threadArtifactMatch[1]);
        sendJson(response, 200, await threadArtifactPayload(name, url.searchParams.get('path'), viewerSessionId, trusted, user));
        return;
      }
      if (request.method === 'POST' && threadArtifactMatch) {
        const name = decodeURIComponent(threadArtifactMatch[1]);
        const body = await readJsonBody(request);
        sendJson(response, 200, await saveThreadArtifactPayload(name, url.searchParams.get('path'), body, viewerSessionId, trusted, user));
        return;
      }

      const threadMatch = pathname.match(/^\/api\/threads\/([^/]+)$/);
      if (request.method === 'GET' && threadMatch) {
        const name = decodeURIComponent(threadMatch[1]);
        const thread = await trace.step('thread.getSession', () => getThreadSession(name));
        if (requireSessionAccess(request, response, thread, url, user)) return;
        const [defaults, run] = await Promise.all([
          trace.step('defaults.load', () => loadPiDefaults(user, { staleOk: true })),
          trace.step('thread.syncRun', () => syncRunOutput(thread)),
        ]);
        const liveThread = decorateLiveSession({
          ...thread,
          status: statusFromRunStatus(run.runStatus, thread.status),
          runStatus: run.runStatus,
        });
        sendJson(response, 200, trace.wrap({
          provider: provider.info(),
          defaults,
          thread: liveThread,
        }));
        return;
      }

      const threadMessageMatch = pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
      if (request.method === 'POST' && threadMessageMatch) {
        const name = decodeURIComponent(threadMessageMatch[1]);
        const body = await readJsonBody(request);
        const thread = await promptThreadSession(name, body, viewerSessionId, trusted, user);
        sendJson(response, 202, {
          provider: provider.info(),
          thread: decorateLiveSession(thread),
        });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/sessions') {
        sendJson(response, 200, await listSessionsPayload(viewerSessionId, trusted, user));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/chat') {
        const body = await readJsonBody(request);
        const session = await createChatSession(body, user);
        sendJson(response, 202, {
          provider: provider.info(),
          session: decorateLiveSession(session),
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/sessions') {
        const body = await readJsonBody(request);
        const session = await createManualSession(body, readBrowserSession(viewerSessionId), viewerSessionId, user);
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
        if (requireSessionAccess(request, response, session, url, user)) return;

        const after = Number(url.searchParams.get('after'));
        const lastId = Number.isFinite(after) && after > 0 ? after : 0;
        let run = activeRuns.get(name);
        let inactiveSnapshot = null;
        if (!run && session.bridgeMode) {
          inactiveSnapshot = await syncRunOutput(session);
          run = activeRuns.get(name);
        }

        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          'x-accel-buffering': 'no',
          connection: 'keep-alive',
          ...corsHeadersFor(request),
        });
        response.write('retry: 1000\n\n');

        if (!run && inactiveSnapshot) {
          const events = inactiveSnapshot.events?.length ? inactiveSnapshot.events : [{ type: 'status', runStatus: inactiveSnapshot.runStatus }];
          events.forEach((event, index) => {
            const runStatus = event.runStatus || inactiveSnapshot.runStatus || session.runStatus || session.status || 'launching';
            sendSse(response, {
              ...event,
              id: lastId + index + 1,
              runStatus,
              session: {
                ...(event.session || session),
                status: statusFromRunStatus(runStatus, session.status),
                runStatus,
                warning: event.warning || session.warning || null,
              },
            });
          });
          response.end();
          return;
        }

        if (!run) {
          const decorated = decorateLiveSession(session);
          const runStatus = inactiveStoredRunStatus(session);
          sendSse(response, {
            id: lastId + 1,
            type: 'status',
            runStatus: runStatus || 'failed',
            done: true,
            warning: decorated.warning || (runStatus ? null : 'Main agent connection is stale; reload to retry.'),
            session: decorated,
          });
          response.end();
          return;
        }

        const subscriber = addRunSubscriber(name, response, lastId, session);
        const cleanup = () => closeRunSubscriber(subscriber);
        request.on('close', cleanup);
        response.on('close', cleanup);
        response.on('error', cleanup);
        response.on('finish', cleanup);

        const firstEventId = run.events[0]?.id || run.nextEventId;
        if (lastId > 0 && lastId < firstEventId - 1) {
          const snapshot = retainedOutputChunk(run, 0);
          enqueueRunSubscriber(subscriber, {
            id: firstEventId - 1,
            timestamp: new Date().toISOString(),
            type: 'snapshot',
            reset: true,
            runStatus: run.runStatus,
            ...snapshot,
            events: run.events,
          });
        } else {
          for (const event of run.events) {
            enqueueRunSubscriber(subscriber, event);
          }
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
        if (requireSessionAccess(request, response, session, url, user)) return;

        const run = await syncRunOutput(session);
        const storedEvents = await storedTraceEvents(name, traceReadLimit(url));
        const offset = Number(url.searchParams.get('offset'));
        const output = retainedOutputChunk(run, Number.isFinite(offset) && offset > 0 ? offset : 0);
        const decorated = decorateLiveSession({
          ...session,
          status: statusFromRunStatus(run.runStatus, session.status),
          runStatus: run.runStatus,
        });

        sendJson(response, 200, {
          session: decorated,
          ...output,
          runStatus: run.runStatus,
          warning: run.warning,
          events: mergeTraceEvents(storedEvents, run.events),
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
        if (requireSessionAccess(request, response, existing, url, user)) return;

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
      if (response.headersSent) {
        response.destroy(error);
        return;
      }

      sendJson(response, Number(error.statusCode) || 500, {
        error: error.message,
        provider: provider.info(),
      });
    }
  };
}
