import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyPerformanceEvent, summarizeThreadPerformance, summarizeThreadPerformanceList } from '../src/performance.js';

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

test('aggregates thread performance for analysis', () => {
  const performance = summarizeThreadPerformanceList(
    [
      {
        name: 'fast',
        runStatus: 'ready',
        submittedAtMs: 1000,
        updatedAt: new Date(31_000).toISOString(),
        firstLlmLatencyMs: 5000,
      },
      {
        name: 'slow-fail',
        runStatus: 'failed',
        submittedAtMs: 1000,
        updatedAt: new Date(91_000).toISOString(),
        firstLlmLatencyMs: 40_000,
      },
    ],
    {},
    100_000,
  );

  assert.equal(performance.summary.totalThreads, 2);
  assert.equal(performance.summary.failedThreads, 1);
  assert.equal(performance.summary.medianFirstLlmMs, 5000);
  assert.equal(performance.summary.p95FirstLlmMs, 40_000);
  const failed = performance.threads.find((thread) => thread.name === 'slow-fail');
  assert.match(performance.insights.join('\n'), /failed main agent/);
  assert.match(performance.insights.join('\n'), /Slowest first LLM/);
  assert.deepEqual(failed.flags, ['failed', 'slow first LLM']);
});
