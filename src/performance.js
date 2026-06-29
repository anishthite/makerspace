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

export function summarizeThreadPerformance(session, events = [], nowMs = Date.now()) {
  const liveEvents = Array.isArray(events) ? events : [];
  const detail = liveEvents.length ? eventSummary(liveEvents) : storedSummary(session);
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
    toolCalls: detail.toolCalls,
    toolErrors: detail.toolErrors,
    outputBytes: detail.outputBytes,
    warnings: detail.warnings,
    topTools: detail.topTools,
    inputTokens: detail.inputTokens,
    outputTokens: detail.outputTokens,
    cacheReadTokens: detail.cacheReadTokens,
    cacheWriteTokens: detail.cacheWriteTokens,
    totalTokens: detail.totalTokens,
    costUsd: detail.costUsd,
    modelCalls: detail.modelCalls,
    metricsSource: detail.metricsSource,
    hasDetailedMetrics: detail.hasDetailedMetrics,
    hasUsageMetrics: detail.hasUsageMetrics,
  };
  return { ...summary, flags: threadFlags(summary) };
}

export function summarizeThreadPerformanceList(sessions, eventsByName = {}, nowMs = Date.now()) {
  const threads = sessions.map((session) => summarizeThreadPerformance(session, eventsByName[session.name] || [], nowMs));
  const latencies = threads.map((thread) => thread.firstLlmLatencyMs).filter(Number.isFinite);
  const durations = threads.map((thread) => thread.durationMs).filter(Number.isFinite);
  const failedThreads = threads.filter((thread) => thread.status === 'failed').length;
  const runningThreads = threads.filter((thread) => ['launching', 'queued', 'starting', 'running'].includes(thread.status)).length;
  const unknownDetailThreads = threads.filter((thread) => !thread.hasDetailedMetrics).length;
  const unknownUsageThreads = threads.filter((thread) => !thread.hasUsageMetrics).length;
  const cacheBustThreads = threads.filter((thread) => thread.cacheWriteTokens).length;
  const slowThreads = threads.filter((thread) => thread.firstLlmLatencyMs > 30_000).length;
  const slowest = threads.filter((thread) => Number.isFinite(thread.firstLlmLatencyMs)).sort((left, right) => right.firstLlmLatencyMs - left.firstLlmLatencyMs)[0];
  const mostErrors = threads.filter((thread) => thread.toolErrors).sort((left, right) => right.toolErrors - left.toolErrors)[0];
  const insights = [];

  if (!threads.length) insights.push('No main agents yet.');
  if (failedThreads) insights.push(`${failedThreads} failed ${failedThreads === 1 ? 'main agent' : 'main agents'} need review.`);
  if (slowThreads) insights.push(`${slowThreads} ${slowThreads === 1 ? 'main agent has' : 'main agents have'} first LLM over 30s.`);
  if (slowest) insights.push(`Slowest first LLM: ${formatMs(slowest.firstLlmLatencyMs)} on ${slowest.title}.`);
  if (mostErrors) insights.push(`Most tool errors: ${mostErrors.toolErrors} on ${mostErrors.title}.`);
  if (cacheBustThreads) insights.push(`${cacheBustThreads} ${cacheBustThreads === 1 ? 'main agent wrote' : 'main agents wrote'} prompt cache.`);
  if (unknownDetailThreads) insights.push(`${unknownDetailThreads} historical ${unknownDetailThreads === 1 ? 'main agent has' : 'main agents have'} latency-only metrics.`);
  if (unknownUsageThreads) insights.push(`${unknownUsageThreads} ${unknownUsageThreads === 1 ? 'main agent has' : 'main agents have'} unknown token metrics.`);

  return {
    summary: {
      totalThreads: threads.length,
      failedThreads,
      runningThreads,
      detailedMetricThreads: threads.length - unknownDetailThreads,
      tokenMetricThreads: threads.length - unknownUsageThreads,
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
    },
    insights,
    threads: threads.sort((left, right) => (right.submittedAtMs || 0) - (left.submittedAtMs || 0)),
  };
}
