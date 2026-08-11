import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { createDraftPullRequestForThread } from '../git-delivery.js';
import { runLocalPiSession } from '../host-pi-runner.js';
import { ensureLocalGitRepo, ensureLocalGitWorktree } from '../local-git.js';
import { analyzePiTraceText, summarizeThreadPerformanceList } from '../performance.js';
import { normalizeImageAttachments, normalizeModelOptions, normalizeThreadRequest } from '../session.js';
import { readSavedSettings } from '../settings.js';
import { archiveStoredSession, getStoredSession, listStoredSessions, unarchiveStoredSession, upsertSession } from '../store.js';
import { normalizeSubmittedAtMs, trimTrailingSlash } from './utils.js';

function threadListItem(session = {}) {
  const { name, title, status, runStatus, warning, latestActivity, finalAnswerSummary, repoPath, repoUrl, provider, localMode, branch, createdAt, updatedAt, startedAt, endedAt, completedAt, runEndedAtMs } = session;
  return { name, title, status, runStatus, warning, latestActivity, finalAnswerSummary, repoPath, repoUrl, provider, localMode, branch, createdAt, updatedAt, startedAt, endedAt, completedAt, runEndedAtMs };
}

export function createThreadService({ config, provider, http, auth, runState, bridge }) {
  const { clientError } = http;
  const localRunControllers = new Map();
  const localRunMessageControls = new Map();
  const STOPPED_WARNING = 'Stopped by user.';
  const { enrichGitHubRepoSession, canAccessSession, loadPiDefaults, githubTokenForUser, readBrowserSession } = auth;
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
  const { startThreadBridgeLaunch, refreshBridgeSessionIfNeeded, startBridgeRun, fetchBridgeJson, waitForBridge, syncBridgeAuth, markBridgeRunStale, bridgeRunMissingError, reattachBridgeRun } = bridge;
  const MAX_EXCALIDRAW_BYTES = 8 * 1024 * 1024;
  const MAX_IMAGE_ARTIFACT_BYTES = 16 * 1024 * 1024;
  const MAX_HTML_ARTIFACT_BYTES = 4 * 1024 * 1024;
  const MAX_HTML_ARTIFACT_STATE_BYTES = 256 * 1024;
  const IMAGE_ARTIFACT_TYPES = new Map([
    ['.gif', 'image/gif'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml; charset=utf-8'],
    ['.webp', 'image/webp'],
  ]);
  const WORKFLOW_MIRROR_FRESH_MS = 2000;

  function traceStep(options, label, task) {
    return options?.traceStep ? options.traceStep(label, task) : task();
  }

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

  function safeHtmlArtifactPath(value) {
    return safeRelativeArtifactPath(value, new Set(['.html']), 'Only relative HTML artifacts can be viewed.');
  }

  function safeWorkflowRunId(value) {
    const runId = String(value || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{2,100}$/i.test(runId)) throw clientError('Invalid workflow run id.');
    return runId;
  }

  function safeArtifactStateKey(value) {
    const key = String(value || 'default').trim() || 'default';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(key)) throw clientError('Invalid artifact state key.');
    return key;
  }

  function checkedArtifactStateData(value) {
    const text = JSON.stringify(value ?? null);
    checkedBuffer(Buffer.from(text), 'artifact state', MAX_HTML_ARTIFACT_STATE_BYTES);
    return JSON.parse(text);
  }

  function checkedBuffer(buffer, artifactPath, maxBytes) {
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    if (data.byteLength > maxBytes) throw clientError(`${artifactPath} is too large to preview.`);
    return data;
  }

  function bufferText(buffer, artifactPath) {
    return checkedBuffer(buffer, artifactPath, MAX_EXCALIDRAW_BYTES).toString('utf8');
  }

  async function readThreadArtifactBuffer(session, artifactPath, maxBytes, remoteReadOptions) {
    if (session.repoPath) {
      const root = path.resolve(session.repoPath);
      const filePath = path.resolve(root, artifactPath);
      if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) throw clientError('Artifact path escapes the workspace.');
      return checkedBuffer(await readFile(filePath), artifactPath, maxBytes);
    }

    if (!provider.readRemoteFile) throw clientError('Artifact preview is unavailable for this provider.', 501);
    const remotePath = path.posix.join(session.remoteWorkspaceDir || config.remoteWorkspaceDir, artifactPath);
    return checkedBuffer(await provider.readRemoteFile(session, remotePath, remoteReadOptions), artifactPath, maxBytes);
  }

  async function readThreadArtifactFile(session, artifactPath) {
    return bufferText(await readThreadArtifactBuffer(session, artifactPath, MAX_EXCALIDRAW_BYTES), artifactPath);
  }

  async function writeThreadArtifactFile(session, artifactPath, text) {
    checkedBuffer(Buffer.from(String(text || '')), artifactPath, MAX_EXCALIDRAW_BYTES);
    if (session.repoPath) {
      const root = path.resolve(session.repoPath);
      const filePath = path.resolve(root, artifactPath);
      if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) throw clientError('Artifact path escapes the workspace.');
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, text);
      return;
    }

    if (!provider.writeRemoteFile) throw clientError('Artifact editing is unavailable for this provider.', 501);
    await provider.writeRemoteFile(session, path.posix.join(session.remoteWorkspaceDir || config.remoteWorkspaceDir, artifactPath), text);
  }

  function notFound(error) {
    return error?.code === 'ENOENT' || /not found|no such file/i.test(error?.message || '');
  }

  function spannerWorkflowRunFile(runId) {
    return path.join(config.workflowRunsDir || path.join(config.localDataDir || config.rootDir || process.cwd(), 'workflows', 'runs'), `${runId}.json`);
  }

  async function readSpannerWorkflowRunFile(runId) {
    return readFile(spannerWorkflowRunFile(runId), 'utf8');
  }

  async function readSpannerWorkflowRunMirror(runId) {
    const filePath = spannerWorkflowRunFile(runId);
    const [raw, stats] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
    return { raw, ageMs: Math.max(0, Date.now() - stats.mtimeMs) };
  }

  async function writeSpannerWorkflowRunFile(runId, raw) {
    const filePath = spannerWorkflowRunFile(runId);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, raw, 'utf8');
  }

  async function readRuntimeWorkflowRunFile(session, runId) {
    const runPath = path.posix.join('.pi/better-workflows/runs', `${runId}.json`);
    if (session.repoPath) return readFile(path.join(homedir(), runPath), 'utf8');
    if (!provider.readRemoteFile) throw clientError('Workflow run details are unavailable for this provider.', 501);
    return provider.readRemoteFile(session, path.posix.join(config.remoteHomeDir || '/home/root', runPath));
  }

  function workflowRawStatus(raw) {
    try {
      return String(JSON.parse(raw)?.status || '').toLowerCase();
    } catch {
      return '';
    }
  }

  function workflowStatusIsFinal(status) {
    return ['aborted', 'cancelled', 'complete', 'completed', 'done', 'error', 'failed', 'success'].includes(status);
  }

  async function refreshThreadWorkflowRunFile(session, runId, options = {}) {
    const raw = await traceStep(options, 'workflow.remoteRead', () => readRuntimeWorkflowRunFile(session, runId));
    await traceStep(options, 'workflow.mirrorWrite', () => writeSpannerWorkflowRunFile(runId, raw));
    return raw;
  }

  async function readThreadWorkflowRunFile(session, runId, options = {}) {
    let mirror = null;
    try {
      mirror = await traceStep(options, 'workflow.mirrorRead', () => readSpannerWorkflowRunMirror(runId));
    } catch (error) {
      if (!notFound(error)) throw error;
    }

    if (mirror) {
      const status = workflowRawStatus(mirror.raw);
      if (workflowStatusIsFinal(status) || mirror.ageMs <= WORKFLOW_MIRROR_FRESH_MS) return mirror.raw;
      // ponytail: stale rail data is good enough for first paint; poll refreshes the mirror.
      refreshThreadWorkflowRunFile(session, runId).catch(() => {});
      return mirror.raw;
    }

    try {
      return await refreshThreadWorkflowRunFile(session, runId, options);
    } catch (error) {
      if (!notFound(error)) throw error;
      return readSpannerWorkflowRunFile(runId);
    }
  }

  function workflowPreview(value, max = 260) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function workflowResultPreview(value) {
    if (!value) return '';
    if (typeof value === 'string') return workflowPreview(value);
    if (Array.isArray(value)) return `${value.length} items`;
    if (typeof value !== 'object') return workflowPreview(value);
    if (typeof value.summary === 'string') return workflowPreview(value.summary);
    if (Array.isArray(value.variations)) {
      const names = value.variations.map((item) => item?.name || item?.key).filter(Boolean).slice(0, 3).join(', ');
      return workflowPreview(`${value.variations.length} variations${names ? `: ${names}` : ''}`);
    }
    if (Object.hasOwn(value, 'approved') && Object.hasOwn(value, 'score')) return workflowPreview(`${value.approved ? 'approved' : 'not approved'} · ${value.score}/10`);
    if (value.result && Object.keys(value).length === 1) return workflowResultPreview(value.result);
    return workflowPreview(Object.keys(value).slice(0, 5).join(', ') || JSON.stringify(value));
  }

  function workflowJournalPhase(entry, index) {
    const result = entry?.result;
    if (typeof result === 'string') return 'Synthesize';
    if (!result || typeof result !== 'object') return 'Journal';
    if (Array.isArray(result.variations)) return index === 0 ? 'Generate' : 'Revise';
    if (Object.hasOwn(result, 'approved')) return index <= 1 ? 'Review' : 'Revise';
    return 'Journal';
  }

  function workflowJournalLabel(entry, index) {
    const result = entry?.result;
    if (typeof result === 'string') return 'synthesize final';
    if (!result || typeof result !== 'object') return `step ${index + 1}`;
    if (Array.isArray(result.variations)) return index === 0 ? 'generate variations' : 'revise variations';
    if (Object.hasOwn(result, 'approved')) return 'review alternatives';
    return `step ${index + 1}`;
  }

  function workflowJournalToolPreview(entry) {
    const calls = Array.isArray(entry?.toolCalls) ? entry.toolCalls : [];
    const names = calls.map((call) => call?.name).filter(Boolean);
    if (!names.length) return '';
    const shown = names.slice(0, 4).join(', ');
    return names.length > 4 ? `${shown}, +${names.length - 4}` : shown;
  }

  function workflowJournalAgents(journal) {
    return journal.map((entry, index) => ({
      id: entry.index ?? index,
      label: workflowJournalLabel(entry, index),
      phase: workflowJournalPhase(entry, index),
      status: 'done',
      model: '',
      tokens: null,
      promptPreview: entry.hash ? `journal ${entry.index ?? index} · ${entry.hash}` : `journal ${entry.index ?? index}`,
      resultPreview: workflowResultPreview(entry.result),
      toolPreview: workflowJournalToolPreview(entry),
      error: workflowPreview((Array.isArray(entry.toolCalls) ? entry.toolCalls : []).find((call) => call?.isError)?.result),
      startedAt: '',
      endedAt: '',
    }));
  }

  function workflowRunPayload(runId, raw) {
    const data = JSON.parse(raw);
    const journalAgents = Array.isArray(data.journal) ? workflowJournalAgents(data.journal) : [];
    const agents = Array.isArray(data.agents) && data.agents.length ? data.agents : journalAgents;
    const source = Array.isArray(data.agents) && data.agents.length ? 'agents' : journalAgents.length ? 'journal' : 'pending';
    const phases = Array.isArray(data.phases) && data.phases.length ? data.phases : [...new Set(agents.map((agent) => agent.phase || 'workflow'))];
    return {
      available: true,
      runId: data.runId || runId,
      workflowName: data.workflowName || data.name || 'workflow',
      status: data.status || 'unknown',
      source,
      phases,
      currentPhase: data.currentPhase || phases.at(-1) || '',
      agents: agents.map((agent) => ({
        id: agent.id,
        label: agent.label || `agent ${agent.id ?? ''}`.trim(),
        phase: agent.phase || '',
        status: agent.status || 'unknown',
        model: agent.model || '',
        tokens: Number.isFinite(agent.tokens) ? agent.tokens : null,
        promptPreview: workflowPreview(agent.prompt || agent.promptPreview),
        resultPreview: workflowPreview(agent.resultPreview),
        toolPreview: workflowPreview(agent.toolPreview),
        error: workflowPreview(agent.error),
        startedAt: agent.startedAt || '',
        endedAt: agent.endedAt || '',
      })),
      resultPreview: workflowResultPreview(data.result),
      startedAt: data.startedAt || '',
      finishedAt: data.finishedAt || '',
      updatedAt: data.updatedAt || data.finishedAt || '',
    };
  }

  async function threadWorkflowPayload(name, runIdValue, viewerSessionId = '', trusted = false, user = null, options = {}) {
    const session = await traceStep(options, 'workflow.getThread', () => getThreadSession(name));
    if (!canAccessSession(session, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }
    const runId = safeWorkflowRunId(runIdValue);
    try {
      const raw = await readThreadWorkflowRunFile(session, runId, options);
      return traceStep(options, 'workflow.parse', () => workflowRunPayload(runId, raw));
    } catch (error) {
      if (notFound(error)) {
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
      data: await readThreadArtifactBuffer(session, safePath, MAX_IMAGE_ARTIFACT_BYTES, { encoding: 'base64' }),
    };
  }

  async function threadHtmlArtifactPayload(name, artifactPath, viewerSessionId = '', trusted = false, user = null) {
    const session = await getThreadSession(name);
    if (!canAccessSession(session, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }

    const safePath = safeHtmlArtifactPath(artifactPath);
    return {
      path: safePath,
      contentType: 'text/html; charset=utf-8',
      data: await readThreadArtifactBuffer(session, safePath, MAX_HTML_ARTIFACT_BYTES),
    };
  }

  async function saveThreadArtifactPayload(name, artifactPath, body = {}, viewerSessionId = '', trusted = false, user = null) {
    const session = await getThreadSession(name);
    if (!canAccessSession(session, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }

    const safePath = safeExcalidrawArtifactPath(artifactPath);
    const scene = body.data || body.scene || body;
    if (scene?.type !== 'excalidraw' || !Array.isArray(scene.elements)) throw clientError(`${safePath} is not an Excalidraw drawing.`);
    const payload = {
      type: 'excalidraw',
      version: Number.isFinite(Number(scene.version)) ? Number(scene.version) : 2,
      source: scene.source || 'https://excalidraw.com',
      elements: scene.elements,
      appState: scene.appState && typeof scene.appState === 'object' ? scene.appState : {},
      files: scene.files && typeof scene.files === 'object' ? scene.files : {},
    };
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    checkedBuffer(Buffer.from(text), safePath, MAX_EXCALIDRAW_BYTES);
    await writeThreadArtifactFile(session, safePath, text);
    return { path: safePath, saved: true, byteLength: Buffer.byteLength(text) };
  }

  async function threadHtmlArtifactStatePayload(name, artifactPath, stateKey = 'default', viewerSessionId = '', trusted = false, user = null) {
    const session = await getThreadSession(name);
    if (!canAccessSession(session, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }

    const safePath = safeHtmlArtifactPath(artifactPath);
    const key = safeArtifactStateKey(stateKey);
    const entry = session.htmlArtifactState?.[safePath]?.[key] || null;
    return { path: safePath, key, data: entry?.data ?? null, updatedAt: entry?.updatedAt || '', found: Boolean(entry) };
  }

  async function saveThreadHtmlArtifactStatePayload(name, artifactPath, body = {}, viewerSessionId = '', trusted = false, user = null) {
    const session = await getThreadSession(name);
    if (!canAccessSession(session, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }

    const safePath = safeHtmlArtifactPath(artifactPath);
    const input = body && typeof body === 'object' ? body : {};
    const key = safeArtifactStateKey(input.key || input.stateKey || 'default');
    const data = checkedArtifactStateData(Object.hasOwn(input, 'data') ? input.data : input.value);
    const updatedAt = new Date().toISOString();
    const currentState = session.htmlArtifactState && typeof session.htmlArtifactState === 'object' ? session.htmlArtifactState : {};
    const nextState = {
      ...currentState,
      [safePath]: {
        ...(currentState[safePath] && typeof currentState[safePath] === 'object' ? currentState[safePath] : {}),
        [key]: { data, updatedAt },
      },
    };
    await upsertSession(config.sessionFile, { name: session.name, htmlArtifactState: nextState, updatedAt });
    return { path: safePath, key, data, updatedAt, saved: true };
  }

  async function listThreadsPayload(viewerSessionId = '', trusted = false, user = null, options = {}) {
    const [sessions, defaults] = await Promise.all([
      traceStep(options, 'threads.listSessions', () => listStoredSessions(config.sessionFile)),
      traceStep(options, 'defaults.load', () => loadPiDefaults(user, { staleOk: true })),
    ]);
    const visibleSessions = sessions
      .filter((session) => session.threadBridge && !session.archivedAt && canAccessSession(session, viewerSessionId, trusted, user));
    const threads = await traceStep(options, 'threads.decorate', () => Promise.all(visibleSessions.map(async (session) => {
      await reattachBridgeRun?.(session);
      return threadListItem(decorateLiveSession(session));
    })));
    return {
      provider: provider.info(),
      defaults,
      threads,
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

  function pullRequestPatch(result, existing = {}, status = 'created') {
    return {
      prStatus: result.noChanges && !existing.prUrl ? 'no-changes' : status,
      prUrl: result.pullRequest?.url || existing.prUrl || '',
      prNumber: result.pullRequest?.number || existing.prNumber || null,
      prBranch: result.branch || existing.prBranch || '',
      prCommit: result.commit || existing.prCommit || '',
      prFiles: result.files || existing.prFiles || [],
      prUpdatedAt: new Date().toISOString(),
      prError: '',
    };
  }

  async function createThreadPullRequestPayload(name, body = {}, viewerSessionId = '', trusted = false, user = null) {
    const session = await getThreadSession(name);
    if (!canAccessSession(session, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }
    if (session.localMode) throw clientError('Draft PR delivery is only available for GitHub cloud workspaces.', 400);

    const owner = session.ownerUserId ? { id: session.ownerUserId } : user;
    const browserToken = config.authRequired || session.ownerUserId ? '' : readBrowserSession?.(viewerSessionId)?.githubToken || '';
    const token = await githubTokenForUser?.(owner) || browserToken;
    if (!token) throw clientError('Reconnect GitHub before creating a pull request.', 401);

    const files = trackedChangesPayloadForThread(session).files;
    await upsertSession(config.sessionFile, {
      ...session,
      prStatus: 'creating',
      prError: '',
      updatedAt: new Date().toISOString(),
    });

    try {
      const result = await createDraftPullRequestForThread({
        session,
        provider,
        token,
        changes: files,
        options: body,
      });
      const updated = await upsertSession(config.sessionFile, {
        ...((await getStoredSession(config.sessionFile, name)) || session),
        ...pullRequestPatch(result, session),
        updatedAt: new Date().toISOString(),
      });
      return {
        provider: provider.info(),
        thread: decorateLiveSession(updated),
        pullRequest: result.pullRequest,
        noChanges: Boolean(result.noChanges),
        files: result.files || [],
      };
    } catch (error) {
      await upsertSession(config.sessionFile, {
        ...((await getStoredSession(config.sessionFile, name)) || session),
        prStatus: 'failed',
        prError: error.message,
        prUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async function getThreadSession(name) {
    const session = await getStoredSession(config.sessionFile, name);
    if (!session?.threadBridge) {
      throw new Error(`No main agent named ${name}.`);
    }
    return session;
  }

  function activeControlStatus(session) {
    const stored = effectiveStoredRunStatus(session);
    if (!session.localMode && session.bridgeClaimed && isActiveRunStatus(stored)) return stored;
    return effectiveStoredRunStatus(decorateLiveSession(session));
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

    const status = activeControlStatus(existing);
    if (!isActiveRunStatus(status)) {
      throw clientError('Only running main agents can be stopped.');
    }

    if (existing.localMode) {
      localRunControllers.get(name)?.abort();
    } else if (existing.bridgeUrl && existing.bridgeRunId && existing.bridgeToken) {
      try {
        await fetchBridgeJson(existing, `/runs/${encodeURIComponent(existing.bridgeRunId)}/stop`, { method: 'POST' });
      } catch (error) {
        if (bridgeRunMissingError?.(error) && markBridgeRunStale) {
          return markBridgeRunStale(name, existing, 'Bridge run disappeared before it could be stopped.', { missing: true });
        }
        if (status !== 'launching') throw error;
      }
    }

    return markThreadStopped(existing);
  }

  function assertRemoteLifecycleAllowed(session, action) {
    if (session.localMode) throw clientError(`Local main agents do not support ${action}.`, 400);
    const status = activeControlStatus(session);
    if (isActiveRunStatus(status)) throw clientError(`Only idle main agents can be ${action}.`, 409);
    return status;
  }

  async function suspendThreadSession(name, viewerSessionId = '', trusted = false, user = null) {
    const existing = await getThreadSession(name);
    if (!canAccessSession(existing, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }
    if (!provider.suspendSession) throw clientError('Current provider does not support suspend.', 501);
    const status = assertRemoteLifecycleAllowed(existing, 'suspended');
    if (['suspended', 'deleted'].includes(status)) throw clientError(`Main agent is already ${status}.`, 409);

    appendRunOutput(name, '[system] Backing up the sandbox, then suspending compute.\n', 'suspended');
    const remote = await provider.suspendSession(existing);
    const now = new Date().toISOString();
    const suspended = await upsertSession(config.sessionFile, {
      ...existing,
      ...remote,
      status: 'suspended',
      runStatus: 'suspended',
      warning: null,
      suspendedAt: now,
      updatedAt: now,
    });
    setRunState(name, { runStatus: 'suspended', warning: null });
    appendRunStatus(name, 'suspended', { done: true });
    return suspended;
  }

  async function resumeThreadSession(name, viewerSessionId = '', trusted = false, user = null, options = {}) {
    const existing = await getThreadSession(name);
    if (!canAccessSession(existing, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }
    if (!provider.resumeSession) throw clientError('Current provider does not support resume.', 501);
    const status = assertRemoteLifecycleAllowed(existing, 'resumed');
    if (status !== 'suspended') throw clientError('Only suspended main agents can be resumed.', 409);

    const startedAt = new Date().toISOString();
    resetRunState(name, 'launching');
    if (options.autoPrompt) appendRunOutput(name, '[system] Auto-resuming suspended sandbox before sending prompt.\n', 'launching');
    appendRunOutput(name, '[system] Restoring the Cloudflare sandbox.\n', 'launching');
    const resuming = await upsertSession(config.sessionFile, {
      ...existing,
      status: 'launching',
      runStatus: 'launching',
      warning: null,
      updatedAt: startedAt,
    });

    try {
      const imageSettings = await readSavedSettings(config.settingsFile);
      const remote = await provider.resumeSession(resuming, imageSettings);
      const bridgeUrl = trimTrailingSlash(remote.bridgeUrl || remote.httpsUrl || existing.bridgeUrl || '');
      const launching = await upsertSession(config.sessionFile, {
        ...resuming,
        ...remote,
        bridgeUrl,
        status: 'launching',
        runStatus: 'launching',
        warning: null,
        updatedAt: new Date().toISOString(),
      });

      await waitForBridge(launching);
      await syncBridgeAuth(launching);
      const ready = await upsertSession(config.sessionFile, {
        ...launching,
        status: 'ready',
        runStatus: 'ready',
        resumedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setRunState(name, { runStatus: 'ready', warning: null });
      appendRunOutput(name, options.autoPrompt ? '[system] Sandbox resumed. Starting your prompt.\n' : '[system] Sandbox resumed. Send a prompt to start a new run.\n', 'ready');
      return ready;
    } catch (error) {
      const message = error?.message || String(error);
      const failed = await upsertSession(config.sessionFile, {
        ...existing,
        status: 'suspended',
        runStatus: 'suspended',
        warning: message,
        updatedAt: new Date().toISOString(),
      });
      setRunState(name, { runStatus: 'suspended', warning: message });
      appendRunOutput(name, `[system] Sandbox resume failed: ${message}\n`, 'suspended');
      const resumeError = error instanceof Error ? error : new Error(message);
      resumeError.thread = failed;
      throw resumeError;
    }
  }

  async function deleteThreadSession(name, viewerSessionId = '', trusted = false, user = null) {
    const existing = await getThreadSession(name);
    if (!canAccessSession(existing, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }
    if (!provider.deleteSessionWithBackup) throw clientError('Current provider does not support backup-before-delete.', 501);
    const status = assertRemoteLifecycleAllowed(existing, 'deleted');
    if (status === 'deleted') throw clientError('Main agent is already deleted.', 409);

    const previous = { status: existing.status, runStatus: existing.runStatus };
    resetRunState(name, 'backing_up');
    appendRunOutput(name, '[system] Backing up the sandbox before deleting it.\n', 'backing_up');
    await upsertSession(config.sessionFile, {
      ...existing,
      status: 'backing_up',
      runStatus: 'backing_up',
      warning: null,
      updatedAt: new Date().toISOString(),
    });

    try {
      const backup = await provider.deleteSessionWithBackup(existing);
      const now = new Date().toISOString();
      const deleted = await upsertSession(config.sessionFile, {
        ...existing,
        cloudflareBackups: backup.cloudflareBackups || existing.cloudflareBackups || [],
        cloudflareBackupCreatedAt: backup.cloudflareBackupCreatedAt || now,
        deletedSandboxId: backup.cloudflareSandboxId || existing.cloudflareSandboxId || existing.sandboxId || null,
        sandboxId: null,
        cloudflareSandboxId: null,
        cloudflareSandboxName: null,
        cloudflareState: 'deleted',
        bridgeUrl: '',
        httpsUrl: '',
        previewToken: null,
        status: 'deleted',
        runStatus: 'deleted',
        deletedAt: now,
        updatedAt: now,
      });
      setRunState(name, { runStatus: 'deleted', warning: null });
      appendRunOutput(name, '[system] Backup saved. Sandbox deleted.\n', 'deleted');
      appendRunStatus(name, 'deleted', { done: true });
      return { thread: deleted, backup };
    } catch (error) {
      const current = (await getStoredSession(config.sessionFile, name)) || existing;
      await upsertSession(config.sessionFile, {
        ...current,
        status: previous.status,
        runStatus: previous.runStatus,
        warning: error.message,
        updatedAt: new Date().toISOString(),
      });
      setRunState(name, { runStatus: previous.runStatus || previous.status || 'ready', warning: error.message });
      appendRunOutput(name, `[system] Backup failed; sandbox was not deleted: ${error.message}\n`, previous.runStatus || previous.status || 'ready');
      throw error;
    }
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
    const localGitMode = provider.kind === 'local' && normalized.repoMode === 'git' && !normalized.repoPath;
    const bridgeRunId = normalized.bridgeMode && !localGitMode ? randomUUID() : '';
    const session = withUserThreadMessage(withFallbackThreadTitle({
      ...normalized,
      ...(bridgeRunId ? { bridgeRunId } : {}),
      ...(user?.id ? { ownerUserId: user.id } : browserSessionIdValue ? { githubOwnerSessionId: browserSessionIdValue } : {}),
      submittedAtMs,
    }), normalized.initialPrompt || normalized.taskPrompt, submittedAtMs, bridgeRunId || String(submittedAtMs), normalized.images || []);
    const existing = await getStoredSession(config.sessionFile, session.name);
    if (existing) {
      throw new Error(`A main agent named ${session.name} already exists.`);
    }

    const now = new Date().toISOString();
    const queued = await upsertSession(config.sessionFile, {
      ...session,
      provider: provider.kind,
      status: 'launching',
      runStatus: 'launching',
      createdAt: now,
      updatedAt: now,
    });
    resetRunState(queued.name, 'launching');
    appendRunOutput(queued.name, '[system] Preparing main agent.\n', 'launching');

    void (async () => {
      try {
        const current = await getStoredSession(config.sessionFile, queued.name);
        if (!current || current.runStatus !== 'launching') return;
        const enriched = await enrichGitHubRepoSession(current, browserSession, user);
        let thread;
        if (enriched.repoPath) {
          thread = await startLocalThreadSession(enriched);
        } else if (localGitMode) {
          thread = await startLocalGitThreadSession(enriched);
        } else {
          thread = await startThreadBridgeLaunch(enriched, await readSavedSettings(config.settingsFile));
        }
        scheduleThreadTitleGeneration(thread);
      } catch (error) {
        const latest = (await getStoredSession(config.sessionFile, queued.name)) || queued;
        const warning = error?.message || String(error);
        const failedAt = new Date().toISOString();
        await upsertSession(config.sessionFile, {
          ...latest,
          taskPrompt: '',
          images: [],
          bridgeClaimed: false,
          warmClaimed: false,
          status: 'failed',
          runStatus: 'failed',
          warning,
          endedAt: failedAt,
          runEndedAtMs: Date.parse(failedAt),
          updatedAt: failedAt,
        });
        setRunState(queued.name, { runStatus: 'failed', warning });
        appendRunOutput(queued.name, `[system] Main agent launch failed: ${warning}\n`, 'failed');
        appendRunStatus(queued.name, 'failed', { warning, done: true });
      }
    })();

    return queued;
  }

  async function promptThreadSession(name, body, viewerSessionId = '', trusted = false, user = null) {
    const prompt = String(body.prompt || '').trim();
    if (!prompt) throw new Error('Prompt is required.');

    let existing = await getThreadSession(name);
    if (!canAccessSession(existing, viewerSessionId, trusted, user)) {
      throw clientError(`Main agent ${name} belongs to a different user.`, 403);
    }
    const submittedAtMs = normalizeSubmittedAtMs(body.submittedAtMs);
    const modelOptions = normalizeModelOptions(body);
    const images = normalizeImageAttachments(body.images);
    const delivery = normalizeMessageDelivery(body.delivery);
    let status = String(activeControlStatus(existing) || existing.runStatus || existing.status || '').toLowerCase();

    if (!existing.localMode && status === 'suspended') {
      existing = await resumeThreadSession(name, viewerSessionId, trusted, user, { autoPrompt: true });
      status = String(activeControlStatus(existing) || existing.runStatus || existing.status || '').toLowerCase();
    }

    if (existing.localMode && liveLocalRuns.has(name)) {
      return sendActiveLocalThreadMessage(existing, prompt, submittedAtMs, delivery, images);
    }
    if (!existing.localMode && existing.runStatus === 'failed') {
      throw new Error(`Main agent ${name} failed; create a new main agent.`);
    }
    if (!existing.localMode && existing.bridgeClaimed && existing.taskPrompt && isActiveRunStatus(status)) {
      if (!['queued', 'starting', 'running'].includes(status)) throw clientError('Main agent is starting; try again in a moment.', 409);
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

    if (['ready', 'completed'].includes(status) && existing.bridgeUrl && existing.bridgeToken) {
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
      status: 'launching',
      runStatus: 'starting',
      firstLlmLatencyMs: null,
      updatedAt: now,
      createdAt: session.createdAt || now,
    });

    resetRunState(stored.name, 'starting');
    appendRunOutput(stored.name, `[system] Running main agent locally in ${stored.repoPath}.\n`, 'starting');

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
    const sourceRepoPath = await resolveLocalRepoPath(session.repoPath);
    const worktree = await ensureLocalGitWorktree({ ...session, repoPath: sourceRepoPath }, config);
    return startLocalThreadRun({
      ...session,
      ...worktree,
      repoPath: worktree.worktreePath,
      repoUrl: '',
      repoMode: 'local',
      branch: session.branch || 'main',
      threadBridge: true,
    }, session.taskPrompt, Number(session.submittedAtMs) || Date.now());
  }

  async function startLocalGitThreadSession(session) {
    const sourceRepoPath = await ensureLocalGitRepo(session, config);
    const worktree = await ensureLocalGitWorktree({ ...session, repoPath: sourceRepoPath, sourceRepoPath }, config);
    return startLocalThreadRun({
      ...session,
      ...worktree,
      repoPath: worktree.worktreePath,
      repoAuthHeader: '',
      bridgeMode: false,
      bridgeClaimed: false,
      bridgeRunId: '',
      localMode: true,
      branch: session.branch || 'main',
      threadBridge: true,
    }, session.taskPrompt, Number(session.submittedAtMs) || Date.now());
  }

  return {
    listThreadsPayload,
    listThreadPerformancePayload,
    trackedChangesPayloadForThread,
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
    archiveThreadSession,
    unarchiveThreadSession,
    stopThreadSession,
    suspendThreadSession,
    resumeThreadSession,
    deleteThreadSession,
    createThreadSession,
    promptThreadSession,
    resolveLocalRepoPath,
    startLocalThreadRun,
    startLocalThreadSession,
  };
}
