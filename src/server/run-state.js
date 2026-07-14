import { outputEventsFromText } from '../log-format.js';
import { applyPerformanceEvent } from '../performance.js';
import { appendRetainedOutput, retainedOutputChunk } from '../resource-utils.js';
import { appendThreadMessages, decorateSession, threadMessage } from '../session.js';
import { getStoredSession, listStoredSessions, upsertSession } from '../store.js';
import { fallbackThreadTitle, generateFinalAnswerSummary, generateFinalTurnStatus, generateSuggestedNextSteps, generateThreadTitle, generateWorkspaceLaunchSuggestions } from '../thread-title.js';
import { sleep } from './utils.js';

export function createRunState({ config, provider, loadPiSdk, loadPiAi, canAccessSession, authStorageForSession = null }) {
  const activeRuns = new Map();
  const liveLocalRuns = new Set();
  const finalAnswerSummaryRuns = new Set();
  const finalTurnStatusRuns = new Set();
  const suggestedNextStepRuns = new Set();
  const workspaceLaunchSuggestionCache = new Map();
  const runSubscribers = new Map();
  const polishQueue = [];
  let polishQueueRunning = false;
  const MAX_CHANGE_BYTES = 180_000;
  const MAX_CHANGE_FILES = 200;
  const WORKSPACE_SUGGESTION_CACHE_MS = 5 * 60 * 1000;

  function ensureRunState(name) {
    if (!activeRuns.has(name)) {
      activeRuns.set(name, {
        output: '',
        outputBaseOffset: 0,
        remoteLogOffset: 0,
        runStatus: 'unknown',
        warning: null,
        events: [],
        performance: null,
        nextEventId: 1,
        bridgeFollowing: false,
        trackedChanges: [],
        toolCalls: new Map(),
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
      appendRetainedOutput(run, payload.chunk);
    }

    if (payload.runStatus) {
      run.runStatus = payload.runStatus;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'warning')) {
      run.warning = payload.warning || null;
    }

    run.events.push(payload);
    run.performance = applyPerformanceEvent(run.performance, payload);
    recordTrackedChangeEvent(name, payload);
    if (run.events.length > 2000) {
      run.events.shift();
    }

    notifyRunSubscribers(name, payload);
    return payload;
  }

  function appendRunOutput(name, text, runStatus = ensureRunState(name).runStatus) {
    if (!text) return;
    for (const event of outputEventsFromText(text)) {
      recordRunEvent(name, { ...event, runStatus });
    }
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
    if (Array.isArray(patch.events) && patch.events.length === 0) {
      run.trackedChanges = [];
      run.toolCalls = new Map();
    }
    Object.assign(run, patch);
    return run;
  }

  function resetRunState(name, runStatus, patch = {}) {
    return setRunState(name, {
      output: '',
      outputBaseOffset: 0,
      remoteLogOffset: 0,
      runStatus,
      warning: null,
      events: [],
      performance: null,
      nextEventId: 1,
      bridgeFollowing: false,
      ...patch,
    });
  }

  function normalizeToolName(value) {
    return String(value || '').split('.').pop();
  }

  function compactActivityText(value, max = 140) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }

  function activityArg(args, ...keys) {
    for (const key of keys) {
      const value = args[key];
      const text = Array.isArray(value) ? value.map((item) => (item && typeof item === 'object' ? '' : compactActivityText(item, 80))).filter(Boolean).slice(0, 2).join(', ') : compactActivityText(value, 120);
      if (text && !(value && typeof value === 'object' && !Array.isArray(value))) return text;
    }
    return '';
  }

  function activityToolAction(event = {}) {
    const args = event.args && typeof event.args === 'object' ? event.args : {};
    const toolName = normalizeToolName(event.toolName).toLowerCase();
    const target = activityArg(args, 'path', 'file_path', 'file', 'filename')
      || (toolName.includes('grep') ? activityArg(args, 'constraints', 'glob') || 'workspace' : '')
      || activityArg(args, 'url', 'urls', 'query', 'queries');
    const withTarget = (verb, fallback) => (target ? `${verb} ${target}` : fallback);

    if (toolName === 'bash') return args.command ? `running ${compactActivityText(String(args.command).split(/\r?\n/)[0], 120)}` : 'running command';
    if (toolName === 'read') return withTarget('reading', 'reading file');
    if (toolName === 'edit') return withTarget('editing', 'editing file');
    if (toolName === 'write') return withTarget('writing', 'writing file');
    if (toolName.includes('grep')) return withTarget('searching', 'searching workspace');
    if (toolName === 'todo') return 'updating tasks';
    if (toolName === 'workflow') return 'running workflow';
    return compactActivityText(event.label || event.toolName || 'working');
  }

  function latestRunActivity(run) {
    const events = Array.isArray(run?.events) ? run.events : [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index] || {};
      if (event.type === 'tool') return event.isError ? 'tool failed' : activityToolAction(event);
      if (event.type === 'thinking') return 'thinking';
      if (event.chunk && event.type !== 'log') return 'answering';
      if (event.warning) return compactActivityText(event.warning);
    }
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index] || {};
      if (event.type !== 'status') continue;
      const detail = compactActivityText(event.warning || event.message || '');
      if (detail) return detail;
      if (event.runStatus === 'queued') return 'waiting for main agent';
      if (event.runStatus === 'starting' || event.runStatus === 'launching') return 'starting main agent';
      if (event.runStatus === 'running') return 'working';
    }
    return '';
  }

  function trackedChangePath(args = {}) {
    return String(args.path || args.file_path || args.filePath || '').trim();
  }

  function capChangeText(value) {
    const text = String(value || '');
    if (text.length <= MAX_CHANGE_BYTES) return { text, truncated: false };
    return { text: `${text.slice(0, MAX_CHANGE_BYTES)}\n… change preview truncated`, truncated: true };
  }

  function normalizeTrackedChange(file) {
    if (!file || typeof file !== 'object') return null;
    const filePath = String(file.path || '').trim();
    if (!filePath) return null;
    const capped = capChangeText(file.diff || file.preview || file.summary || '');
    return {
      path: filePath,
      code: String(file.code || 'M'),
      label: String(file.label || 'changed'),
      diff: capped.text,
      toolName: file.toolName ? String(file.toolName) : undefined,
      toolCallId: file.toolCallId ? String(file.toolCallId) : undefined,
      updatedAt: file.updatedAt ? String(file.updatedAt) : new Date().toISOString(),
      truncated: Boolean(file.truncated || capped.truncated),
    };
  }

  function mergeTrackedChanges(...groups) {
    const byPath = new Map();
    for (const group of groups) {
      for (const file of Array.isArray(group) ? group : []) {
        const change = normalizeTrackedChange(file);
        if (!change) continue;
        byPath.delete(change.path);
        byPath.set(change.path, change);
      }
    }
    return [...byPath.values()].slice(-MAX_CHANGE_FILES);
  }

  function trackedChangeFromToolEvent(event, args) {
    const toolName = normalizeToolName(event.toolName);
    const filePath = trackedChangePath(args);
    if (!filePath || !['edit', 'write'].includes(toolName)) return null;

    if (toolName === 'edit') {
      const fallback = `edited ${filePath}\n\n${Array.isArray(args.edits) ? args.edits.length : 0} replacement block(s).`;
      const preview = event.details?.patch || event.details?.diff || fallback;
      return {
        path: filePath,
        code: 'M',
        label: 'edited',
        diff: preview,
        toolName,
        toolCallId: event.toolCallId,
        updatedAt: event.timestamp,
      };
    }

    const content = typeof args.content === 'string' ? args.content : '';
    return {
      path: filePath,
      code: 'W',
      label: 'wrote',
      diff: content ? `wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${filePath}\n\n${content}` : `wrote ${filePath}`,
      toolName,
      toolCallId: event.toolCallId,
      updatedAt: event.timestamp,
    };
  }

  function rememberToolArgs(run, event) {
    if (!(run.toolCalls instanceof Map)) run.toolCalls = new Map();
    const key = event.toolCallId || `${event.toolName || 'tool'}-${event.id || run.nextEventId}`;
    const existing = run.toolCalls.get(key) || {};
    run.toolCalls.set(key, {
      ...existing,
      toolName: event.toolName || existing.toolName,
      args: event.args && typeof event.args === 'object' ? event.args : existing.args,
    });
    return run.toolCalls.get(key);
  }

  async function persistTrackedChanges(name) {
    const session = await getStoredSession(config.sessionFile, name);
    if (!session) return;
    const live = activeRuns.get(name)?.trackedChanges || [];
    await upsertSession(config.sessionFile, {
      name,
      trackedChanges: mergeTrackedChanges(session.trackedChanges, live),
      updatedAt: new Date().toISOString(),
    });
  }

  function recordTrackedChangeEvent(name, event) {
    if (event.type !== 'tool') return;
    const run = ensureRunState(name);
    if (!Array.isArray(run.trackedChanges)) run.trackedChanges = [];
    const remembered = rememberToolArgs(run, event);
    if (event.phase !== 'end' || event.isError) return;
    const change = trackedChangeFromToolEvent(event, event.args || remembered.args || {});
    if (!change) return;
    run.trackedChanges = mergeTrackedChanges(run.trackedChanges, [change]);
    void persistTrackedChanges(name).catch((error) => console.warn(`[spanner] failed to persist tracked changes for ${name}: ${error.message}`));
  }

  const FINISHED_RUN_STATUSES = ['completed', 'ready', 'failed'];

  function statusFromRunStatus(runStatus, fallbackStatus = 'unknown') {
    if (runStatus === 'launching') return 'launching';
    if (runStatus === 'queued') return 'launching';
    if (runStatus === 'starting') return 'launching';
    if (runStatus === 'running') return 'running';
    if (runStatus === 'completed') return 'completed';
    if (runStatus === 'failed') return 'failed';
    if (runStatus === 'ready') return 'ready';
    if (runStatus === 'suspended') return 'suspended';
    if (runStatus === 'deleted') return 'deleted';
    if (runStatus === 'backing_up') return 'launching';
    return fallbackStatus;
  }

  function effectiveStoredRunStatus(session) {
    const runStatus = String(session?.runStatus || '').toLowerCase();
    return runStatus && runStatus !== 'unknown' ? runStatus : String(session?.status || '').toLowerCase();
  }

  function isFinishedRunStatus(status) {
    return FINISHED_RUN_STATUSES.includes(String(status || '').toLowerCase());
  }

  function activeRunTerminalPatch() {
    return {
      completedAt: undefined,
      endedAt: undefined,
      runEndedAtMs: undefined,
    };
  }

  function activeRunResetPatch() {
    return {
      ...activeRunTerminalPatch(),
      performance: undefined,
      finalAnswerSummary: undefined,
      finalAnswerSummaryRunId: undefined,
      finalAnswerSummaryModel: undefined,
      finalAnswerSummaryUpdatedAt: undefined,
      finalTurnStatus: undefined,
      finalTurnColor: undefined,
      finalTurnReason: undefined,
      finalTurnStatusRunId: undefined,
      finalTurnStatusModel: undefined,
      finalTurnStatusUpdatedAt: undefined,
      suggestedNextSteps: undefined,
      suggestedNextStepsRunId: undefined,
      suggestedNextStepsModel: undefined,
      suggestedNextStepsUpdatedAt: undefined,
    };
  }

  function terminalStoredRunStatus(session) {
    const status = effectiveStoredRunStatus(session);
    if (isFinishedRunStatus(status)) return status;
    if (!isActiveRunStatus(status)) return '';
    if (session.completedAt) return 'completed';
    if (session.endedAt || session.runEndedAtMs) return 'failed';
    return '';
  }

  function inactiveStoredRunStatus(session) {
    const terminalStatus = terminalStoredRunStatus(session);
    if (terminalStatus) return terminalStatus;
    return isActiveRunStatus(effectiveStoredRunStatus(session)) ? 'failed' : '';
  }

  function decorateInactiveStoredSession(session) {
    const runStatus = inactiveStoredRunStatus(session);
    if (!runStatus) return session;

    const lostActiveRun = runStatus === 'failed' && isActiveRunStatus(effectiveStoredRunStatus(session)) && !terminalStoredRunStatus(session);
    const endedAt = session.endedAt || session.completedAt || session.updatedAt || session.createdAt;
    const runEndedAtMs = Number(session.runEndedAtMs) || Date.parse(endedAt || '');
    return {
      ...session,
      status: statusFromRunStatus(runStatus, session.status),
      runStatus,
      endedAt,
      runEndedAtMs: Number.isFinite(runEndedAtMs) ? runEndedAtMs : undefined,
      warning: lostActiveRun ? session.warning || 'Main agent connection is stale; reconnecting failed, so start a new main agent.' : session.warning,
      completedAt: runStatus === 'completed' ? session.completedAt || endedAt : undefined,
    };
  }

  function decorateLiveSession(session) {
    const run = activeRuns.get(session.name);
    const decorated = decorateSession(session, config);

    if (!run || terminalStoredRunStatus(decorated)) {
      return decorateInactiveStoredSession(decorated);
    }

    if (decorated.localMode && isActiveRunStatus(run.runStatus || decorated.runStatus || decorated.status) && !liveLocalRuns.has(session.name)) {
      return decorateInactiveStoredSession(decorated);
    }

    const visible = isActiveRunStatus(run.runStatus || decorated.runStatus || decorated.status)
      ? { ...decorated, ...activeRunTerminalPatch() }
      : decorated;

    const latestActivity = latestRunActivity(run);
    return {
      ...visible,
      status: statusFromRunStatus(run.runStatus, decorated.status),
      runStatus: run.runStatus,
      warning: run.warning,
      latestActivity: latestActivity || undefined,
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

  async function listSessionsPayload(viewerSessionId = '', trusted = false, user = null) {
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
        .filter((session) => canAccessSession(session, viewerSessionId, trusted, user))
        .map((session) => decorateLiveSession(session)),
    };
  }

  function controlBoardKind(session = {}) {
    if (session.workspaceBridge) return 'workspace bridge';
    if (session.warmBridge) return 'warm bridge';
    if (session.intentBridge) return 'intent bridge';
    if (session.threadBridge && session.localMode) return 'local main agent';
    if (session.threadBridge) return 'main agent';
    if (session.bridgeMode) return 'bridge';
    return 'session';
  }

  function controlBoardRepo(session = {}) {
    return session.repoFullName || session.repoPath || session.repoUrl || session.remoteWorkspaceDir || '';
  }

  function incrementCount(counts, key) {
    const normalized = String(key || 'unknown').toLowerCase() || 'unknown';
    counts[normalized] = (counts[normalized] || 0) + 1;
  }

  function byteLength(value) {
    return Buffer.byteLength(String(value || ''), 'utf8');
  }

  function eventLabel(event = {}) {
    if (!event) return '';
    if (event.type === 'tool') {
      const phase = event.phase === 'end' ? 'finished' : event.phase === 'start' ? 'started' : 'used';
      return `${phase} ${normalizeToolName(event.toolName || 'tool')}`;
    }
    if (event.type === 'chunk') return compactActivityText(event.chunk, 120) || 'assistant output';
    if (event.type === 'metric') return compactActivityText(event.metric, 120) || 'metric';
    if (event.type === 'status') return compactActivityText(event.warning || event.message || event.runStatus, 120) || 'status';
    if (event.type === 'workflow_status') return compactActivityText(event.status || event.label || event.message, 120) || 'workflow status';
    if (event.type === 'workflow_result') return compactActivityText(event.label || event.message, 120) || 'workflow result';
    return compactActivityText(event.label || event.message || event.type, 120);
  }

  function controlBoardLastEvent(run = {}) {
    const event = Array.isArray(run.events) ? run.events.at(-1) : null;
    if (!event) return null;
    return {
      id: event.id || null,
      type: event.type || 'event',
      timestamp: event.timestamp || '',
      runStatus: event.runStatus || run.runStatus || '',
      label: eventLabel(event),
      warning: event.warning || null,
    };
  }

  function controlBoardSession(session = {}) {
    const decorated = decorateLiveSession(session);
    const run = activeRuns.get(session.name);
    const runStatus = String(decorated.runStatus || decorated.status || session.runStatus || session.status || 'unknown').toLowerCase() || 'unknown';
    const status = String(decorated.status || statusFromRunStatus(runStatus, session.status || 'unknown') || 'unknown').toLowerCase() || 'unknown';
    const latestActivity = decorated.latestActivity || (run ? latestRunActivity(run) : '');

    return {
      ...decorated,
      kind: controlBoardKind(session),
      repo: controlBoardRepo(session),
      status,
      runStatus,
      ownerUserId: session.ownerUserId || '',
      source: session.source || decorated.source || '',
      activeRun: Boolean(run),
      eventCount: Array.isArray(run?.events) ? run.events.length : 0,
      outputBytes: byteLength(run?.output),
      subscriberCount: runSubscribers.get(session.name)?.size || 0,
      trackedChangeCount: Array.isArray(run?.trackedChanges) ? run.trackedChanges.length : Array.isArray(session.trackedChanges) ? session.trackedChanges.length : 0,
      latestActivity: latestActivity || '',
      lastEvent: controlBoardLastEvent(run),
      bridge: {
        mode: Boolean(session.bridgeMode),
        claimed: Boolean(session.bridgeClaimed),
        warmClaimed: Boolean(session.warmClaimed),
        warm: Boolean(session.warmBridge),
        intent: Boolean(session.intentBridge),
        workspace: Boolean(session.workspaceBridge),
        hasUrl: Boolean(session.bridgeUrl || session.httpsUrl),
        workspaceSessionName: session.workspaceSessionName || '',
      },
    };
  }

  function controlBoardRun(name, run = {}) {
    return {
      name,
      runStatus: String(run.runStatus || 'unknown').toLowerCase() || 'unknown',
      warning: run.warning || null,
      latestActivity: latestRunActivity(run),
      eventCount: Array.isArray(run.events) ? run.events.length : 0,
      outputBytes: byteLength(run.output),
      subscriberCount: runSubscribers.get(name)?.size || 0,
      bridgeFollowing: Boolean(run.bridgeFollowing),
      trackedChangeCount: Array.isArray(run.trackedChanges) ? run.trackedChanges.length : 0,
      lastEvent: controlBoardLastEvent(run),
    };
  }

  function controlBoardConfigPayload() {
    const controlBoardUsers = Array.isArray(config.controlBoardUsers) ? config.controlBoardUsers : [];
    const allowedUsers = Array.isArray(config.allowedUsers) ? config.allowedUsers : [];
    return {
      projectName: config.projectName || 'spanner',
      provider: config.provider || provider.kind,
      stateStore: config.stateStore || 'file',
      authRequired: Boolean(config.authRequired),
      workspaceMode: Boolean(config.workspaceMode),
      hostDispatchEnabled: Boolean(config.hostDispatchEnabled),
      host: config.host || '',
      port: config.port,
      bridgePort: config.bridgePort,
      warmBridgePoolSize: config.warmBridgePoolSize || 0,
      idleBridgeTtlMs: config.idleBridgeTtlMs || 0,
      threadBridgeIdleTtlMs: config.threadBridgeIdleTtlMs || 0,
      bridgeRunStaleMs: config.bridgeRunStaleMs || 0,
      cloudflare: {
        brokerConfigured: Boolean(config.cloudflareBrokerUrl),
        brokerTokenConfigured: Boolean(config.cloudflareBrokerToken),
        machine: config.cloudflareMachine || '',
        keepAlive: config.cloudflareKeepAlive !== false,
      },
      storage: {
        sessionFile: config.sessionFile || '',
        settingsFile: config.settingsFile || '',
        workflowRunsDir: config.workflowRunsDir || '',
        piSessionTraceDir: config.piSessionTraceDir || '',
      },
      controlBoardUsers: controlBoardUsers.length
        ? controlBoardUsers
        : allowedUsers.length
          ? allowedUsers
          : ['anish', 'anishthite'],
    };
  }

  function controlBoardSummary(sessions, activeRunsPayload, liveSessions, liveError) {
    const statusCounts = {};
    const kindCounts = {};
    for (const session of sessions) {
      incrementCount(statusCounts, session.runStatus || session.status);
      incrementCount(kindCounts, session.kind);
    }
    const subscriberCount = activeRunsPayload.reduce((sum, run) => sum + (run.subscriberCount || 0), 0);
    const readyBridges = sessions.filter((session) => session.bridge?.mode && !session.bridge?.claimed && session.runStatus === 'ready').length;
    const launchingWarmBridges = sessions.filter((session) => session.bridge?.warm && ['launching', 'starting', 'queued'].includes(session.runStatus)).length;

    return {
      totalSessions: sessions.length,
      activeRuns: activeRunsPayload.length,
      runningSessions: sessions.filter((session) => isActiveRunStatus(session.runStatus || session.status)).length,
      readyBridges,
      warmBridges: sessions.filter((session) => session.bridge?.warm).length,
      launchingWarmBridges,
      intentBridges: sessions.filter((session) => session.bridge?.intent).length,
      workspaceBridges: sessions.filter((session) => session.bridge?.workspace).length,
      threadAgents: sessions.filter((session) => session.threadBridge).length,
      archivedSessions: sessions.filter((session) => session.archivedAt).length,
      warningSessions: sessions.filter((session) => session.warning).length,
      providerSessions: Array.isArray(liveSessions) ? liveSessions.length : 0,
      liveError: liveError || null,
      sseSubscribers: subscriberCount,
      statusCounts,
      kindCounts,
    };
  }

  function controlBoardSignals(summary, configPayload) {
    const signals = [];
    signals.push(`${summary.activeRuns} active run(s), ${summary.runningSessions} running session(s), ${summary.sseSubscribers} browser stream subscriber(s).`);
    signals.push(`Warm bridge pool target ${configPayload.warmBridgePoolSize}; ${summary.readyBridges} idle bridge(s) ready, ${summary.launchingWarmBridges} warm launch(es) in flight.`);
    signals.push(`Runtime provider ${configPayload.provider}; Cloudflare broker ${configPayload.cloudflare.brokerConfigured ? 'configured' : 'missing'}, keep-alive ${configPayload.cloudflare.keepAlive ? 'on' : 'off'}.`);
    signals.push(configPayload.authRequired ? 'Owner gate: GitHub auth plus control-board allowlist or CONTROL_API_TOKEN.' : 'Owner gate: single-user/local backend; no hosted multi-user auth is enabled.');
    if (summary.warningSessions) signals.push(`${summary.warningSessions} session(s) currently carry warnings.`);
    if (summary.liveError) signals.push(`Provider live-list error: ${summary.liveError}`);
    return signals;
  }

  async function controlBoardPayload() {
    const storedSessions = await listStoredSessions(config.sessionFile);
    let liveSessions = [];
    let liveError = null;

    try {
      liveSessions = await provider.listSessions();
    } catch (error) {
      liveError = error.message;
    }

    const sessions = mergeSessions(storedSessions, liveSessions).map(controlBoardSession);
    const activeRunPayload = [...activeRuns.entries()].map(([name, run]) => controlBoardRun(name, run));
    const configPayload = controlBoardConfigPayload();
    const summary = controlBoardSummary(sessions, activeRunPayload, liveSessions, liveError);
    const memory = process.memoryUsage();

    return {
      generatedAt: new Date().toISOString(),
      provider: provider.info(),
      summary,
      signals: controlBoardSignals(summary, configPayload),
      config: configPayload,
      process: {
        pid: process.pid,
        uptimeMs: Math.round(process.uptime() * 1000),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memoryRssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
      },
      sessions,
      activeRuns: activeRunPayload,
    };
  }

  function performancePatchForSession(session, runStatus = session?.runStatus) {
    const performance = activeRuns.get(session.name)?.performance;
    const patch = performance ? { performance } : {};
    const status = String(runStatus || '').toLowerCase();

    if (isActiveRunStatus(status)) {
      return { ...activeRunResetPatch(), ...patch };
    }

    if (status === 'completed' || status === 'failed') {
      const previousTerminal = !isActiveRunStatus(session?.runStatus);
      const endedAt = performance?.endedAt || (previousTerminal ? session.endedAt : '') || new Date().toISOString();
      patch.endedAt = endedAt;
      patch.runEndedAtMs = performance?.runEndedAtMs || (previousTerminal ? session.runEndedAtMs : 0) || Date.parse(endedAt);
      patch.completedAt = status === 'completed'
        ? performance?.completedAt || (previousTerminal ? session.completedAt : '') || endedAt
        : undefined;
    }

    return patch;
  }

  async function persistRunStatus(session, runStatus) {
    const nextStatus = statusFromRunStatus(runStatus, session.status);
    const performancePatch = performancePatchForSession(session, runStatus);

    if (nextStatus === session.status && session.runStatus === runStatus && !Object.keys(performancePatch).length) {
      return session;
    }

    return upsertSession(config.sessionFile, {
      ...session,
      ...performancePatch,
      status: nextStatus,
      runStatus,
      updatedAt: new Date().toISOString(),
    });
  }

  function threadRunId(session, submittedAtMs = session?.submittedAtMs) {
    return String(session?.bridgeRunId || submittedAtMs || '');
  }

  function withUserThreadMessage(session, prompt, submittedAtMs, runId = threadRunId(session, submittedAtMs), images = []) {
    return {
      ...session,
      threadMessages: appendThreadMessages(session, [threadMessage('user', prompt, submittedAtMs, runId, images)]),
    };
  }

  function assistantTextFromRun(run) {
    return (run?.events || [])
      .filter((event) => event.type === 'chunk' && event.chunk)
      .map((event) => event.chunk)
      .join('')
      .trim();
  }

  function latestAssistantThreadMessage(session, runId = threadRunId(session)) {
    const messages = Array.isArray(session?.threadMessages) ? session.threadMessages : [];
    return [...messages].reverse().find((message) => (
      message?.role === 'assistant' &&
      String(message.text || '').trim() &&
      (!runId || message.runId === runId)
    )) || null;
  }

  function latestUserThreadMessage(session, runId = threadRunId(session)) {
    const messages = Array.isArray(session?.threadMessages) ? session.threadMessages : [];
    return [...messages].reverse().find((message) => (
      message?.role === 'user' &&
      String(message.text || '').trim() &&
      (!runId || message.runId === runId)
    )) || null;
  }

  function threadSummaryTimeoutMs() {
    const value = Number(config.threadSummaryTimeoutMs);
    return Number.isFinite(value) && value > 0 ? value : 15000;
  }

  function threadTurnStatusTimeoutMs() {
    const value = Number(config.threadTurnStatusTimeoutMs);
    return Number.isFinite(value) && value > 0 ? value : 15000;
  }

  function threadNextStepsTimeoutMs() {
    const value = Number(config.threadNextStepsTimeoutMs || config.threadSummaryTimeoutMs);
    return Number.isFinite(value) && value > 0 ? value : 15000;
  }

  function workspaceLaunchSuggestionsTimeoutMs() {
    const value = Number(config.workspaceLaunchSuggestionsTimeoutMs || config.threadNextStepsTimeoutMs || config.threadSummaryTimeoutMs);
    return Number.isFinite(value) && value > 0 ? value : 15000;
  }

  function enqueuePolishJob(job) {
    polishQueue.push(job);
    if (polishQueueRunning) return;
    polishQueueRunning = true;
    setTimeout(async () => {
      while (polishQueue.length) {
        const next = polishQueue.shift();
        try {
          await next();
        } catch (error) {
          console.warn(`[spanner] skipped polish job: ${error.message}`);
        }
        await sleep(250);
      }
      polishQueueRunning = false;
    }, 500).unref();
  }

  function scheduleFinalAnswerSummaryGeneration(session, finalOutput, runId = threadRunId(session)) {
    const modelRef = String(config.threadSummaryModel || config.threadTitleModel || '').trim();
    const key = `${session?.name || ''}:${runId || 'latest'}`;
    if (!session?.name || !String(finalOutput || '').trim() || !modelRef || modelRef.toLowerCase() === 'off') return;
    if (session.finalAnswerSummary && (!runId || session.finalAnswerSummaryRunId === runId)) return;
    if (finalAnswerSummaryRuns.has(key)) return;

    finalAnswerSummaryRuns.add(key);
    enqueuePolishJob(async () => {
      try {
        const summary = await generateFinalAnswerSummary(session, finalOutput, {
          loadPiSdk,
          loadPiAi,
          modelRef,
          authStorage: authStorageForSession ? await authStorageForSession(session) : null,
          signal: AbortSignal.timeout(threadSummaryTimeoutMs()),
        });
        if (!summary) return;

        const current = await getStoredSession(config.sessionFile, session.name);
        if (!current?.threadBridge) return;
        const currentRunId = threadRunId(current);
        if (runId && currentRunId && currentRunId !== runId) return;
        if (!latestAssistantThreadMessage(current, runId)) return;

        const updated = await upsertSession(config.sessionFile, {
          ...current,
          finalAnswerSummary: summary,
          finalAnswerSummaryRunId: runId || '',
          finalAnswerSummaryModel: modelRef,
          finalAnswerSummaryUpdatedAt: new Date().toISOString(),
        });
        recordRunEvent(session.name, {
          type: 'answer_summary',
          summary,
          runStatus: ensureRunState(session.name).runStatus,
          session: decorateLiveSession(updated),
        });
      } catch (error) {
        console.warn(`[spanner] skipped answer summary for ${session.name}: ${error.message}`);
      } finally {
        finalAnswerSummaryRuns.delete(key);
      }
    });
  }

  function scheduleFinalTurnStatusClassification(session, assistantMessage, runId = threadRunId(session)) {
    const modelRef = String(config.threadTurnStatusModel || config.threadSummaryModel || config.threadTitleModel || '').trim();
    const latestAssistantTurn = String(assistantMessage?.text || assistantMessage || '').trim();
    const key = `${session?.name || ''}:${runId || 'latest'}`;
    if (!session?.name || !latestAssistantTurn || !modelRef || modelRef.toLowerCase() === 'off') return;
    if (session.finalTurnStatus && (!runId || session.finalTurnStatusRunId === runId)) return;
    if (finalTurnStatusRuns.has(key)) return;

    finalTurnStatusRuns.add(key);
    enqueuePolishJob(async () => {
      try {
        const current = await getStoredSession(config.sessionFile, session.name);
        if (!current?.threadBridge) return;
        const currentRunId = threadRunId(current);
        if (runId && currentRunId && currentRunId !== runId) return;
        if (!latestAssistantThreadMessage(current, runId)) return;

        const previousUserTurn = latestUserThreadMessage(current, runId)?.text || current.taskPrompt || current.initialPrompt || '';
        const result = await generateFinalTurnStatus(previousUserTurn, latestAssistantTurn, {
          loadPiSdk,
          loadPiAi,
          modelRef,
          authStorage: authStorageForSession ? await authStorageForSession(current) : null,
          signal: AbortSignal.timeout(threadTurnStatusTimeoutMs()),
        });
        if (!result?.status) return;

        const updated = await upsertSession(config.sessionFile, {
          ...current,
          finalTurnStatus: result.status,
          finalTurnColor: result.color,
          finalTurnReason: result.reason,
          finalTurnStatusRunId: runId || '',
          finalTurnStatusModel: modelRef,
          finalTurnStatusUpdatedAt: new Date().toISOString(),
        });
        recordRunEvent(session.name, {
          type: 'turn_status',
          status: result.status,
          color: result.color,
          reason: result.reason,
          runStatus: ensureRunState(session.name).runStatus,
          session: decorateLiveSession(updated),
        });
      } catch (error) {
        console.warn(`[spanner] skipped turn status for ${session.name}: ${error.message}`);
      } finally {
        finalTurnStatusRuns.delete(key);
      }
    });
  }

  function scheduleSuggestedNextStepsGeneration(session, finalOutput, runId = threadRunId(session)) {
    const modelRef = String(config.threadNextStepsModel || config.threadSummaryModel || config.threadTitleModel || '').trim();
    const latestAssistantTurn = String(finalOutput || '').trim();
    const key = `${session?.name || ''}:${runId || 'latest'}`;
    if (!session?.name || !latestAssistantTurn || !modelRef || modelRef.toLowerCase() === 'off') return;
    if (Array.isArray(session.suggestedNextSteps) && session.suggestedNextSteps.length && (!runId || session.suggestedNextStepsRunId === runId)) return;
    if (suggestedNextStepRuns.has(key)) return;

    suggestedNextStepRuns.add(key);
    enqueuePolishJob(async () => {
      try {
        const current = await getStoredSession(config.sessionFile, session.name);
        if (!current?.threadBridge) return;
        const currentRunId = threadRunId(current);
        if (runId && currentRunId && currentRunId !== runId) return;
        if (!latestAssistantThreadMessage(current, runId)) return;

        const steps = await generateSuggestedNextSteps(current, latestAssistantTurn, {
          loadPiSdk,
          loadPiAi,
          modelRef,
          authStorage: authStorageForSession ? await authStorageForSession(current) : null,
          signal: AbortSignal.timeout(threadNextStepsTimeoutMs()),
        });
        if (!steps?.length) return;

        const updated = await upsertSession(config.sessionFile, {
          ...current,
          suggestedNextSteps: steps,
          suggestedNextStepsRunId: runId || '',
          suggestedNextStepsModel: modelRef,
          suggestedNextStepsUpdatedAt: new Date().toISOString(),
        });
        recordRunEvent(session.name, {
          type: 'suggested_next_steps',
          steps,
          runStatus: ensureRunState(session.name).runStatus,
          session: decorateLiveSession(updated),
        });
      } catch (error) {
        console.warn(`[spanner] skipped suggested next steps for ${session.name}: ${error.message}`);
      } finally {
        suggestedNextStepRuns.delete(key);
      }
    });
  }

  function cleanWorkspaceSuggestionValue(value, max = 500) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function workspaceSuggestionThread(thread = {}) {
    return {
      title: cleanWorkspaceSuggestionValue(thread.title || thread.name, 120),
      taskPrompt: cleanWorkspaceSuggestionValue(thread.taskPrompt, 700),
      initialPrompt: cleanWorkspaceSuggestionValue(thread.initialPrompt, 700),
      finalAnswerSummary: cleanWorkspaceSuggestionValue(thread.finalAnswerSummary, 700),
      finalTurnStatus: cleanWorkspaceSuggestionValue(thread.finalTurnStatus, 80),
      finalTurnReason: cleanWorkspaceSuggestionValue(thread.finalTurnReason, 220),
      status: cleanWorkspaceSuggestionValue(thread.status, 80),
      runStatus: cleanWorkspaceSuggestionValue(thread.runStatus, 80),
      warning: cleanWorkspaceSuggestionValue(thread.warning, 220),
      finishedAt: cleanWorkspaceSuggestionValue(thread.finishedAt || thread.endedAt || thread.updatedAt, 80),
    };
  }

  async function generateWorkspaceLaunchSuggestionsForThreads(threads = [], user = null) {
    const modelRef = String(config.workspaceLaunchSuggestionsModel || config.threadNextStepsModel || config.threadSummaryModel || config.threadTitleModel || '').trim();
    const source = (Array.isArray(threads) ? threads : []).slice(0, 6).map(workspaceSuggestionThread).filter((thread) => thread.title || thread.taskPrompt || thread.initialPrompt || thread.finalAnswerSummary);
    if (!source.length || !modelRef || modelRef.toLowerCase() === 'off') return [];

    const cacheKey = JSON.stringify([user?.id || '', modelRef, source]);
    const cached = workspaceLaunchSuggestionCache.get(cacheKey);
    if (cached && Date.now() - cached.updatedAt < WORKSPACE_SUGGESTION_CACHE_MS) return cached.steps;

    try {
      const steps = await generateWorkspaceLaunchSuggestions(source, {
        loadPiSdk,
        loadPiAi,
        modelRef,
        authStorage: authStorageForSession ? await authStorageForSession({ ownerUserId: user?.id || '' }) : null,
        signal: AbortSignal.timeout(workspaceLaunchSuggestionsTimeoutMs()),
      });
      workspaceLaunchSuggestionCache.set(cacheKey, { updatedAt: Date.now(), steps });
      if (workspaceLaunchSuggestionCache.size > 50) workspaceLaunchSuggestionCache.delete(workspaceLaunchSuggestionCache.keys().next().value);
      return steps;
    } catch (error) {
      console.warn(`[spanner] skipped workspace launch suggestions: ${error.message}`);
      return [];
    }
  }

  async function persistThreadAssistantMessage(sessionName) {
    const session = await getStoredSession(config.sessionFile, sessionName);
    if (!session?.threadBridge) return;

    const runId = threadRunId(session);
    const existingAssistant = latestAssistantThreadMessage(session, runId);
    if (existingAssistant) {
      scheduleFinalAnswerSummaryGeneration(session, existingAssistant.text, runId);
      scheduleFinalTurnStatusClassification(session, existingAssistant, runId);
      scheduleSuggestedNextStepsGeneration(session, existingAssistant.text, runId);
      return;
    }

    const text = assistantTextFromRun(activeRuns.get(sessionName));
    if (!text) return;

    const updated = await upsertSession(config.sessionFile, {
      ...session,
      threadMessages: appendThreadMessages(session, [threadMessage('assistant', text, Date.now(), runId)]),
      updatedAt: new Date().toISOString(),
    });
    scheduleFinalAnswerSummaryGeneration(updated, text, runId);
    scheduleFinalTurnStatusClassification(updated, { text }, runId);
    scheduleSuggestedNextStepsGeneration(updated, text, runId);
  }

  function withFallbackThreadTitle(session) {
    return session.title ? session : { ...session, title: fallbackThreadTitle(session), titleStatus: 'fallback' };
  }

  function threadTitleTimeoutMs() {
    const value = Number(config.threadTitleTimeoutMs);
    return Number.isFinite(value) && value > 0 ? value : 15000;
  }

  function scheduleThreadTitleGeneration(session) {
    const modelRef = String(config.threadTitleModel || '').trim();
    if (!session?.name || !modelRef || modelRef.toLowerCase() === 'off') return;

    enqueuePolishJob(async () => {
      try {
        const title = await generateThreadTitle(session, {
          loadPiSdk,
          loadPiAi,
          modelRef,
          authStorage: authStorageForSession ? await authStorageForSession(session) : null,
          signal: AbortSignal.timeout(threadTitleTimeoutMs()),
        });
        if (!title) return;

        const current = await getStoredSession(config.sessionFile, session.name);
        if (!current?.threadBridge) return;

        const updated = await upsertSession(config.sessionFile, {
          ...current,
          title,
          titleStatus: 'generated',
          titleModel: modelRef,
          titleUpdatedAt: new Date().toISOString(),
        });
        recordRunEvent(session.name, {
          type: 'title',
          title,
          runStatus: ensureRunState(session.name).runStatus,
          session: decorateLiveSession(updated),
        });
      } catch (error) {
        console.warn(`[spanner] skipped agent title for ${session.name}: ${error.message}`);
      }
    });
  }

  function persistHostDispatchMetric(sessionName, event) {
    const runStatus = event.runStatus || 'running';
    recordRunEvent(sessionName, {
      ...event,
      type: 'metric',
      runStatus,
      bridgeLatencyMs: null,
      latencyMs: event.latencyMs,
    });

    void upsertSession(config.sessionFile, {
      name: sessionName,
      status: 'running',
      runStatus: 'running',
      ...performancePatchForSession({ name: sessionName }, runStatus),
      ...(event.metric === 'first_llm_call_start' ? {
        firstLlmLatencyMs: event.latencyMs,
        firstLlmCallStartedAtMs: event.firstLlmCallStartedAtMs,
      } : {}),
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
        ...performancePatchForSession(current || { name: sessionName }, runStatus),
        status: statusFromRunStatus(runStatus, current?.status || 'unknown'),
        runStatus,
        warning: Object.prototype.hasOwnProperty.call(extra, 'warning') ? extra.warning : current?.warning || null,
        updatedAt: new Date().toISOString(),
      });
      if (runStatus === 'completed' || runStatus === 'failed') await persistThreadAssistantMessage(sessionName);
    })();
  }

  function isActiveRunStatus(runStatus) {
    return ['launching', 'queued', 'starting', 'running'].includes(String(runStatus || '').toLowerCase());
  }

  function sendSse(response, payload) {
    return response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  function subscriberPayload(subscriber, event) {
    const session = event.session || (subscriber.session ? decorateLiveSession(subscriber.session) : null);
    if (event.session) subscriber.session = event.session;
    return { ...event, session };
  }

  function closeRunSubscriber(subscriber) {
    if (subscriber.closed) return;
    subscriber.closed = true;
    clearInterval(subscriber.heartbeat);
    const subscribers = runSubscribers.get(subscriber.name);
    subscribers?.delete(subscriber);
    if (subscribers?.size === 0) runSubscribers.delete(subscriber.name);
    try { subscriber.response.end(); } catch {}
  }

  function flushRunSubscriber(subscriber) {
    if (subscriber.closed || subscriber.writing) return;
    subscriber.writing = true;

    const flush = async () => {
      while (!subscriber.closed && subscriber.queue.length) {
        const event = subscriber.queue.shift();
        const ok = sendSse(subscriber.response, subscriberPayload(subscriber, event));
        subscriber.lastId = Math.max(subscriber.lastId, Number(event.id) || 0);
        if (!ok) {
          await new Promise((resolve) => subscriber.response.once('drain', resolve));
        }
        if (event.done) closeRunSubscriber(subscriber);
      }
      subscriber.writing = false;
    };

    void flush().catch(() => closeRunSubscriber(subscriber));
  }

  function enqueueRunSubscriber(subscriber, event) {
    if (subscriber.closed || event.id <= subscriber.lastId) return;
    if (subscriber.queue.length > 250) {
      closeRunSubscriber(subscriber);
      return;
    }
    subscriber.queue.push({ ...event });
    flushRunSubscriber(subscriber);
  }

  function notifyRunSubscribers(name, event) {
    for (const subscriber of runSubscribers.get(name) || []) {
      enqueueRunSubscriber(subscriber, event);
    }
  }

  function addRunSubscriber(name, response, after, session) {
    const subscriber = {
      name,
      response,
      session,
      lastId: after,
      queue: [],
      writing: false,
      closed: false,
      heartbeat: setInterval(() => {
        if (!response.write(': ping\n\n')) closeRunSubscriber(subscriber);
      }, 25000),
    };
    subscriber.heartbeat.unref();

    if (!runSubscribers.has(name)) runSubscribers.set(name, new Set());
    runSubscribers.get(name).add(subscriber);
    return subscriber;
  }

  return {
    activeRuns,
    liveLocalRuns,
    MAX_CHANGE_FILES,
    ensureRunState,
    recordRunEvent,
    appendRunOutput,
    appendRunStatus,
    setRunState,
    resetRunState,
    latestRunActivity,
    mergeTrackedChanges,
    statusFromRunStatus,
    effectiveStoredRunStatus,
    isFinishedRunStatus,
    activeRunTerminalPatch,
    activeRunResetPatch,
    terminalStoredRunStatus,
    inactiveStoredRunStatus,
    decorateInactiveStoredSession,
    decorateLiveSession,
    mergeSessions,
    listSessionsPayload,
    controlBoardPayload,
    performancePatchForSession,
    persistRunStatus,
    threadRunId,
    withUserThreadMessage,
    assistantTextFromRun,
    latestAssistantThreadMessage,
    persistThreadAssistantMessage,
    withFallbackThreadTitle,
    scheduleThreadTitleGeneration,
    generateWorkspaceLaunchSuggestionsForThreads,
    persistHostDispatchMetric,
    persistHostDispatchStatus,
    isActiveRunStatus,
    sendSse,
    closeRunSubscriber,
    enqueueRunSubscriber,
    notifyRunSubscribers,
    addRunSubscriber,
    retainedOutputChunk,
  };
}
