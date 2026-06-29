import { outputEventsFromText } from '../log-format.js';
import { applyPerformanceEvent } from '../performance.js';
import { appendRetainedOutput, retainedOutputChunk } from '../resource-utils.js';
import { appendThreadMessages, decorateSession, threadMessage } from '../session.js';
import { getStoredSession, listStoredSessions, upsertSession } from '../store.js';
import { fallbackThreadTitle, generateFinalAnswerSummary, generateThreadTitle } from '../thread-title.js';
import { sleep } from './utils.js';

export function createRunState({ config, provider, loadPiSdk, loadPiAi, canAccessSession }) {
  const activeRuns = new Map();
  const liveLocalRuns = new Set();
  const finalAnswerSummaryRuns = new Set();
  const runSubscribers = new Map();
  const polishQueue = [];
  let polishQueueRunning = false;
  const MAX_CHANGE_BYTES = 180_000;
  const MAX_CHANGE_FILES = 200;

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
    void persistTrackedChanges(name).catch((error) => console.warn(`[micro-cloud] failed to persist tracked changes for ${name}: ${error.message}`));
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
    return session?.localMode && isActiveRunStatus(effectiveStoredRunStatus(session)) ? 'failed' : '';
  }

  function decorateInactiveStoredSession(session) {
    const runStatus = inactiveStoredRunStatus(session);
    if (!runStatus) return session;

    const endedAt = session.endedAt || session.completedAt || session.updatedAt || session.createdAt;
    const runEndedAtMs = Number(session.runEndedAtMs) || Date.parse(endedAt || '');
    return {
      ...session,
      status: statusFromRunStatus(runStatus, session.status),
      runStatus,
      endedAt,
      runEndedAtMs: Number.isFinite(runEndedAtMs) ? runEndedAtMs : undefined,
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

  async function listSessionsPayload(viewerSessionId = '', trusted = false) {
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
        .filter((session) => canAccessSession(session, viewerSessionId, trusted))
        .map((session) => decorateLiveSession(session)),
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

  function withUserThreadMessage(session, prompt, submittedAtMs, runId = threadRunId(session, submittedAtMs)) {
    return {
      ...session,
      threadMessages: appendThreadMessages(session, [threadMessage('user', prompt, submittedAtMs, runId)]),
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

  function threadSummaryTimeoutMs() {
    const value = Number(config.threadSummaryTimeoutMs);
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
          console.warn(`[makerspace] skipped polish job: ${error.message}`);
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
        console.warn(`[makerspace] skipped answer summary for ${session.name}: ${error.message}`);
      } finally {
        finalAnswerSummaryRuns.delete(key);
      }
    });
  }

  async function persistThreadAssistantMessage(sessionName) {
    const session = await getStoredSession(config.sessionFile, sessionName);
    if (!session?.threadBridge) return;

    const runId = threadRunId(session);
    const existingAssistant = latestAssistantThreadMessage(session, runId);
    if (existingAssistant) {
      scheduleFinalAnswerSummaryGeneration(session, existingAssistant.text, runId);
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
        console.warn(`[makerspace] skipped agent title for ${session.name}: ${error.message}`);
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
    performancePatchForSession,
    persistRunStatus,
    threadRunId,
    withUserThreadMessage,
    assistantTextFromRun,
    latestAssistantThreadMessage,
    persistThreadAssistantMessage,
    withFallbackThreadTitle,
    scheduleThreadTitleGeneration,
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
