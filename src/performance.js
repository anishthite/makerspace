function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampMs(value) {
  const numeric = finiteNumber(value);
  if (numeric !== null) return numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
}

function repoLabel(session) {
  const text = String(session.repoPath || session.repoUrl || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/i, '');
  return text || 'repo';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(['launching', 'queued', 'starting', 'running']);
const SUCCESS_STATUSES = new Set(['completed', 'ready']);
const TERMINAL_STATUSES = new Set(['completed', 'ready', 'failed']);

function pct(count, total) {
  return total ? Math.round((count / total) * 100) : null;
}

function topCounts(values, limit = 3) {
  const counts = new Map();
  for (const value of values) {
    const key = String(value || '').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, limit);
}

function topToolCounts(threads, limit = 3) {
  const counts = new Map();
  for (const thread of threads) {
    for (const [name, count] of thread.topTools || []) {
      counts.set(name, (counts.get(name) || 0) + count);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, limit);
}

function effectiveStatus(session) {
  const runStatus = String(session.runStatus || '').toLowerCase();
  return runStatus && runStatus !== 'unknown' ? runStatus : String(session.status || 'unknown').toLowerCase();
}

function durationMs(session, status, nowMs) {
  const startedAt = timestampMs(session.submittedAtMs) || timestampMs(session.createdAt);
  if (!startedAt) return null;
  const finished = ['completed', 'failed', 'ready'].includes(status);
  const endedAt = finished
    ? timestampMs(session.runEndedAtMs)
      || timestampMs(session.performance?.runEndedAtMs)
      || timestampMs(session.endedAt)
      || timestampMs(session.completedAt)
      || timestampMs(session.updatedAt)
      || nowMs
    : nowMs;
  return endedAt && endedAt >= startedAt ? Math.round(endedAt - startedAt) : null;
}

function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function usageNumber(source, keys) {
  for (const key of keys) {
    const value = finiteNumber(source?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeUsage(usage = {}) {
  const inputTokens = usageNumber(usage, ['inputTokens', 'input', 'input_tokens']) ?? 0;
  const outputTokens = usageNumber(usage, ['outputTokens', 'output', 'output_tokens']) ?? 0;
  const cacheReadTokens = usageNumber(usage, ['cacheReadTokens', 'cacheRead', 'cache_read_input_tokens']) ?? 0;
  const cacheWriteTokens = usageNumber(usage, ['cacheWriteTokens', 'cacheWrite', 'cache_creation_input_tokens']) ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: usageNumber(usage, ['totalTokens', 'total_tokens', 'total']) ?? inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    costUsd: usageNumber(usage, ['costUsd', 'cost_usd']) ?? usageNumber(usage?.cost, ['total']) ?? 0,
  };
}

function hasStoredUsage(performance = {}) {
  return ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens', 'modelCalls', 'costUsd']
    .some((key) => finiteNumber(performance?.[key]) !== null);
}

function storedUsageCount(performance, key) {
  return hasStoredUsage(performance) ? finiteNumber(performance?.[key]) ?? 0 : null;
}

function normalizeTopTools(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const name = Array.isArray(entry) ? entry[0] : entry?.name;
      const count = finiteNumber(Array.isArray(entry) ? entry[1] : entry?.count);
      return name && count !== null ? [String(name), count] : null;
    })
    .filter(Boolean)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);
}

function incrementTopTool(topTools, name) {
  const counts = new Map(normalizeTopTools(topTools));
  counts.set(name, (counts.get(name) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3);
}

function storedCount(performance, key) {
  const value = finiteNumber(performance?.[key]);
  if (value !== null) return value;
  return performance?.hasDetailedMetrics ? 0 : null;
}

function hasStoredDetails(performance = {}) {
  return Boolean(performance.hasDetailedMetrics)
    || ['toolCalls', 'toolErrors', 'outputBytes', 'warnings'].some((key) => finiteNumber(performance[key]) !== null)
    || hasStoredUsage(performance)
    || normalizeTopTools(performance.topTools).length > 0;
}

export function applyPerformanceEvent(performance = {}, event = {}) {
  const current = performance || {};
  const next = {
    ...current,
    hasDetailedMetrics: true,
    toolCalls: finiteNumber(current.toolCalls) ?? 0,
    toolErrors: finiteNumber(current.toolErrors) ?? 0,
    outputBytes: finiteNumber(current.outputBytes) ?? 0,
    warnings: finiteNumber(current.warnings) ?? 0,
    topTools: normalizeTopTools(current.topTools),
  };

  if (event.timestamp) next.lastEventAt = event.timestamp;

  if (event.type === 'metric' && event.metric === 'first_llm_call_start') {
    const latencyMs = finiteNumber(event.latencyMs);
    if (latencyMs !== null) next.firstLlmLatencyMs = latencyMs;
  }

  if (event.type === 'tool') {
    const name = String(event.toolName || event.label || 'tool');
    if (event.phase === 'start') {
      next.toolCalls += 1;
      next.topTools = incrementTopTool(next.topTools, name);
    }
    if (event.isError) next.toolErrors += 1;
  }

  if (event.chunk) next.outputBytes += byteLength(event.chunk);
  if (event.warning) next.warnings += 1;

  if (event.type === 'usage') {
    const usage = normalizeUsage(event.usage || event);
    next.inputTokens = (finiteNumber(current.inputTokens) ?? 0) + usage.inputTokens;
    next.outputTokens = (finiteNumber(current.outputTokens) ?? 0) + usage.outputTokens;
    next.cacheReadTokens = (finiteNumber(current.cacheReadTokens) ?? 0) + usage.cacheReadTokens;
    next.cacheWriteTokens = (finiteNumber(current.cacheWriteTokens) ?? 0) + usage.cacheWriteTokens;
    next.totalTokens = (finiteNumber(current.totalTokens) ?? 0) + usage.totalTokens;
    next.costUsd = (finiteNumber(current.costUsd) ?? 0) + usage.costUsd;
    next.modelCalls = (finiteNumber(current.modelCalls) ?? 0) + (finiteNumber(event.modelCalls) ?? 1);
    next.hasUsageMetrics = true;
  }

  const runStatus = String(event.runStatus || '').toLowerCase();
  if (event.done || runStatus === 'completed' || runStatus === 'failed') {
    const endedAt = event.timestamp || next.endedAt;
    if (endedAt) {
      next.endedAt = endedAt;
      next.runEndedAtMs = timestampMs(endedAt);
    }
    if (runStatus === 'completed' && endedAt) next.completedAt = endedAt;
  }

  return next;
}

function eventSummary(events) {
  const starts = new Set();
  const ends = new Set();
  const errors = new Set();
  const toolNames = new Map();
  let firstLlmLatencyMs = null;
  let outputBytes = 0;
  let warnings = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let modelCalls = 0;

  events.forEach((event, index) => {
    if (event?.type === 'metric' && event.metric === 'first_llm_call_start') {
      firstLlmLatencyMs = finiteNumber(event.latencyMs) ?? firstLlmLatencyMs;
    }

    if (event?.type === 'tool') {
      const key = String(event.toolCallId || event.id || `${event.toolName || event.label || 'tool'}-${index}`);
      const name = String(event.toolName || event.label || 'tool');
      if (event.phase === 'start') {
        starts.add(key);
        toolNames.set(name, (toolNames.get(name) || 0) + 1);
      }
      if (event.phase === 'end') ends.add(key);
      if (event.isError) errors.add(key);
    }

    if (event?.chunk) outputBytes += byteLength(event.chunk);
    if (event?.warning) warnings += 1;

    if (event?.type === 'usage') {
      const usage = normalizeUsage(event.usage || event);
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      cacheReadTokens += usage.cacheReadTokens;
      cacheWriteTokens += usage.cacheWriteTokens;
      totalTokens += usage.totalTokens;
      costUsd += usage.costUsd;
      modelCalls += finiteNumber(event.modelCalls) ?? 1;
    }
  });

  return {
    firstLlmLatencyMs,
    outputBytes,
    warnings,
    toolCalls: Math.max(starts.size, ends.size),
    toolErrors: errors.size,
    topTools: [...toolNames.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3),
    inputTokens: modelCalls ? inputTokens : null,
    outputTokens: modelCalls ? outputTokens : null,
    cacheReadTokens: modelCalls ? cacheReadTokens : null,
    cacheWriteTokens: modelCalls ? cacheWriteTokens : null,
    totalTokens: modelCalls ? totalTokens : null,
    costUsd: modelCalls ? costUsd : null,
    modelCalls: modelCalls || null,
    hasUsageMetrics: modelCalls > 0,
    hasDetailedMetrics: true,
    metricsSource: 'live',
  };
}

function storedSummary(session) {
  const performance = session.performance || {};
  const hasDetails = hasStoredDetails(performance);
  const hasUsage = hasStoredUsage(performance);
  return {
    firstLlmLatencyMs: finiteNumber(performance.firstLlmLatencyMs) ?? finiteNumber(session.firstLlmLatencyMs),
    outputBytes: hasDetails ? storedCount(performance, 'outputBytes') : null,
    warnings: hasDetails ? storedCount(performance, 'warnings') : null,
    toolCalls: hasDetails ? storedCount(performance, 'toolCalls') : null,
    toolErrors: hasDetails ? storedCount(performance, 'toolErrors') : null,
    topTools: normalizeTopTools(performance.topTools),
    inputTokens: storedUsageCount(performance, 'inputTokens'),
    outputTokens: storedUsageCount(performance, 'outputTokens'),
    cacheReadTokens: storedUsageCount(performance, 'cacheReadTokens'),
    cacheWriteTokens: storedUsageCount(performance, 'cacheWriteTokens'),
    totalTokens: storedUsageCount(performance, 'totalTokens'),
    costUsd: storedUsageCount(performance, 'costUsd'),
    modelCalls: storedUsageCount(performance, 'modelCalls'),
    hasUsageMetrics: hasUsage,
    hasDetailedMetrics: hasDetails,
    metricsSource: hasDetails ? 'stored' : 'latency-only',
  };
}

function threadFlags(thread) {
  const flags = [];
  if (thread.status === 'failed') flags.push('failed');
  if (thread.firstLlmLatencyMs > 30_000) flags.push('slow first LLM');
  if (thread.durationMs > 10 * 60_000) flags.push('long run');
  if (thread.toolErrors) flags.push('tool errors');
  if (thread.cacheWriteTokens) flags.push('cache bust');
  if (thread.analysisScore >= 20) flags.push('review-worthy');
  if (thread.analysisSignals?.includes('verification_missing')) flags.push('missing verification');
  if (thread.archivedAt) flags.push('archived');
  return flags;
}

function formatMs(value) {
  if (!Number.isFinite(value)) return 'unknown';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value / 60_000)}m`;
}

function sumKnown(threads, key) {
  let total = 0;
  let known = false;
  for (const thread of threads) {
    if (!Number.isFinite(thread[key])) continue;
    total += thread[key];
    known = true;
  }
  return known ? total : null;
}

function pairSummary(pairs) {
  return pairs.map(([label, count]) => `${label}×${count}`).join(', ');
}

const CORRECTION_RE = /\b(no(t)?( that)?|wrong|you forgot|actually|fix(?:\b|ed)|i said|that('?s| is) (not|wrong)|incorrect|stop|don'?t|undo)\b/i;
const HIGH_TRACE_COST_USD = 1;
const BRANCH_HEAVY_THRESHOLD = 5;
const COMPACTION_HEAVY_THRESHOLD = 2;
const HUGE_OUTPUT_BYTES = 50 * 1024;
const LONG_NO_TOOL_STRETCH = 3;

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (part?.type === 'text') return part.text || '';
    if (part?.type === 'thinking') return part.thinking || '';
    return '';
  }).filter(Boolean).join('\n');
}

function parseToolArgs(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function assistantToolCalls(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part?.type === 'toolCall')
    .map((part) => ({ id: part.id || '', name: String(part.name || 'tool'), arguments: parseToolArgs(part.arguments) }));
}

function countMapEntries(map, limit = 3) {
  return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, limit);
}

function addCount(map, key, count = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + count);
}

function commandFromToolCall(toolCall) {
  const name = String(toolCall?.name || '').toLowerCase();
  if (name !== 'bash' && name !== 'shell') return '';
  return String(toolCall.arguments?.command || toolCall.arguments?.cmd || '').trim();
}

export function analyzePiTraceText(text = '') {
  if (!String(text || '').trim()) return null;

  const lines = String(text).split('\n');
  const models = new Set();
  const toolCounts = new Map();
  const toolCallById = new Map();
  const failedCommands = new Map();
  const signalCounts = new Map();
  const childrenById = new Map();
  const signals = [];
  let sessionMeta = null;
  let parseErrorCount = 0;
  let entryCount = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolCallCount = 0;
  let failedToolCallCount = 0;
  let bashCommandCount = 0;
  let failedBashCommandCount = 0;
  let compactionCount = 0;
  let modelSwitchCount = 0;
  let thinkingLevelSwitchCount = 0;
  let customCount = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;
  let assistantNoToolStretch = 0;
  let looksImplementation = false;
  let verified = false;
  let startedAt = null;
  let endedAt = null;
  let firstPrompt = '';

  function signal(kind, msg) {
    signals.push({ kind, msg });
    addCount(signalCounts, kind);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      parseErrorCount += 1;
      continue;
    }

    if (raw.type === 'session') {
      sessionMeta = raw;
      startedAt ||= raw.timestamp || null;
      continue;
    }

    entryCount += 1;
    if (raw.timestamp) endedAt = raw.timestamp;
    if (raw.id && raw.parentId) {
      if (!childrenById.has(raw.parentId)) childrenById.set(raw.parentId, []);
      childrenById.get(raw.parentId).push(raw.id);
    }

    if (raw.type === 'model_change') {
      modelSwitchCount += 1;
      if (raw.modelId) models.add(raw.provider ? `${raw.provider}/${raw.modelId}` : raw.modelId);
      continue;
    }
    if (raw.type === 'thinking_level_change') {
      thinkingLevelSwitchCount += 1;
      continue;
    }
    if (raw.type === 'compaction') {
      compactionCount += 1;
      continue;
    }
    if (raw.type === 'custom' || raw.type === 'custom_message') {
      customCount += 1;
      continue;
    }
    if (raw.type !== 'message') continue;

    const message = raw.message || {};
    const role = message.role;
    if (role === 'user') {
      userMessageCount += 1;
      const textBody = contentText(message.content);
      if (!firstPrompt && textBody) firstPrompt = textBody.slice(0, 240);
      if (textBody && CORRECTION_RE.test(textBody)) signal('user_correction', `User correction: ${textBody.slice(0, 120)}`);
      continue;
    }

    if (role === 'assistant') {
      assistantMessageCount += 1;
      const toolCalls = assistantToolCalls(message.content);
      toolCallCount += toolCalls.length;
      for (const toolCall of toolCalls) {
        addCount(toolCounts, toolCall.name);
        if (toolCall.id) toolCallById.set(toolCall.id, toolCall);
        if (/^(write|edit|multiedit)$/i.test(toolCall.name)) looksImplementation = true;
        const command = commandFromToolCall(toolCall);
        if (command) {
          if (/\b(node|tsc|npm|pnpm|yarn|bun|cargo|go |python|pytest|jest|vitest|make)\b/.test(command)) looksImplementation = true;
          if (/\b(test|lint|build|tsc|pytest|vitest|jest|cargo (test|check)|go test|npm test|pnpm test)\b/.test(command)) verified = true;
        }
      }
      if (toolCalls.length === 0) {
        assistantNoToolStretch += 1;
        if (assistantNoToolStretch === LONG_NO_TOOL_STRETCH) signal('long_no_tool_stretch', `≥${LONG_NO_TOOL_STRETCH} assistant messages without tool use`);
      } else {
        assistantNoToolStretch = 0;
      }
      const usage = message.usage ? normalizeUsage(message.usage) : null;
      if (usage) {
        totalTokens += usage.totalTokens;
        totalCostUsd += usage.costUsd;
      }
      if (message.model) models.add(message.provider ? `${message.provider}/${message.model}` : message.model);
      if (['error', 'aborted', 'refusal'].includes(String(message.stopReason || '').toLowerCase())) {
        signal('aborted_assistant', `Assistant stopReason=${message.stopReason}`);
      }
      continue;
    }

    if (role === 'toolResult') {
      const planned = toolCallById.get(message.toolCallId) || null;
      const toolName = String(message.toolName || planned?.name || 'tool');
      if (!planned) addCount(toolCounts, toolName);
      if (message.isError) {
        failedToolCallCount += 1;
        signal('failed_tool', `Tool ${toolName} returned error`);
        const command = commandFromToolCall(planned);
        if (command) {
          failedBashCommandCount += 1;
          signal('failed_bash', `bash failed: ${command.slice(0, 80)}`);
          addCount(failedCommands, command.replace(/\s+/g, ' ').trim());
        }
      }
      const outputBytes = byteLength(contentText(message.content));
      if (outputBytes > HUGE_OUTPUT_BYTES) signal('huge_output', `Tool output ${outputBytes}B`);
      if (message.truncated) signal('truncated_output', 'Tool result truncated');
      continue;
    }

    if (role === 'bashExecution') {
      bashCommandCount += 1;
      const command = String(message.command || '').trim();
      if (/\b(node|tsc|npm|pnpm|yarn|bun|cargo|go |python|pytest|jest|vitest|make)\b/.test(command)) looksImplementation = true;
      if (/\b(test|lint|build|tsc|pytest|vitest|jest|cargo (test|check)|go test|npm test|pnpm test)\b/.test(command)) verified = true;
      if (Number.isFinite(message.exitCode) && message.exitCode !== 0) {
        failedBashCommandCount += 1;
        signal('failed_bash', `bash exit ${message.exitCode}: ${command.slice(0, 80)}`);
        addCount(failedCommands, command.replace(/\s+/g, ' ').trim());
      }
    }
  }

  let branchCount = 0;
  for (const children of childrenById.values()) if (children.length > 1) branchCount += 1;
  for (const [command, count] of failedCommands.entries()) {
    if (count >= 2) signal('repeated_failed_command', `Failed ${count}×: ${command.slice(0, 80)}`);
  }
  if (totalCostUsd > HIGH_TRACE_COST_USD) signal('high_cost', `Session cost $${totalCostUsd.toFixed(3)}`);
  if (branchCount >= BRANCH_HEAVY_THRESHOLD) signal('branch_heavy', `${branchCount} branches`);
  if (compactionCount >= COMPACTION_HEAVY_THRESHOLD) signal('compaction_heavy', `${compactionCount} compactions`);
  if (looksImplementation && !verified) signal('verification_missing', 'Implementation-shaped session without verification command');

  const reviewScore = failedToolCallCount * 4
    + failedBashCommandCount * 6
    + branchCount * 5
    + compactionCount * 3
    + Math.min(40, Math.floor(totalCostUsd * 100))
    + parseErrorCount * 10
    + (entryCount > 500 ? 5 : 0);
  const startedMs = timestampMs(startedAt || sessionMeta?.timestamp);
  const endedMs = timestampMs(endedAt);
  const signalEntries = countMapEntries(signalCounts, 20);

  return {
    available: true,
    fileSessionId: sessionMeta?.id || '',
    startedAt: startedAt || sessionMeta?.timestamp || null,
    endedAt,
    durationMs: startedMs && endedMs && endedMs >= startedMs ? endedMs - startedMs : null,
    firstPrompt,
    entryCount,
    parseErrorCount,
    userMessageCount,
    assistantMessageCount,
    toolCallCount,
    failedToolCallCount,
    bashCommandCount,
    failedBashCommandCount,
    branchCount,
    compactionCount,
    modelSwitchCount,
    thinkingLevelSwitchCount,
    customCount,
    totalTokens,
    totalCostUsd,
    models: [...models],
    topTools: countMapEntries(toolCounts),
    signalCounts: Object.fromEntries(signalEntries),
    signalKinds: signalEntries.map(([kind]) => kind),
    signals: signals.slice(0, 5),
    reviewScore,
  };
}

function traceNumber(trace, key, fallback = null) {
  const value = finiteNumber(trace?.[key]);
  return value !== null ? value : fallback;
}

export function summarizeThreadPerformance(session, events = [], nowMs = Date.now(), traceAnalysis = null) {
  const liveEvents = Array.isArray(events) ? events : [];
  const detail = liveEvents.length ? eventSummary(liveEvents) : storedSummary(session);
  const trace = traceAnalysis?.available ? traceAnalysis : null;
  const status = effectiveStatus(session);
  const firstLlmLatencyMs = detail.firstLlmLatencyMs ?? finiteNumber(session.firstLlmLatencyMs);
  const summary = {
    name: session.name,
    title: session.title || session.name,
    repo: repoLabel(session),
    branch: session.branch || '',
    status,
    archivedAt: session.archivedAt || null,
    submittedAtMs: timestampMs(session.submittedAtMs) || timestampMs(session.createdAt),
    updatedAt: session.updatedAt || session.createdAt || '',
    endedAt: session.endedAt || session.completedAt || null,
    runEndedAtMs: finiteNumber(session.runEndedAtMs) ?? finiteNumber(session.performance?.runEndedAtMs),
    durationMs: durationMs(session, status, nowMs),
    firstLlmLatencyMs,
    toolCalls: traceNumber(trace, 'toolCallCount', detail.toolCalls),
    toolErrors: traceNumber(trace, 'failedToolCallCount', detail.toolErrors),
    outputBytes: detail.outputBytes,
    warnings: detail.warnings,
    topTools: trace?.topTools?.length ? trace.topTools : detail.topTools,
    inputTokens: detail.inputTokens,
    outputTokens: detail.outputTokens,
    cacheReadTokens: detail.cacheReadTokens,
    cacheWriteTokens: detail.cacheWriteTokens,
    totalTokens: traceNumber(trace, 'totalTokens', detail.totalTokens),
    costUsd: traceNumber(trace, 'totalCostUsd', detail.costUsd),
    modelCalls: detail.modelCalls,
    modelRef: session.modelRef || trace?.models?.[0] || '',
    thinkingLevel: session.thinkingLevel || '',
    metricsSource: trace ? 'trace' : detail.metricsSource,
    hasDetailedMetrics: detail.hasDetailedMetrics || Boolean(trace),
    hasUsageMetrics: detail.hasUsageMetrics || Number.isFinite(trace?.totalTokens),
    traceAnalysis: trace,
    analysisScore: traceNumber(trace, 'reviewScore'),
    analysisSignals: trace?.signalKinds || [],
    analysisSignalCounts: trace?.signalCounts || {},
    traceEntryCount: traceNumber(trace, 'entryCount'),
  };
  return { ...summary, flags: threadFlags(summary) };
}

export function summarizeThreadPerformanceList(sessions, eventsByName = {}, nowMs = Date.now(), traceByName = {}) {
  const threads = sessions.map((session) => summarizeThreadPerformance(session, eventsByName[session.name] || [], nowMs, traceByName[session.name] || null));
  const latencies = threads.map((thread) => thread.firstLlmLatencyMs).filter(Number.isFinite);
  const durations = threads.map((thread) => thread.durationMs).filter(Number.isFinite);
  const completedThreads = threads.filter((thread) => SUCCESS_STATUSES.has(thread.status)).length;
  const failedThreads = threads.filter((thread) => thread.status === 'failed').length;
  const terminalThreads = threads.filter((thread) => TERMINAL_STATUSES.has(thread.status)).length;
  const runningThreads = threads.filter((thread) => ACTIVE_STATUSES.has(thread.status)).length;
  const archivedThreads = threads.filter((thread) => thread.archivedAt).length;
  const ageMs = (thread) => nowMs - thread.submittedAtMs;
  const recent24hThreads = threads.filter((thread) => Number.isFinite(thread.submittedAtMs) && ageMs(thread) >= 0 && ageMs(thread) <= DAY_MS).length;
  const recent7dThreads = threads.filter((thread) => Number.isFinite(thread.submittedAtMs) && ageMs(thread) >= 0 && ageMs(thread) <= 7 * DAY_MS).length;
  const unknownDetailThreads = threads.filter((thread) => !thread.hasDetailedMetrics).length;
  const unknownUsageThreads = threads.filter((thread) => !thread.hasUsageMetrics).length;
  const cacheBustThreads = threads.filter((thread) => thread.cacheWriteTokens).length;
  const slowThreads = threads.filter((thread) => thread.firstLlmLatencyMs > 30_000).length;
  const slowest = threads.filter((thread) => Number.isFinite(thread.firstLlmLatencyMs)).sort((left, right) => right.firstLlmLatencyMs - left.firstLlmLatencyMs)[0];
  const mostErrors = threads.filter((thread) => thread.toolErrors).sort((left, right) => right.toolErrors - left.toolErrors)[0];
  const topRepos = topCounts(threads.map((thread) => thread.repo));
  const topModels = topCounts(threads.map((thread) => thread.modelRef));
  const topTools = topToolCounts(threads);
  const traceAnalyzedThreads = threads.filter((thread) => thread.traceAnalysis).length;
  const signalTotals = new Map();
  for (const thread of threads) {
    for (const [kind, count] of Object.entries(thread.analysisSignalCounts || {})) addCount(signalTotals, kind, count);
  }
  const topSignalKinds = countMapEntries(signalTotals, 8);
  const reviewQueue = threads
    .filter((thread) => Number.isFinite(thread.analysisScore) && thread.analysisScore > 0)
    .sort((left, right) => right.analysisScore - left.analysisScore || (right.submittedAtMs || 0) - (left.submittedAtMs || 0))
    .slice(0, 5)
    .map((thread) => ({ name: thread.name, title: thread.title, repo: thread.repo, score: thread.analysisScore, signals: thread.analysisSignals.slice(0, 4) }));
  const insights = [];

  if (!threads.length) insights.push('No main agents yet.');
  if (failedThreads) insights.push(`${failedThreads} failed ${failedThreads === 1 ? 'main agent' : 'main agents'} need review.`);
  if (slowThreads) insights.push(`${slowThreads} ${slowThreads === 1 ? 'main agent has' : 'main agents have'} first LLM over 30s.`);
  if (slowest) insights.push(`Slowest first LLM: ${formatMs(slowest.firstLlmLatencyMs)} on ${slowest.title}.`);
  if (mostErrors) insights.push(`Most tool errors: ${mostErrors.toolErrors} on ${mostErrors.title}.`);
  if (cacheBustThreads) insights.push(`${cacheBustThreads} ${cacheBustThreads === 1 ? 'main agent wrote' : 'main agents wrote'} prompt cache.`);
  if (traceAnalyzedThreads) insights.push(`${traceAnalyzedThreads} ${traceAnalyzedThreads === 1 ? 'thread has' : 'threads have'} Pi trace analysis.`);
  if (reviewQueue[0]) insights.push(`Most review-worthy: ${reviewQueue[0].title} (score ${reviewQueue[0].score}).`);
  if (topSignalKinds.length) insights.push(`Top lookback signals: ${pairSummary(topSignalKinds.slice(0, 3))}.`);
  if (topRepos.length) insights.push(`Most-used repo: ${pairSummary(topRepos.slice(0, 1))}.`);
  if (topTools.length) insights.push(`Top tools: ${pairSummary(topTools)}.`);
  if (unknownDetailThreads) insights.push(`${unknownDetailThreads} historical ${unknownDetailThreads === 1 ? 'main agent has' : 'main agents have'} latency-only metrics.`);
  if (unknownUsageThreads) insights.push(`${unknownUsageThreads} ${unknownUsageThreads === 1 ? 'main agent has' : 'main agents have'} unknown token metrics.`);

  return {
    summary: {
      totalThreads: threads.length,
      completedThreads,
      failedThreads,
      terminalThreads,
      runningThreads,
      archivedThreads,
      recent24hThreads,
      recent7dThreads,
      successRatePct: pct(completedThreads, terminalThreads),
      detailedMetricThreads: threads.length - unknownDetailThreads,
      tokenMetricThreads: threads.length - unknownUsageThreads,
      detailedMetricPct: pct(threads.length - unknownDetailThreads, threads.length),
      tokenMetricPct: pct(threads.length - unknownUsageThreads, threads.length),
      medianFirstLlmMs: percentile(latencies, 50),
      p95FirstLlmMs: percentile(latencies, 95),
      medianDurationMs: percentile(durations, 50),
      totalToolCalls: sumKnown(threads, 'toolCalls'),
      totalToolErrors: sumKnown(threads, 'toolErrors'),
      totalModelCalls: sumKnown(threads, 'modelCalls'),
      totalTokens: sumKnown(threads, 'totalTokens'),
      totalInputTokens: sumKnown(threads, 'inputTokens'),
      totalOutputTokens: sumKnown(threads, 'outputTokens'),
      totalCacheReadTokens: sumKnown(threads, 'cacheReadTokens'),
      totalCacheWriteTokens: sumKnown(threads, 'cacheWriteTokens'),
      totalCostUsd: sumKnown(threads, 'costUsd'),
      totalOutputBytes: sumKnown(threads, 'outputBytes'),
      totalWarnings: sumKnown(threads, 'warnings'),
      traceAnalyzedThreads,
      traceCoveragePct: pct(traceAnalyzedThreads, threads.length),
      totalTraceEntries: sumKnown(threads, 'traceEntryCount'),
      totalReviewScore: sumKnown(threads, 'analysisScore'),
      topSignalKinds,
      reviewQueue,
      topRepos,
      topTools,
      topModels,
    },
    insights,
    threads: threads.sort((left, right) => (right.submittedAtMs || 0) - (left.submittedAtMs || 0)),
  };
}
