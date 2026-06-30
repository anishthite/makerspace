import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { runLocalPiSession } from '../host-pi-runner.js';
import { summarizeThreadPerformanceList } from '../performance.js';
import { normalizeImageAttachments, normalizeModelOptions, normalizeThreadRequest } from '../session.js';
import { readSavedSettings } from '../settings.js';
import { archiveStoredSession, getStoredSession, listStoredSessions, unarchiveStoredSession, upsertSession } from '../store.js';
import { normalizeSubmittedAtMs } from './utils.js';

export function createThreadService({ config, provider, http, auth, runState, bridge }) {
  const { clientError } = http;
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
  const { startThreadBridgeLaunch, refreshBridgeSessionIfNeeded, startBridgeRun } = bridge;
  const MAX_EXCALIDRAW_BYTES = 8 * 1024 * 1024;

  function safeExcalidrawArtifactPath(value) {
    const input = String(value || '').trim().replaceAll('\\', '/');
    if (!input || input.includes('\0') || path.isAbsolute(input) || /^[a-z][a-z0-9+.-]*:/i.test(input)) {
      throw clientError('A relative .excalidraw path is required.');
    }

    const normalized = path.posix.normalize(input.replace(/^\.\//, ''));
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || !normalized.endsWith('.excalidraw')) {
      throw clientError('Only relative .excalidraw artifacts can be viewed.');
    }
    return normalized;
  }

  function bufferText(buffer, artifactPath) {
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    if (data.byteLength > MAX_EXCALIDRAW_BYTES) throw clientError(`${artifactPath} is too large to preview.`);
    return data.toString('utf8');
  }

  async function readThreadArtifactFile(session, artifactPath) {
    if (session.repoPath) {
      const root = path.resolve(session.repoPath);
      const filePath = path.resolve(root, artifactPath);
      if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) throw clientError('Artifact path escapes the workspace.');
      return bufferText(await readFile(filePath), artifactPath);
    }

    if (!provider.readRemoteFile) throw clientError('Artifact preview is unavailable for this provider.', 501);
    const remotePath = path.posix.join(config.remoteWorkspaceDir, artifactPath);
    return bufferText(await provider.readRemoteFile(session, remotePath), artifactPath);
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

  async function listThreadsPayload(viewerSessionId = '', trusted = false, user = null) {
    const sessions = await listStoredSessions(config.sessionFile);
    return {
      provider: provider.info(),
      defaults: await loadPiDefaults(),
      threads: sessions
        .filter((session) => session.threadBridge && !session.archivedAt && canAccessSession(session, viewerSessionId, trusted, user))
        .map((session) => decorateLiveSession(session)),
    };
  }

  async function listThreadPerformancePayload(viewerSessionId = '', trusted = false, user = null) {
    const sessions = (await listStoredSessions(config.sessionFile))
      .filter((session) => session.threadBridge && canAccessSession(session, viewerSessionId, trusted, user));
    const eventsByName = Object.fromEntries(sessions.map((session) => [session.name, activeRuns.get(session.name)?.events || []]));
    return {
      provider: provider.info(),
      generatedAt: new Date().toISOString(),
      performance: summarizeThreadPerformanceList(sessions, eventsByName),
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
    }, browserSession, user)), normalized.initialPrompt || normalized.taskPrompt, submittedAtMs, bridgeRunId || String(submittedAtMs));
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
    if (existing.localMode) {
      if (liveLocalRuns.has(name)) throw new Error(`Main agent ${name} is already running.`);
    } else if (existing.runStatus === 'failed') {
      throw new Error(`Main agent ${name} failed; create a new main agent.`);
    }
    if (existing.bridgeClaimed && existing.taskPrompt) throw new Error(`Main agent ${name} is already running.`);

    const submittedAtMs = normalizeSubmittedAtMs(body.submittedAtMs);
    const modelOptions = normalizeModelOptions(body);
    const images = normalizeImageAttachments(body.images);
    if (existing.localMode) {
      const runId = String(submittedAtMs);
      return startLocalThreadRun({ ...withUserThreadMessage(existing, prompt, submittedAtMs, runId), ...modelOptions }, prompt, submittedAtMs, images);
    }

    const bridgeRunId = randomUUID();
    const claimed = await upsertSession(config.sessionFile, {
      ...withUserThreadMessage(existing, prompt, submittedAtMs, bridgeRunId),
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

    liveLocalRuns.add(stored.name);
    void runLocalPiSession({
      session: { ...stored, ...(runImages.length ? { images: runImages } : {}) },
      config,
      emitOutput: (text, runStatus) => appendRunOutput(stored.name, text, runStatus),
      emitMetric: (event) => persistHostDispatchMetric(stored.name, event),
      emitStatus: (runStatus, extra) => persistHostDispatchStatus(stored.name, runStatus, extra),
      emitEvent: (event) => recordRunEvent(stored.name, event),
    }).finally(() => liveLocalRuns.delete(stored.name));

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
    threadArtifactPayload,
    getThreadSession,
    archiveThreadSession,
    unarchiveThreadSession,
    createThreadSession,
    promptThreadSession,
    resolveLocalRepoPath,
    startLocalThreadRun,
    startLocalThreadSession,
  };
}
