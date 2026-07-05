import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = readFileSync(new URL('../frontend/src/pages.jsx', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../frontend/src/entry.jsx', import.meta.url), 'utf8');
const js = readFileSync(new URL('../frontend/src/runtime/app.js', import.meta.url), 'utf8');
const agentToasts = readFileSync(new URL('../frontend/src/runtime/agent-toasts.js', import.meta.url), 'utf8');
const runState = readFileSync(new URL('../src/server/run-state.js', import.meta.url), 'utf8');
const threads = readFileSync(new URL('../src/server/threads.js', import.meta.url), 'utf8');

test('home agents header omits aggregate status line', () => {
  assert.match(pages, /export function WorkspacePage\(\)/);
  assert.doesNotMatch(pages, /id="action-summary"/);
  assert.doesNotMatch(js, /function formatRunningTotal/);
  assert.doesNotMatch(js, /recently finished`/);
  assert.doesNotMatch(js, /updateActionSummary\(\);/);
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
  assert.doesNotMatch(pages, /main-screen-variations|>concepts<\/a>/);
  assert.match(pages, /href="\/history\.html">history<\/Button><Button id="refresh-threads"/);
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
  assert.match(runState, /scheduleFinalTurnStatusClassification\(updated, \{ text \}, runId\);/);
  assert.match(runState, /scheduleSuggestedNextStepsGeneration\(updated, text, runId\);/);
});

test('recently finished success indicators can be dismissed locally', () => {
  assert.ok(js.includes("const SEEN_FINISHED_THREADS_KEY = 'workbenchSeenFinishedThreads';"));
  assert.ok(js.includes("return !active && ['completed', 'ready'].includes(rawStatus);"));
  assert.ok(js.includes('data-finished-indicator="${escapeHtml(indicatorKey)}"'));
  assert.ok(js.includes('data-finished-thread="${escapeHtml(indicatorKey)}"'));
  assert.match(js, /threadsList\.addEventListener\('keydown'/);
});

test('workspace toasts when running agents finish', () => {
  assert.doesNotMatch(pages, /className="[^"]*agent-toast[^"]*"/);
  assert.match(js, /function showAgentToast\(title, detail = '', tone = 'success'\)/);
  assert.match(js, /function notifyFinishedThreads\(threads\)/);
  assert.match(js, /const wasActive = isActiveThread\(\{ runStatus: knownThreadStatuses\.get\(name\) \}\);/);
  assert.match(js, /showAgentToast\(title, detail, rawStatus === 'failed' \? 'error' : 'success'\);/);
  assert.match(js, /setInterval\(\(\) => \{\s*if \(document\.visibilityState !== 'visible'\) return;\s*loadThreads\(\)\.catch\(\(\) => \{\}\);\s*\}, 10000\);/);
});

test('global toasts load outside the workspace screen', () => {
  assert.match(entry, /import \{ startAgentToastWatcher \} from '\.\/runtime\/agent-toasts\.js';/);
  assert.match(entry, /if \(page !== 'workspace'\) startAgentToastWatcher\(\);/);
  assert.match(agentToasts, /export function startAgentToastWatcher\(\) \{/);
  assert.match(agentToasts, /function notifyFinishedThreads\(threads\)/);
  assert.match(agentToasts, /const wasActive = isActiveThread\(\{ runStatus: knownThreadStatuses\.get\(name\) \}\);/);
  assert.match(agentToasts, /showAgentToast\(title, detail, rawStatus === 'failed' \? 'error' : 'success'\);/);
  assert.match(agentToasts, /setInterval\(\(\) => \{\s*if \(document\.visibilityState !== 'visible'\) return;\s*loadThreadsForToasts\(\)\.catch\(\(\) => \{\}\);\s*\}, 10000\);/);
});

test('new runs clear stale terminal runtime fields', () => {
  assert.match(runState, /function activeRunResetPatch\(\) \{/);
  assert.match(runState, /completedAt: undefined/);
  assert.match(runState, /endedAt: undefined/);
  assert.match(runState, /runEndedAtMs: undefined/);
  assert.match(runState, /finalAnswerSummary: undefined/);
  assert.match(runState, /finalTurnStatus: undefined/);
  assert.match(runState, /suggestedNextSteps: undefined/);
  assert.match(threads, /\.\.\.activeRunResetPatch\(\),\n\s+taskPrompt: prompt/);
});

test('local rows only stay live while a local runner promise is live', () => {
  assert.match(runState, /const liveLocalRuns = new Set\(\);/);
  assert.match(runState, /decorated\.localMode && isActiveRunStatus\(run\.runStatus \|\| decorated\.runStatus \|\| decorated\.status\) && !liveLocalRuns\.has\(session\.name\)/);
  assert.match(threads, /liveLocalRuns\.add\(stored\.name\);/);
  assert.match(threads, /\.finally\(\(\) => \{\n\s+liveLocalRuns\.delete\(stored\.name\);/);
  assert.match(threads, /localRunControllers\.delete\(stored\.name\)/);
});
