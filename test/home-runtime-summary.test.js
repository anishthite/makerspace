import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/workspace.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const runState = readFileSync(new URL('../src/server/run-state.js', import.meta.url), 'utf8');
const threads = readFileSync(new URL('../src/server/threads.js', import.meta.url), 'utf8');

test('home agents summary shows total active runtime', () => {
  assert.match(html, /\/app\.js\?v=finished-indicator-1/);
  assert.match(js, /function formatRunningTotal\(starts, endValue = Date\.now\(\)\)/);
  assert.match(js, /totalMs \+= Math\.max\(0, end - start\)/);
  assert.match(js, /running\$\{total \? ` for \$\{total\} total` : ''\}/);
  assert.match(js, /grouped\.running\.filter\(isActiveThread\)\.map\(runtimeStart\)/);
  assert.match(js, /updateActionSummary\(\);/);
});

test('home running lane only uses active thread statuses', () => {
  assert.match(js, /function effectiveThreadStatus\(thread\)/);
  assert.match(js, /runStatus && runStatus !== 'unknown' \? runStatus : String\(thread\?\.status \|\| ''\)\.toLowerCase\(\)/);
  assert.match(js, /function threadLane\(thread\) \{\s*return isActiveThread\(thread\) \? 'running' : 'done';\s*\}/);
});

test('running rows show activity instead of the workspace folder', () => {
  assert.match(js, /function runningActivity\(thread, rawStatus = effectiveThreadStatus\(thread\)\)/);
  assert.match(js, /const detail = active \? runningActivity\(thread, rawStatus\) : `\$\{repo\}\$\{branch\}`;/);
  assert.match(runState, /function latestRunActivity\(run\)/);
  assert.match(runState, /latestActivity: latestActivity \|\| undefined/);
});

test('home history and finished clear controls are near agent refresh', () => {
  assert.doesNotMatch(html, /main-screen-variations|>concepts<\/a>/);
  assert.match(html, /<a class="textbtn" href="\/history\.html">history<\/a>\s*<button id="refresh-threads"/);
  assert.match(js, /id="clear-finished-threads" class="textbtn lane-clear"/);
  assert.match(js, /for \(const name of names\) \{\s*await fetchJson\(`\/api\/threads\/\$\{encodeURIComponent\(name\)\}\/archive`/);
  assert.match(js, /cache: 'no-store'/);
});

test('recently finished rows stack finished and runtime copy in the top right', () => {
  assert.match(js, /function finalAnswerSummary\(thread, maxLength = 160\)/);
  assert.match(js, /function finishedOutcome\(thread, rawStatus\)/);
  assert.match(js, /thread\?\.finalAnswerSummary/);
  assert.match(js, /const outcome = active \? '' : finishedOutcome\(thread, rawStatus\);/);
  assert.match(js, /function finishedAt\(thread\) \{/);
  assert.match(js, /function finishedAtMs\(thread\) \{/);
  assert.match(js, /const finishedValue = finishedAt\(thread\);/);
  assert.match(js, /const inactiveTimes = !active \? \[finished, runtime \? `ran \$\{runtime\}` : ''\]\.filter\(Boolean\) : \[\];/);
  assert.match(js, /<span class="finished-meta">\$\{inactiveTimes\.map\(\(text\) => `<time>\$\{escapeHtml\(text\)\}<\/time>`\)\.join\(''\)\}<\/span>/);
  assert.match(js, /\$\{inactiveMeta \|\| activeRuntime\}/);
  assert.match(js, /class="answer-preview">\$\{escapeHtml\(outcome\)\}/);
  assert.match(js, /grouped\.done\.sort\(\(left, right\) => finishedAtMs\(right\) - finishedAtMs\(left\)\);/);
  assert.match(runState, /scheduleFinalAnswerSummaryGeneration\(updated, text, runId\);/);
});

test('recently finished success indicators can be dismissed locally', () => {
  assert.ok(js.includes("const SEEN_FINISHED_THREADS_KEY = 'makerspaceSeenFinishedThreads';"));
  assert.ok(js.includes("return !active && ['completed', 'ready'].includes(rawStatus);"));
  assert.ok(js.includes('data-finished-indicator="${escapeHtml(indicatorKey)}"'));
  assert.ok(js.includes('data-finished-thread="${escapeHtml(indicatorKey)}"'));
  assert.match(js, /threadsList\.addEventListener\('keydown'/);
});

test('new runs clear stale terminal runtime fields', () => {
  assert.match(runState, /function activeRunResetPatch\(\) \{/);
  assert.match(runState, /completedAt: undefined/);
  assert.match(runState, /endedAt: undefined/);
  assert.match(runState, /runEndedAtMs: undefined/);
  assert.match(runState, /finalAnswerSummary: undefined/);
  assert.match(threads, /\.\.\.activeRunResetPatch\(\),\n\s+taskPrompt: prompt/);
});

test('local rows only stay live while a local runner promise is live', () => {
  assert.match(runState, /const liveLocalRuns = new Set\(\);/);
  assert.match(runState, /decorated\.localMode && isActiveRunStatus\(run\.runStatus \|\| decorated\.runStatus \|\| decorated\.status\) && !liveLocalRuns\.has\(session\.name\)/);
  assert.match(threads, /liveLocalRuns\.add\(stored\.name\);/);
  assert.match(threads, /\.finally\(\(\) => liveLocalRuns\.delete\(stored\.name\)\)/);
});
