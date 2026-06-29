import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';

import { canUnarchiveHistoryRow, filterHistoryRows, filterSessionsByProject, historyKind, historyStats, normalizeHistoryRow } from '../public/history.js';

const historyJs = readFileSync(new URL('../public/history.js', import.meta.url), 'utf8');
const historyHtml = readFileSync(new URL('../public/history.html', import.meta.url), 'utf8');

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

test('history rows expose restore only for archived thread agents', () => {
  assert.equal(canUnarchiveHistoryRow({ archived: true, href: '/thread.html?name=done' }), true);
  assert.equal(canUnarchiveHistoryRow({ archived: true }), false);
  assert.equal(canUnarchiveHistoryRow({ href: '/thread.html?name=done' }), false);
  assert.match(historyJs, /data-unarchive-thread/);
  assert.match(historyJs, /\/api\/threads\/\$\{encodeURIComponent\(name\)\}\/unarchive/);
  assert.match(historyHtml, /history\.js\?v=palette-\d+/);
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
