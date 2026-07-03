import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { runLocalPiSession } from '../host-pi-runner.js';
import { analyzePiTraceText, summarizeThreadPerformanceList } from '../performance.js';
import { normalizeImageAttachments, normalizeModelOptions, normalizeThreadRequest } from '../session.js';
import { readSavedSettings } from '../settings.js';
import { archiveStoredSession, getStoredSession, listStoredSessions, unarchiveStoredSession, upsertSession } from '../store.js';
import { normalizeSubmittedAtMs } from './utils.js';

export function createThreadService({ config, provider, http, auth, runState, bridge }) {
  const { clientError } = http;
  const localRunControllers = new Map();
  const localRunMessageControls = new Map();
  const STOPPED_WARNING = 'Stopped by user.';
  const { enrichGitHubRepoSession, canAccessSession, loadPiDefaults } = auth;
  const {
    activeRuns,
    liveLocalRuns,
    decorateLiveSession,
    effectiveStoredRunStatus,
    appendRunOutput,
    setRunState,
    resetRunState,
    appendRunStatus,
    activeRunResetPatch,
    persistRunStatus,
    withUserThreadMessage,
    withFallbackThreadTitle,
    scheduleThreadTitleGeneration,
    recordRunEvent,
    mergeTrackedChanges,
    MAX_CHANGE_FILES,
    isActiveRunStatus,
    persistHostDispatchMetric,
    persistHostDispatchStatus,
  } = runState;
  const { startThreadBridgeLaunch, refreshBridgeSessionIfNeeded, startBridgeRun, fetchBridgeJson } = bridge;
  const MAX_EXCALIDRAW_BYTES = 8 * 1024 * 1024;
  const MAX_IMAGE_ARTIFACT_BYTES = 16 * 1024 * 1024;
  const IMAGE_ARTIFACT_TYPES = new Map([
    ['.gif', 'image/gif'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml; charset=utf-8'],
    ['.webp', 'image/webp'],
  ]);

  function safeRelativeArtifactPath(value, allowedExts, message) {
    const input = String(value || '').trim().replaceAll('\\', '/');
    if (!input || input.includes('\0') || path.isAbsolute(input) || /^[a-z][a-z0-9+.-]*:/i.test(input) || /[*?\[\]{}]/.test(input)) {
      throw clientError(message);
    }

    const normalized = path.posix.normalize(input.replace(/^\.\//, ''));
    const ext = path.posix.extname(normalized).toLowerCase();
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || !allowedExts.has(ext)) {
      throw clientError(message);
    }
    return normalized;
  }

  function safeExcalidrawArtifactPath(value) {
    return safeRelativeArtifactPath(value, new Set(['.excalidraw']), 'Only relative .excalidraw artifacts can be viewed.');
  }

  function safeImageArtifactPath(value) {
    return safeRelativeArtifactPath(value, new Set(IMAGE_ARTIFACT_TYPES.keys()), 'Only relative image artifacts can be viewed.');
  }

  function safeWorkflowRunId(value) {
    const runId = String(value || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{2,100}$/i.test(runId)) throw clientError('Invalid workflow run id.');
    return runId;
  }

  function checkedBuffer(buffer, artifactPath, maxBytes) {
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    if (data.byteLength > maxBytes) throw clientError(`${artifactPath} is too large to preview.`);
    return data;
  }

  function bufferText(buffer, artifactPath) {
    return checkedBuffer(buffer, artifactPath, MAX_EXCALIDRAW_BYTES).toString('utf8');
  }

  async function readThreadArtifactBuffer(session, artifactPath, maxBytes) {
    if (session.repoPath) {
      const root = path.resolve(session.repoPath);
      const filePath = path.resolve(root, artifactPath);
      if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) throw clientError('Artifact path escapes the workspace.');
      return checkedBuffer(await readFile(filePath), artifactPath, maxBytes);
    }

    if (!provider.readRemoteFile) throw clientError('Artifact preview is unavailable for this provider.', 501);
    const remotePath = path.posix.join(session.remoteWorkspaceDir || config.remoteWorkspaceDir, artifactPath);
    return checkedBuffer(await provider.readRemoteFile(session, remotePath), artifactPath, maxBytes);
  }

  async function readThreadArtifactFile(session, artifactPath) {
    return bufferText(await readThreadArtifactBuffer(session, artifactPath, MAX_EXCALIDRAW_BYTES), artifactPath);
  }

  async function readThreadWorkflowRunFile(session, runId) {
    const runPath = path.posix.join('.pi/workflows/runs', `${runId}.json`);
    if (session.repoPath) return readFile(path.join(session.repoPath, runPath), 'utf8');
    if (!provider.readRemoteFile) throw clientError('Workflow run details are unavailable for this provider.', 501);
    return provider.readRemoteFile(session, path.posix.join(session.remoteWorkspaceDir || config.remoteWorkspaceDir, runPath));
  }

  function workflowPreview(value, max = 260) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function workflowRunPayload(runId, raw) {
    const data = JSON.parse(raw);
    const agents = Array.isArray(data.agents) ? data.agents : [];
    return {
      available: true,
      runId: data.runId || runId,
      workflowName: data.workflowName || 'workflow',
      status: data.status || 'unknown',
      phases: Array.isArray(data.phases) ? data.phases : [],
      currentPhase: data.currentPhase || '',
      agents: agents.map((agent) => ({
        id: agent.id,
        label: agent.label || `agent ${agent.id ?? ''}`.trim(),
        phase: agent.phase || '',
        status: agent.status || 'unknown',
        model: agent.model || '',
        tokens: Number.isFinite(agent.tokens) ? agent.tokens : null,
        promptPreview: workflowPreview(agent.prompt),
        resultPreview: workflowPreview(agent.resultPreview),
        error: workflowPreview(agent.error),
        startedAt: agent.startedAt || '',
        endedAt: agent.endedAt || '',
      })),
      updatedAt: data.updatedAt || '',
    };
  }

  async function threadWorkflowPayload(name, runIdValue, viewerSessionId = '', trusted = false, user = null) {
    const session = await getThreadSession(name);
    if (!canAccessSession(session, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }
    const runId = safeWorkflowRunId(runIdValue);
    try {
      return workflowRunPayload(runId, await readThreadWorkflowRunFile(session, runId));
    } catch (error) {
      if (error.code === 'ENOENT' || /not found|no such file/i.test(error.message || '')) {
        return { available: false, runId, workflowName: 'workflow', status: 'pending', phases: [], agents: [] };
      }
      if (error instanceof SyntaxError) throw clientError(`${runId} workflow run state is invalid.`);
      throw error;
    }
  }

  async function threadArtifactPayload(name, artifactPath, viewerSessionId = '', trusted = false, user = null) {
    const session = await getThreadSession(name);
    if (!canAccessSession(session, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }

    const safePath = safeExcalidrawArtifactPath(artifactPath);
    let data;
    try {
      data = JSON.parse(await readThreadArtifactFile(session, safePath));
    } catch (error) {
      if (error instanceof SyntaxError) throw clientError(`${safePath} is not valid Excalidraw JSON.`);
      throw error;
    }
    if (data?.type !== 'excalidraw' || !Array.isArray(data.elements)) throw clientError(`${safePath} is not an Excalidraw drawing.`);
    return { path: safePath, data };
  }

  async function threadImageArtifactPayload(name, artifactPath, viewerSessionId = '', trusted = false, user = null) {
    const session = await getThreadSession(name);
    if (!canAccessSession(session, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }

    const safePath = safeImageArtifactPath(artifactPath);
    return {
      path: safePath,
      contentType: IMAGE_ARTIFACT_TYPES.get(path.posix.extname(safePath).toLowerCase()),
      data: await readThreadArtifactBuffer(session, safePath, MAX_IMAGE_ARTIFACT_BYTES),
    };
  }

  async function listThreadsPayload(viewerSessionId = '', trusted = false, user = null) {
    const sessions = await listStoredSessions(config.sessionFile);
    return {
      provider: provider.info(),
      defaults: await loadPiDefaults(user),
      threads: sessions
        .filter((session) => session.threadBridge && !session.archivedAt && canAccessSession(session, viewerSessionId, trusted, user))
        .map((session) => decorateLiveSession(session)),
    };
  }

  function localTelemetryFile() {
    return path.join(config.localDataDir || path.join(config.rootDir || process.cwd(), 'data'), 'sessions.json');
  }

  async function listLocalTelemetrySessions() {
    if (config.provider !== 'local') throw clientError('Local session telemetry is only available from a local backend.', 400);
    try {
      const sessions = JSON.parse((await readFile(localTelemetryFile(), 'utf8')).trim() || '[]');
      if (!Array.isArray(sessions)) throw new Error('Local session store must be a JSON array.');
      return sessions.filter((session) => session && typeof session === 'object' && session.provider !== 'mock');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  function localTraceFile(session) {
    return path.join(config.piSessionTraceDir || path.join(config.localDataDir || '', 'pi-sessions'), `${session.name}.jsonl`);
  }

  async function localTraceAnalyses(sessions) {
    const pairs = await Promise.all(sessions.map(async (session) => {
      try {
        return [session.name, analyzePiTraceText(await readFile(localTraceFile(session), 'utf8'))];
      } catch (error) {
        if (error.code === 'ENOENT') return [session.name, null];
        return [session.name, { available: true, parseErrorCount: 1, entryCount: 0, reviewScore: 10, signalKinds: ['trace_read_error'], signalCounts: { trace_read_error: 1 }, signals: [{ kind: 'trace_read_error', msg: error.message }] }];
      }
    }));
    return Object.fromEntries(pairs.filter(([, analysis]) => analysis));
  }

  async function listThreadPerformancePayload(viewerSessionId = '', trusted = false, user = null, options = {}) {
    const source = String(options.source || '').toLowerCase();
    const localSource = source === 'local';
    const allSessions = localSource ? await listLocalTelemetrySessions() : await listStoredSessions(config.sessionFile);
    const sessions = allSessions
      .filter((session) => session.threadBridge && (localSource || canAccessSession(session, viewerSessionId, trusted, user)));
    const eventsByName = Object.fromEntries(sessions.map((session) => [session.name, activeRuns.get(session.name)?.events || []]));
    const traceByName = localSource ? await localTraceAnalyses(sessions) : {};
    return {
      provider: provider.info(),
      generatedAt: new Date().toISOString(),
      performance: {
        source: localSource
          ? { kind: 'local-file', label: 'Local desktop sessions', path: localTelemetryFile(), traceDir: config.piSessionTraceDir }
          : { kind: 'configured-store', label: 'Configured session store' },
        ...summarizeThreadPerformanceList(sessions, eventsByName, Date.now(), traceByName),
      },
    };
  }

  function trackedChangesPayloadForThread(session) {
    const files = mergeTrackedChanges(session.trackedChanges, activeRuns.get(session.name)?.trackedChanges || []);
    return {
      generatedAt: new Date().toISOString(),
      source: 'tracked-tools',
      status: files.map((file) => `${file.code} ${file.path}`).join('\n'),
      diff: '',
      files,
      truncated: files.length >= MAX_CHANGE_FILES || files.some((file) => file.truncated),
      notGit: false,
    };
  }

  async function threadDiffPayload(name, viewerSessionId = '', trusted = false, user = null) {
    const session = await getThreadSession(name);
    if (!canAccessSession(session, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }
    return trackedChangesPayloadForThread(session);
  }

  async function getThreadSession(name) {
    const session = await getStoredSession(config.sessionFile, name);
    if (!session?.threadBridge) {
      throw new Error(`No main agent named ${name}.`);
    }
    return session;
  }

  async function archiveThreadSession(name, viewerSessionId = '', trusted = false, user = null) {
    const existing = await getThreadSession(name);
    if (!canAccessSession(existing, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }

    const live = decorateLiveSession(existing);
    const status = effectiveStoredRunStatus(live);
    if (!['completed', 'ready', 'failed'].includes(status)) {
      throw clientError('Only finished main agents can be archived.');
    }

    const archived = await archiveStoredSession(config.sessionFile, name);
    return archived || existing;
  }

  async function unarchiveThreadSession(name, viewerSessionId = '', trusted = false, user = null) {
    const existing = await getThreadSession(name);
    if (!canAccessSession(existing, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }

    return (await unarchiveStoredSession(config.sessionFile, name)) || existing;
  }

  async function markThreadStopped(session) {
    const now = new Date().toISOString();
    const stopped = await upsertSession(config.sessionFile, {
      ...session,
      taskPrompt: '',
      images: [],
      bridgeClaimed: false,
      warmClaimed: false,
      status: 'failed',
      runStatus: 'failed',
      warning: STOPPED_WARNING,
      endedAt: session.endedAt || now,
      runEndedAtMs: session.runEndedAtMs || Date.parse(now),
      updatedAt: now,
    });
    setRunState(session.name, { runStatus: 'failed', warning: STOPPED_WARNING });
    appendRunOutput(session.name, `[system] ${STOPPED_WARNING}\n`, 'failed');
    appendRunStatus(session.name, 'failed', { warning: STOPPED_WARNING, done: true, stopped: true });
    return stopped;
  }

  async function stopThreadSession(name, viewerSessionId = '', trusted = false, user = null) {
    const existing = await getThreadSession(name);
    if (!canAccessSession(existing, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }

    const live = decorateLiveSession(existing);
    const status = effectiveStoredRunStatus(live);
    if (!isActiveRunStatus(status)) {
      throw clientError('Only running main agents can be stopped.');
    }

    if (existing.localMode) {
      localRunControllers.get(name)?.abort();
    } else if (existing.bridgeUrl && existing.bridgeRunId && existing.bridgeToken) {
      try {
        await fetchBridgeJson(existing, `/runs/${encodeURIComponent(existing.bridgeRunId)}/stop`, { method: 'POST' });
      } catch (error) {
        if (status !== 'launching') throw error;
      }
    }

    return markThreadStopped(existing);
  }

  function normalizeMessageDelivery(value) {
    return value === 'followUp' ? 'followUp' : 'steer';
  }

  function currentRunId(session, submittedAtMs) {
    return String(session.bridgeRunId || session.submittedAtMs || submittedAtMs || '');
  }

  async function appendActiveThreadMessage(session, prompt, submittedAtMs, runId, images) {
    const current = (await getStoredSession(config.sessionFile, session.name)) || session;
    return upsertSession(config.sessionFile, {
      ...withUserThreadMessage(current, prompt, submittedAtMs, runId, images),
      updatedAt: new Date().toISOString(),
    });
  }

  async function sendActiveLocalThreadMessage(session, prompt, submittedAtMs, delivery, images) {
    const control = localRunMessageControls.get(session.name);
    if (!control) throw clientError('Main agent is starting; try again in a moment.', 409);
    await control.sendMessage(prompt, { delivery, images });
    return appendActiveThreadMessage(session, prompt, submittedAtMs, currentRunId(session, submittedAtMs), images);
  }

  async function sendActiveBridgeThreadMessage(session, prompt, submittedAtMs, delivery, images) {
    if (!session.bridgeUrl || !session.bridgeRunId || !session.bridgeToken || !fetchBridgeJson) {
      throw clientError('Main agent is starting; try again in a moment.', 409);
    }
    await fetchBridgeJson(session, '/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: session.bridgeRunId, name: session.name, prompt, delivery, images }),
    });
    return appendActiveThreadMessage(session, prompt, submittedAtMs, currentRunId(session, submittedAtMs), images);
  }

  async function createThreadSession(body, browserSession = null, browserSessionIdValue = '', user = null) {
    const submittedAtMs = normalizeSubmittedAtMs(body.submittedAtMs);
    const normalized = normalizeThreadRequest(body, config);
    if (config.authRequired && normalized.localMode && !config.allowHostedLocalProvider) {
      throw clientError('Local folder workspaces are disabled for hosted multi-user runs.', 403);
    }
    const bridgeRunId = normalized.bridgeMode ? randomUUID() : '';
    const session = withUserThreadMessage(withFallbackThreadTitle(await enrichGitHubRepoSession({
      ...normalized,
      ...(bridgeRunId ? { bridgeRunId } : {}),
      ...(user?.id ? { ownerUserId: user.id } : browserSessionIdValue ? { githubOwnerSessionId: browserSessionIdValue } : {}),
      submittedAtMs,
    }, browserSession, user)), normalized.initialPrompt || normalized.taskPrompt, submittedAtMs, bridgeRunId || String(submittedAtMs), normalized.images || []);
    const existing = await getStoredSession(config.sessionFile, session.name);
    if (existing) {
      throw new Error(`A main agent named ${session.name} already exists.`);
    }

    const thread = session.repoPath
      ? await startLocalThreadSession(session)
      : await startThreadBridgeLaunch(session, await readSavedSettings(config.settingsFile));

    scheduleThreadTitleGeneration(thread);
    return thread;
  }

  async function promptThreadSession(name, body, viewerSessionId = '', trusted = false, user = null) {
    const prompt = String(body.prompt || '').trim();
    if (!prompt) throw new Error('Prompt is required.');

    const existing = await getThreadSession(name);
    if (!canAccessSession(existing, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }
    const submittedAtMs = normalizeSubmittedAtMs(body.submittedAtMs);
    const modelOptions = normalizeModelOptions(body);
    const images = normalizeImageAttachments(body.images);
    const delivery = normalizeMessageDelivery(body.delivery);
    const status = String(effectiveStoredRunStatus(decorateLiveSession(existing)) || existing.runStatus || existing.status || '').toLowerCase();

    if (existing.localMode && liveLocalRuns.has(name)) {
      return sendActiveLocalThreadMessage(existing, prompt, submittedAtMs, delivery, images);
    }
    if (!existing.localMode && existing.runStatus === 'failed') {
      throw new Error(`Main agent ${name} failed; create a new main agent.`);
    }
    if (!existing.localMode && existing.bridgeClaimed && existing.taskPrompt) {
      if (status !== 'running') throw clientError('Main agent is starting; try again in a moment.', 409);
      return sendActiveBridgeThreadMessage(existing, prompt, submittedAtMs, delivery, images);
    }

    if (existing.localMode) {
      const runId = String(submittedAtMs);
      return startLocalThreadRun({ ...withUserThreadMessage(existing, prompt, submittedAtMs, runId, images), ...modelOptions }, prompt, submittedAtMs, images);
    }

    const bridgeRunId = randomUUID();
    const claimed = await upsertSession(config.sessionFile, {
      ...withUserThreadMessage(existing, prompt, submittedAtMs, bridgeRunId, images),
      ...activeRunResetPatch(),
      taskPrompt: prompt,
      submittedAtMs,
      ...modelOptions,
      images,
      bridgeRunId,
      bridgeClaimed: true,
      warmClaimed: false,
      firstLlmLatencyMs: null,
      status: 'launching',
      runStatus: 'launching',
      updatedAt: new Date(submittedAtMs).toISOString(),
    });

    resetRunState(name, 'launching');

    if (existing.status === 'ready' && existing.bridgeUrl && existing.bridgeToken) {
      appendRunOutput(name, '[system] Starting main agent on this repo.\n', 'launching');
      try {
        const runnable = await refreshBridgeSessionIfNeeded(claimed, existing);
        await startBridgeRun(runnable);
      } catch (error) {
        const current = (await getStoredSession(config.sessionFile, name)) || claimed;
        const rolledBack = await upsertSession(config.sessionFile, {
          ...current,
          taskPrompt: '',
          images: [],
          bridgeClaimed: false,
          warmClaimed: false,
          status: 'ready',
          runStatus: 'ready',
          warning: error.message,
          updatedAt: new Date().toISOString(),
        });
        setRunState(name, { runStatus: 'failed', warning: error.message });
        appendRunOutput(name, `[system] Failed to start main agent: ${error.message}\n`, 'failed');
        appendRunStatus(name, 'failed', { warning: error.message, done: true });
        throw new Error(`Failed to start main agent for ${rolledBack.name}: ${error.message}`);
      }
      const running = await upsertSession(config.sessionFile, {
        ...((await getStoredSession(config.sessionFile, name)) || claimed),
        ...activeRunResetPatch(),
        status: 'running',
        runStatus: 'running',
        warning: null,
        images: [],
        updatedAt: new Date().toISOString(),
      });
      setRunState(name, { runStatus: 'running', warning: null });
      return running;
    }

    appendRunOutput(name, '[system] Prompt queued until the main agent bridge is ready.\n', 'launching');
    return claimed;
  }

  async function resolveLocalRepoPath(repoPath) {
    if (!provider.resolveRepoPath) throw new Error('Local folders require INFRA_PROVIDER=local.');
    return provider.resolveRepoPath(repoPath);
  }

  async function startLocalThreadRun(session, prompt, submittedAtMs, images = session.images || []) {
    const now = new Date(submittedAtMs).toISOString();
    const runImages = normalizeImageAttachments(images);
    const { images: _images, ...sessionFields } = session;
    const stored = await upsertSession(config.sessionFile, {
      ...sessionFields,
      ...activeRunResetPatch(),
      taskPrompt: prompt,
      submittedAtMs,
      bridgeMode: false,
      bridgeClaimed: false,
      localMode: true,
      provider: provider.kind,
      status: 'running',
      runStatus: 'running',
      firstLlmLatencyMs: null,
      updatedAt: now,
      createdAt: session.createdAt || now,
    });

    resetRunState(stored.name, 'running');
    appendRunOutput(stored.name, `[system] Running main agent locally in ${stored.repoPath}.\n`, 'running');

    const controller = new AbortController();
    localRunControllers.set(stored.name, controller);
    liveLocalRuns.add(stored.name);
    void runLocalPiSession({
      session: { ...stored, ...(runImages.length ? { images: runImages } : {}) },
      config,
      signal: controller.signal,
      emitOutput: (text, runStatus) => appendRunOutput(stored.name, text, runStatus),
      emitMetric: (event) => persistHostDispatchMetric(stored.name, event),
      emitStatus: (runStatus, extra) => persistHostDispatchStatus(stored.name, runStatus, extra),
      emitEvent: (event) => recordRunEvent(stored.name, event),
      onMessageControl: (control) => {
        localRunMessageControls.set(stored.name, control);
        return () => {
          if (localRunMessageControls.get(stored.name) === control) localRunMessageControls.delete(stored.name);
        };
      },
    }).finally(() => {
      liveLocalRuns.delete(stored.name);
      if (localRunControllers.get(stored.name) === controller) localRunControllers.delete(stored.name);
    });

    return stored;
  }

  async function startLocalThreadSession(session) {
    const repoPath = await resolveLocalRepoPath(session.repoPath);
    return startLocalThreadRun({
      ...session,
      repoPath,
      repoUrl: '',
      repoMode: 'local',
      threadBridge: true,
    }, session.taskPrompt, Number(session.submittedAtMs) || Date.now());
  }

  return {
    listThreadsPayload,
    listThreadPerformancePayload,
    trackedChangesPayloadForThread,
    threadDiffPayload,
    threadWorkflowPayload,
    threadArtifactPayload,
    threadImageArtifactPayload,
    getThreadSession,
    archiveThreadSession,
    unarchiveThreadSession,
    stopThreadSession,
    createThreadSession,
    promptThreadSession,
    resolveLocalRepoPath,
    startLocalThreadRun,
    startLocalThreadSession,
  };
}
