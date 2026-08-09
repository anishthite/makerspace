import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { createRunState } from '../src/server/run-state.js';
import { getStoredSession, upsertSession } from '../src/store.js';

const pages = readFileSync(new URL('../frontend/src/pages.jsx', import.meta.url), 'utf8');
const js = readFileSync(new URL('../frontend/src/runtime/thread.js', import.meta.url), 'utf8');
const css = [
  readFileSync(new URL('../frontend/src/styles/app.css', import.meta.url), 'utf8'),
  readFileSync(new URL('../frontend/src/styles/thread.css', import.meta.url), 'utf8'),
].join('\n');

function todoRunState(sessionFile) {
  return createRunState({
    config: { sessionFile },
    provider: { info: () => ({}), listSessions: async () => [] },
    loadPiSdk: async () => null,
    loadPiAi: async () => null,
    canAccessSession: () => true,
  });
}

async function eventually(fn) {
  for (let i = 0; i < 20; i += 1) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return fn();
}

test('thread page wires a todo rail into the workflow sidecar', () => {
  const agentIndex = pages.indexOf('id="agent-rail"');
  const todoIndex = pages.indexOf('id="todo-rail"');
  const diffIndex = pages.indexOf('id="diff-box"');
  assert.ok(agentIndex > -1 && todoIndex > agentIndex && diffIndex > todoIndex);
  assert.match(pages, /id="todo-count">0\/0<\/strong>/);
  assert.match(pages, /id="todo-list"/);
  assert.match(js, /const todoRail = document\.querySelector\('#todo-rail'\)/);
  assert.match(js, /function todoStateFromEvent/);
  assert.match(js, /syncTodoStateFromThread\(thread\)/);
  assert.match(js, /syncTodoStateFromEvent\(mergedEvent\)/);
  assert.match(css, /\.todo-rail \{/);
  assert.match(css, /\.todo-item\.in_progress \.todo-dot/);
  assert.match(css, /body\.thread-page \.agent-node,\s*body\.thread-page \.todo-item \{[^}]*border: 1px solid var\(--thread-rule\)/);
  assert.doesNotMatch(js, /todoStatusLabel/);
});

test('todo event snapshots normalize and sort visible tasks', () => {
  const start = js.indexOf('function todoToolName');
  const end = js.indexOf('function todoTaskHtml');
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  runInNewContext(`
    function clamp(value, max = 1200) {
      const text = String(value || '');
      return text.length > max ? text.slice(0, max) : text;
    }
    ${js.slice(start, end)}
    const state = todoStateFromEvent({
      type: 'tool',
      phase: 'end',
      toolName: 'functions.todo',
      details: { nextId: 5, tasks: [
        { id: 1, subject: 'Already done', status: 'completed' },
        { id: 4, subject: 'Removed', status: 'deleted' },
        { id: 3, subject: 'Next thing', status: 'pending' },
        { id: 2, subject: 'Current thing', status: 'in_progress', activeForm: 'doing it' }
      ] }
    });
    globalThis.result = {
      count: state.tasks.length,
      nextId: state.nextId,
      ordered: visibleTodoTasks(state).map((task) => task.id),
      activeForm: state.tasks.find((task) => task.id === 2).activeForm,
    };
  `, context);
  assert.equal(JSON.stringify(context.result), JSON.stringify({ count: 4, nextId: 5, ordered: [1, 2, 3], activeForm: 'doing it' }));
});

test('run state persists latest todo snapshot on the thread session', async () => {
  process.env.SPANNER_STATE_STORE = 'file';
  const dir = await mkdtemp(path.join(tmpdir(), 'spanner-todo-'));
  const sessionFile = path.join(dir, 'sessions.json');
  try {
    await upsertSession(sessionFile, { name: 'todo-thread', createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z', threadBridge: true });
    const runState = todoRunState(sessionFile);
    runState.recordRunEvent('todo-thread', {
      type: 'tool',
      phase: 'end',
      toolName: 'todo',
      details: { action: 'update', nextId: 2, tasks: [{ id: 1, subject: 'Ship gutter', status: 'in_progress', activeForm: 'shipping' }] },
      runStatus: 'running',
    });

    assert.equal(runState.ensureRunState('todo-thread').todoState.tasks[0].subject, 'Ship gutter');
    const stored = await eventually(async () => {
      const session = await getStoredSession(sessionFile, 'todo-thread');
      return session?.todoState?.tasks?.[0]?.activeForm === 'shipping' ? session : null;
    });
    assert.equal(stored.todoState.tasks[0].status, 'in_progress');
    assert.equal(runState.decorateLiveSession(stored).todoState.tasks[0].subject, 'Ship gutter');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
