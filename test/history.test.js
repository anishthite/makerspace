import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';

import { canUnarchiveHistoryRow, filterHistoryRows, filterSessionsByProject, historyKind, historyRowMatchesFilter, historyStats, normalizeHistoryRow } from '../frontend/src/runtime/history.js';

const historyJs = readFileSync(new URL('../frontend/src/runtime/history.js', import.meta.url), 'utf8');
const historyHtml = readFileSync(new URL('../frontend/history.html', import.meta.url), 'utf8');

test('historyStats counts threads, sessions, active, archived, and failed rows', () => {
  const sessions = [
    { name: 'one', threadBridge: true, runStatus: 'running' },
    { name: 'two', bridgeMode: true, status: 'completed', archivedAt: '2026-06-24T10:00:00Z' },
    { name: 'three', status: 'failed' },
  ];

  assert.deepEqual(historyStats(sessions), {
    total: 3,
    threads: 1,
    sessions: 2,
    active: 1,
    archived: 1,
    failed: 1,
  });
});

test('history rows label agents and search prompt/repo text', () => {
  const row = normalizeHistoryRow({
    name: 'billing-20260624',
    threadBridge: true,
    repoUrl: 'https://github.com/acme/billing.git',
    initialPrompt: 'Fix invoice exports',
    runStatus: 'ready',
  });

  assert.equal(historyKind({ threadBridge: true }), 'thread agent');
  assert.equal(row.title, 'Fix invoice exports');
  assert.equal(filterHistoryRows([row], 'invoice').length, 1);
  assert.equal(filterHistoryRows([row], 'acme/billing').length, 1);
  assert.equal(filterHistoryRows([row], 'missing').length, 0);
});

test('history filters combine status buckets with search text', () => {
  const rows = [
    normalizeHistoryRow({ name: 'active-thread', threadBridge: true, repoUrl: 'https://github.com/acme/api.git', initialPrompt: 'Fix cache', runStatus: 'running' }),
    normalizeHistoryRow({ name: 'archived-thread', threadBridge: true, repoUrl: 'https://github.com/acme/web.git', initialPrompt: 'Polish history', runStatus: 'ready', archivedAt: '2026-08-01T10:00:00Z' }),
    normalizeHistoryRow({ name: 'failed-session', bridgeMode: true, repoUrl: 'https://github.com/acme/ops.git', initialPrompt: 'Deploy worker', status: 'failed' }),
  ];

  assert.equal(historyRowMatchesFilter(rows[0], 'active'), true);
  assert.deepEqual(filterHistoryRows(rows, '', 'threads').map((row) => row.name), ['active-thread', 'archived-thread']);
  assert.deepEqual(filterHistoryRows(rows, '', 'sessions').map((row) => row.name), ['failed-session']);
  assert.deepEqual(filterHistoryRows(rows, '', 'archived').map((row) => row.name), ['archived-thread']);
  assert.deepEqual(filterHistoryRows(rows, 'worker', 'failed').map((row) => row.name), ['failed-session']);
  assert.deepEqual(filterHistoryRows(rows, 'worker', 'active').map((row) => row.name), []);
});

test('history rows expose restore only for archived thread agents', () => {
  assert.equal(canUnarchiveHistoryRow({ archived: true, href: '/thread.html?name=done' }), true);
  assert.equal(canUnarchiveHistoryRow({ archived: true }), false);
  assert.equal(canUnarchiveHistoryRow({ href: '/thread.html?name=done' }), false);
  assert.match(historyJs, /data-unarchive-thread/);
  assert.match(historyJs, /\/api\/threads\/\$\{encodeURIComponent\(name\)\}\/unarchive/);
  assert.match(historyHtml, /data-react-page="history"/);
  assert.match(historyHtml, /\/src\/entry\.jsx/);
  assert.match(historyJs, /data-history-filter/);
  assert.match(historyJs, /history-filter-summary/);
});

test('history filters sessions to the selected project', () => {
  const sessions = [
    { name: 'local-match', repoPath: '/tmp/app' },
    { name: 'local-miss', repoPath: '/tmp/other' },
    { name: 'git-match', repoUrl: 'https://github.com/acme/billing.git' },
    { name: 'git-miss', repoUrl: 'https://github.com/acme/ops.git' },
  ];

  assert.deepEqual(
    filterSessionsByProject(sessions, { kind: 'local', value: '/tmp/app/' }).map((session) => session.name),
    ['local-match'],
  );
  assert.deepEqual(
    filterSessionsByProject(sessions, { kind: 'git', value: 'github.com/acme/billing' }).map((session) => session.name),
    ['git-match'],
  );
});
