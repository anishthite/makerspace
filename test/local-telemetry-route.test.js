import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

import { createThreadService } from '../src/server/threads.js';

function createService(config) {
  return createThreadService({
    config,
    provider: { kind: 'local', info: () => ({ kind: 'local' }) },
    http: {
      clientError(message, statusCode = 400) {
        const error = new Error(message);
        error.statusCode = statusCode;
        return error;
      },
    },
    auth: {
      canAccessSession(session, viewerSessionId) {
        return !session?.githubOwnerSessionId || session.githubOwnerSessionId === viewerSessionId;
      },
      loadPiDefaults: async () => ({}),
      enrichGitHubRepoSession: async (session) => session,
    },
    runState: {
      activeRuns: new Map(),
      liveLocalRuns: new Set(),
      decorateLiveSession: (session) => session,
      activeRunResetPatch: () => ({}),
    },
    bridge: {},
  });
}

test('local telemetry reads desktop sessions and Pi trace analysis without browser ownership filter', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'makerspace-local-telemetry-'));
  const localHome = path.join(tempDir, 'local-home');
  const isolatedStore = path.join(tempDir, 'configured-sessions.json');

  try {
    await mkdir(path.join(localHome, 'pi-sessions'), { recursive: true });
    await writeFile(isolatedStore, '[]\n');
    await writeFile(path.join(localHome, 'pi-sessions', 'old-desktop-thread.jsonl'), `${[
      JSON.stringify({ type: 'session', id: 'old-desktop-thread', timestamp: new Date(1000).toISOString() }),
      JSON.stringify({ type: 'message', id: 'u1', timestamp: new Date(1000).toISOString(), message: { role: 'user', content: [{ type: 'text', text: 'fix local state' }] } }),
      JSON.stringify({ type: 'message', id: 'a1', parentId: 'u1', timestamp: new Date(2000).toISOString(), message: { role: 'assistant', content: [{ type: 'toolCall', name: 'edit', arguments: { path: 'app.js' } }], usage: { input: 10, output: 5, cost: { total: 0.01 } }, model: 'gpt-test', provider: 'openai-codex' } }),
      JSON.stringify({ type: 'message', id: 't1', parentId: 'a1', timestamp: new Date(3000).toISOString(), message: { role: 'toolResult', toolName: 'edit', isError: true, content: [{ type: 'text', text: 'failed' }] } }),
    ].join('\n')}\n`);
    await writeFile(path.join(localHome, 'sessions.json'), `${JSON.stringify([
      {
        name: 'old-desktop-thread',
        provider: 'local',
        threadBridge: true,
        localMode: true,
        repoPath: tempDir,
        initialPrompt: 'Inspect local state',
        status: 'ready',
        runStatus: 'ready',
        submittedAtMs: 1000,
        updatedAt: new Date(2000).toISOString(),
        githubOwnerSessionId: 'old-browser-session',
      },
    ])}\n`);

    const service = createService({
      provider: 'local',
      rootDir: path.resolve(import.meta.dirname, '..'),
      localDataDir: localHome,
      sessionFile: isolatedStore,
      piSessionTraceDir: path.join(localHome, 'pi-sessions'),
    });

    const normal = await service.listThreadPerformancePayload('current-browser-session-123');
    assert.equal(normal.performance.summary.totalThreads, 0);

    const local = await service.listThreadPerformancePayload('current-browser-session-123', false, null, { source: 'local' });
    assert.equal(local.performance.source.kind, 'local-file');
    assert.equal(local.performance.summary.totalThreads, 1);
    assert.equal(local.performance.summary.traceAnalyzedThreads, 1);
    assert.equal(local.performance.summary.topSignalKinds[0][0], 'failed_tool');
    assert.equal(local.performance.threads[0].name, 'old-desktop-thread');
    assert.equal(local.performance.threads[0].metricsSource, 'trace');
    assert.equal(local.performance.threads[0].analysisScore, 5);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
