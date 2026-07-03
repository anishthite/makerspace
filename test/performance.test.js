import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzePiTraceText, applyPerformanceEvent, summarizeThreadPerformance, summarizeThreadPerformanceList } from '../src/performance.js';

test('summarizes live thread performance events', () => {
  const thread = summarizeThreadPerformance(
    {
      name: 'demo',
      repoUrl: 'https://github.com/acme/demo.git',
      branch: 'main',
      runStatus: 'ready',
      submittedAtMs: 1000,
      updatedAt: new Date(61_000).toISOString(),
      firstLlmLatencyMs: 12_000,
    },
    [
      { type: 'metric', metric: 'first_llm_call_start', latencyMs: 5000 },
      { type: 'tool', phase: 'start', toolCallId: '1', toolName: 'bash' },
      { type: 'tool', phase: 'end', toolCallId: '1', toolName: 'bash', isError: true },
      { type: 'chunk', chunk: 'hello' },
      { type: 'usage', usage: { input: 1000, output: 200, cacheRead: 300, cacheWrite: 400, cost: { total: 0.01 } } },
    ],
    70_000,
  );

  assert.equal(thread.repo, 'acme/demo');
  assert.equal(thread.durationMs, 60_000);
  assert.equal(thread.firstLlmLatencyMs, 5000);
  assert.equal(thread.toolCalls, 1);
  assert.equal(thread.toolErrors, 1);
  assert.equal(thread.outputBytes, 5);
  assert.equal(thread.totalTokens, 1900);
  assert.equal(thread.cacheWriteTokens, 400);
  assert.equal(thread.costUsd, 0.01);
  assert.deepEqual(thread.flags, ['tool errors', 'cache bust']);
});

test('uses stored performance rollups when live events are gone', () => {
  const thread = summarizeThreadPerformance(
    {
      name: 'stored',
      runStatus: 'completed',
      submittedAtMs: 1000,
      updatedAt: new Date(99_000).toISOString(),
      runEndedAtMs: 11_000,
      firstLlmLatencyMs: 7000,
      performance: {
        hasDetailedMetrics: true,
        toolCalls: 2,
        toolErrors: 1,
        outputBytes: 42,
        warnings: 1,
        topTools: [['bash', 2]],
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 25,
        cacheWriteTokens: 10,
        totalTokens: 185,
        modelCalls: 1,
      },
    },
    [],
    100_000,
  );

  assert.equal(thread.metricsSource, 'stored');
  assert.equal(thread.durationMs, 10_000);
  assert.equal(thread.toolCalls, 2);
  assert.equal(thread.toolErrors, 1);
  assert.equal(thread.outputBytes, 42);
  assert.equal(thread.totalTokens, 185);
  assert.equal(thread.cacheReadTokens, 25);
  assert.equal(thread.cacheWriteTokens, 10);
  assert.deepEqual(thread.topTools, [['bash', 2]]);
});

test('marks missing historical detail as unknown', () => {
  const thread = summarizeThreadPerformance(
    {
      name: 'old',
      runStatus: 'ready',
      submittedAtMs: 1000,
      updatedAt: new Date(11_000).toISOString(),
      firstLlmLatencyMs: 7000,
    },
    [],
    100_000,
  );

  assert.equal(thread.metricsSource, 'latency-only');
  assert.equal(thread.hasDetailedMetrics, false);
  assert.equal(thread.toolCalls, null);
  assert.equal(thread.toolErrors, null);
});

test('rollup accepts null initial performance state', () => {
  const performance = applyPerformanceEvent(null, {
    type: 'tool',
    phase: 'start',
    toolName: 'bash',
  });

  assert.equal(performance.toolCalls, 1);
  assert.deepEqual(performance.topTools, [['bash', 1]]);
});

test('rollup keeps first llm latency metric-specific', () => {
  let performance = applyPerformanceEvent({}, {
    type: 'metric',
    metric: 'first_llm_call_start',
    latencyMs: 100,
    timestamp: new Date(1000).toISOString(),
  });
  performance = applyPerformanceEvent(performance, {
    type: 'metric',
    metric: 'later_metric',
    latencyMs: 999,
    timestamp: new Date(2000).toISOString(),
  });
  performance = applyPerformanceEvent(performance, {
    type: 'tool',
    phase: 'start',
    toolCallId: '1',
    toolName: 'bash',
  });
  performance = applyPerformanceEvent(performance, {
    type: 'tool',
    phase: 'end',
    toolCallId: '1',
    toolName: 'bash',
    isError: true,
  });
  performance = applyPerformanceEvent(performance, {
    type: 'chunk',
    chunk: 'é',
  });
  performance = applyPerformanceEvent(performance, {
    type: 'usage',
    usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, cost: { total: 0.002 } },
  });
  performance = applyPerformanceEvent(performance, {
    type: 'status',
    runStatus: 'completed',
    timestamp: new Date(3000).toISOString(),
    done: true,
  });

  assert.equal(performance.firstLlmLatencyMs, 100);
  assert.equal(performance.toolCalls, 1);
  assert.equal(performance.toolErrors, 1);
  assert.equal(performance.outputBytes, 2);
  assert.equal(performance.totalTokens, 20);
  assert.equal(performance.cacheWriteTokens, 2);
  assert.equal(performance.costUsd, 0.002);
  assert.equal(performance.runEndedAtMs, 3000);
  assert.deepEqual(performance.topTools, [['bash', 1]]);
});

