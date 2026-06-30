import { readPiProfile, savePiProfile } from '../pi-profile.js';
import { listRecentProjects, saveRecentProject } from '../recent-projects.js';
import { report } from '../report.js';
import { readAppSettings, saveAppSettings } from '../settings.js';
import { getStoredSession, upsertSession } from '../store.js';

export function createRequestHandler({ config, provider, http, auth, runState, threads, sessions }) {
  const { corsHeaders, sendJson, sendText, readJsonBody, serveStatic } = http;
  const {
    requireApiToken,
    requireTrustedBrowserRequest,
    browserSessionId,
    hasTrustedControlToken,
    requireBrowserSessionId,
    readBrowserSession,
    publicGitHubAuth,
    isGitHubAuthConfigured,
    startGitHubLogin,
    completeGitHubLogin,
    githubRepoPayload,
    codexAuthStatus,
    startCodexDeviceLogin,
    claudeCodeAuthStatus,
    startClaudeCodeLogin,
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
  } = runState;
  const {
    listThreadPerformancePayload,
    listThreadsPayload,
    createThreadSession,
    archiveThreadSession,
    unarchiveThreadSession,
    threadDiffPayload,
    threadArtifactPayload,
    getThreadSession,
    promptThreadSession,
  } = threads;
  const { createChatSession, createManualSession, syncRunOutput } = sessions;

  return async function handleRequest(request, response) {
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

      const viewerSessionId = browserSessionId(request);
      const trusted = hasTrustedControlToken(request, url);
      const publicApiRoute = pathname === '/api/me'
        || pathname === '/api/auth/github'
        || pathname === '/api/auth/github/login'
        || pathname === '/api/auth/github/callback'
        || pathname === '/api/auth/github/logout'
        || pathname === '/api/auth/logout';
      let user = await currentUser(request);
      if (pathname.startsWith('/api/') && !publicApiRoute) {
        const context = await requireUser(request, response, url);
        if (!context) return;
        user = context.user;
      }

      if (request.method === 'GET' && pathname === '/api/me') {
        sendJson(response, 200, publicMe(user, trusted));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/report') {
        sendJson(response, 200, { provider: provider.info(), report });
        return;
      }

      if (request.method === 'GET' && (pathname === '/api/performance' || pathname === '/api/threads/performance')) {
        sendJson(response, 200, await listThreadPerformancePayload(viewerSessionId, trusted, user));
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
        sendJson(response, 200, startGitHubLogin(request, sessionId, body));
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
        sendJson(response, 200, await listThreadsPayload(viewerSessionId, trusted, user));
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

      const threadDiffMatch = pathname.match(/^\/api\/threads\/([^/]+)\/diff$/);
      if (request.method === 'GET' && threadDiffMatch) {
        const name = decodeURIComponent(threadDiffMatch[1]);
        sendJson(response, 200, await threadDiffPayload(name, viewerSessionId, trusted, user));
        return;
      }

      const threadArtifactMatch = pathname.match(/^\/api\/threads\/([^/]+)\/artifacts$/);
      if (request.method === 'GET' && threadArtifactMatch) {
        const name = decodeURIComponent(threadArtifactMatch[1]);
        sendJson(response, 200, await threadArtifactPayload(name, url.searchParams.get('path'), viewerSessionId, trusted, user));
        return;
      }

      const threadMatch = pathname.match(/^\/api\/threads\/([^/]+)$/);
      if (request.method === 'GET' && threadMatch) {
        const name = decodeURIComponent(threadMatch[1]);
        const thread = await getThreadSession(name);
        if (requireSessionAccess(request, response, thread, url, user)) return;
        sendJson(response, 200, {
          provider: provider.info(),
          defaults: await loadPiDefaults(),
          thread: decorateLiveSession(thread),
        });
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
        const session = await createManualSession(body, user);
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
        const run = activeRuns.get(name);

        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          ...corsHeaders,
        });
        response.write('retry: 1000\n\n');

        if (!run) {
          const runStatus = inactiveStoredRunStatus(session);
          sendSse(response, {
            id: lastId + 1,
            type: 'status',
            runStatus: runStatus || 'failed',
            done: true,
            warning: runStatus ? null : 'Run state is no longer active; reload to resync.',
            session: decorateLiveSession(session),
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