test('analyzes Pi JSONL traces for lookback signals', () => {
  const trace = analyzePiTraceText([
    JSON.stringify({ type: 'session', id: 'demo', timestamp: new Date(1000).toISOString() }),
    JSON.stringify({ type: 'message', id: 'u1', timestamp: new Date(1000).toISOString(), message: { role: 'user', content: [{ type: 'text', text: 'fix the app' }] } }),
    JSON.stringify({ type: 'message', id: 'a1', parentId: 'u1', timestamp: new Date(2000).toISOString(), message: { role: 'assistant', content: [{ type: 'toolCall', name: 'edit', arguments: { path: 'app.js' } }], usage: { input: 10, output: 5, cost: { total: 0.02 } }, model: 'gpt-test', provider: 'openai-codex' } }),
    JSON.stringify({ type: 'message', id: 't1', parentId: 'a1', timestamp: new Date(3000).toISOString(), message: { role: 'toolResult', toolName: 'edit', isError: true, content: [{ type: 'text', text: 'failed' }] } }),
  ].join('\n'));

  assert.equal(trace.entryCount, 3);
  assert.equal(trace.userMessageCount, 1);
  assert.equal(trace.assistantMessageCount, 1);
  assert.equal(trace.toolCallCount, 1);
  assert.equal(trace.failedToolCallCount, 1);
  assert.equal(trace.totalTokens, 15);
  assert.deepEqual(trace.models, ['openai-codex/gpt-test']);
  assert.ok(trace.signalKinds.includes('failed_tool'));
  assert.ok(trace.signalKinds.includes('verification_missing'));
  assert.equal(trace.reviewScore, 6);
});

test('aggregates thread performance for analysis', () => {
  const performance = summarizeThreadPerformanceList(
    [
      {
        name: 'fast',
        repoUrl: 'https://github.com/acme/app.git',
        modelRef: 'openai/gpt-5',
        runStatus: 'ready',
        submittedAtMs: 999_999_000,
        updatedAt: new Date(1_000_000_000).toISOString(),
        firstLlmLatencyMs: 5000,
        performance: {
          hasDetailedMetrics: true,
          toolCalls: 2,
          topTools: [['bash', 2]],
        },
      },
      {
        name: 'slow-fail',
        repoUrl: 'https://github.com/acme/app.git',
        runStatus: 'failed',
        submittedAtMs: 308_800_000,
        updatedAt: new Date(309_000_000).toISOString(),
        firstLlmLatencyMs: 40_000,
        archivedAt: new Date(309_100_000).toISOString(),
      },
    ],
    {},
    1_000_000_000,
    { fast: { available: true, entryCount: 8, toolCallCount: 2, failedToolCallCount: 1, totalTokens: 20, totalCostUsd: 0.01, topTools: [['bash', 2]], reviewScore: 12, signalKinds: ['failed_tool'], signalCounts: { failed_tool: 1 }, models: ['openai/gpt-5'] } },
  );

  assert.equal(performance.summary.totalThreads, 2);
  assert.equal(performance.summary.completedThreads, 1);
  assert.equal(performance.summary.failedThreads, 1);
  assert.equal(performance.summary.archivedThreads, 1);
  assert.equal(performance.summary.recent24hThreads, 1);
  assert.equal(performance.summary.successRatePct, 50);
  assert.equal(performance.summary.medianFirstLlmMs, 5000);
  assert.equal(performance.summary.p95FirstLlmMs, 40_000);
  assert.deepEqual(performance.summary.topRepos, [['acme/app', 2]]);
  assert.deepEqual(performance.summary.topTools, [['bash', 2]]);
  assert.deepEqual(performance.summary.topModels, [['openai/gpt-5', 1]]);
  assert.equal(performance.summary.traceAnalyzedThreads, 1);
  assert.equal(performance.summary.totalTraceEntries, 8);
  assert.equal(performance.summary.totalReviewScore, 12);
  assert.deepEqual(performance.summary.topSignalKinds, [['failed_tool', 1]]);
  assert.deepEqual(performance.summary.reviewQueue.map((thread) => thread.name), ['fast']);
  const failed = performance.threads.find((thread) => thread.name === 'slow-fail');
  assert.match(performance.insights.join('\n'), /failed main agent/);
  assert.match(performance.insights.join('\n'), /Slowest first LLM/);
  assert.match(performance.insights.join('\n'), /Most-used repo: acme\/app×2/);
  assert.deepEqual(failed.flags, ['failed', 'slow first LLM', 'archived']);
});
