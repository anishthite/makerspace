import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = readFileSync(new URL('../frontend/src/pages.jsx', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../frontend/src/entry.jsx', import.meta.url), 'utf8');
const authRedirect = readFileSync(new URL('../frontend/src/runtime/auth-redirect.js', import.meta.url), 'utf8');
const js = readFileSync(new URL('../frontend/src/runtime/app.js', import.meta.url), 'utf8');
const agentToasts = readFileSync(new URL('../frontend/src/runtime/agent-toasts.js', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../frontend/src/styles/app.css', import.meta.url), 'utf8');
const runState = readFileSync(new URL('../src/server/run-state.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/server/routes.js', import.meta.url), 'utf8');
const threads = readFileSync(new URL('../src/server/threads.js', import.meta.url), 'utf8');

test('unsigned hosted users go to the homepage landing route from API auth failures', () => {
  assert.doesNotMatch(entry, /\/api\/me/);
  assert.match(authRedirect, /const HOMEPAGE_PATH = '\/homepage';/);
  assert.match(authRedirect, /payload\?\.authRequired/);
  assert.match(authRedirect, /Number\(response\?\.status\) !== 401/);
  assert.match(authRedirect, /location\.replace\(homepageRedirectUrl\(\)\)/);
});

test('workspace and thread suggestions use separate LLM generators', () => {
  const nextStepsStart = runState.indexOf('function scheduleSuggestedNextStepsGeneration');
  const nextStepsEnd = runState.indexOf('  function cleanWorkspaceSuggestionValue', nextStepsStart);
  const nextStepsBlock = runState.slice(nextStepsStart, nextStepsEnd);
  const workspaceStart = runState.indexOf('async function generateWorkspaceLaunchSuggestionsForThreads');
  const workspaceEnd = runState.indexOf('  async function persistThreadAssistantMessage', workspaceStart);
  const workspaceBlock = runState.slice(workspaceStart, workspaceEnd);

  assert.ok(nextStepsStart >= 0 && nextStepsEnd > nextStepsStart);
  assert.ok(workspaceStart >= 0 && workspaceEnd > workspaceStart);
  assert.match(nextStepsBlock, /generateSuggestedNextSteps\(current, latestAssistantTurn/);
  assert.doesNotMatch(nextStepsBlock, /generateWorkspaceLaunchSuggestions/);
  assert.match(workspaceBlock, /generateWorkspaceLaunchSuggestions\(source/);
  assert.doesNotMatch(workspaceBlock, /generateSuggestedNextSteps/);
});

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

test('home rows avoid workspace folder details', () => {
  assert.match(js, /function runningActivity\(thread, rawStatus = effectiveThreadStatus\(thread\)\)/);
  assert.match(js, /const detail = active \? runningActivity\(thread, rawStatus\) : '';/);
  assert.match(js, /\$\{detail \? `<small>\$\{escapeHtml\(detail\)\}<\/small>` : ''\}/);
  assert.doesNotMatch(js, /repoLabel\(thread\)/);
  assert.match(runState, /function latestRunActivity\(run\)/);
  assert.match(runState, /latestActivity: latestActivity \|\| undefined/);
});

test('workspace agents use shadcn sidebar beside launch composer', () => {
  const providerIndex = pages.indexOf('<SidebarProvider className="workspace-shell min-h-svh bg-[var(--bg)]"');
  const agentsIndex = pages.indexOf('id="agents-section"');
  const formIndex = pages.indexOf('id="thread-form"');
  const suggestionsIndex = pages.indexOf('id="launch-suggestions"');
  assert.ok(providerIndex > -1 && providerIndex < agentsIndex && agentsIndex < formIndex && formIndex < suggestionsIndex);
  assert.match(pages, /SidebarProvider[\s\S]+from '\.\/components\/ui\/sidebar\.jsx';/);
  assert.match(pages, /<Sidebar className="border-r border-\[var\(--rule\)\]">/);
  assert.match(pages, /<SidebarInset className="min-w-0 bg-\[var\(--bg\)\]/);
  assert.match(pages, /<SidebarTrigger className="workspace-sidebar-trigger[^"]+md:hidden">agents<\/SidebarTrigger>/);
  assert.match(appCss, /\.workspace-mobile-nav[\s\S]+position: sticky;/);
  assert.match(appCss, /\.launch-controls,[\s\S]+\.flow-composer \.composer-controls[\s\S]+display: grid;/);
  assert.match(pages, /data-suggested-prompt="Review the current diff/);
  assert.match(pages, /<strong[^>]*>Find next move<\/strong>/);
  assert.match(js, /const launchSuggestions = document\.querySelector\('#launch-suggestions'\);/);
  assert.match(js, /async function loadWorkspaceLaunchSuggestions\(threads\)/);
  assert.match(js, /function workspaceSuggestionThreadContext\(thread\)/);
  assert.match(js, /fetchJson\('\/api\/workspace-suggestions'/);
  assert.match(js, /loadWorkspaceLaunchSuggestions\(threads\)\.catch\(\(\) => \{\}\);/);
  assert.match(routes, /pathname === '\/api\/workspace-suggestions'/);
  assert.match(runState, /generateWorkspaceLaunchSuggestionsForThreads/);
  assert.doesNotMatch(js, /thread\?\.suggestedNextSteps/);
  assert.match(js, /promptInput\.value = button\.dataset\.suggestedPrompt \|\| '';/);
});

test('workspace agents header is fixed, not a layout review surface', () => {
  assert.match(pages, /<SidebarHeader className="grid gap-3 border-b border-\[var\(--rule\)\] px-3 py-4">\s*<Brand href="\/workspace\.html" label="Spanner workspace" \/>\s*<div className=\{sectionRowClass\}><WorkspaceManager className="w-full justify-between" \/><\/div>/);
  assert.doesNotMatch(pages, /WorkspaceSidebarLayoutPicker|workspaceSidebarLayouts|data-workspace-sidebar-layout-option|>Agents<\/h2>|id="refresh-threads"/);
  assert.doesNotMatch(js, /WORKSPACE_SIDEBAR_LAYOUT|workspaceSidebarLayout|refreshThreads/);
  assert.doesNotMatch(appCss, /workspace-layout-picker|data-workspace-sidebar-layout/);
});

test('home history and finished clear controls live in the finished lane', () => {
  assert.doesNotMatch(pages, /main-screen-variations|>concepts<\/a>|id="refresh-threads"/);
  assert.match(js, /const visibleLanes = grouped\.running\.length \? lanes : lanes\.filter\(\(lane\) => lane\.key !== 'running'\);/);
  assert.match(js, /const historyLink = lane\.key === 'done' \? '<a class="textbtn lane-history" href="\/history\.html">history<\/a>' : '';/);
  assert.match(js, /id="clear-finished-threads" class="textbtn lane-clear" type="button">clear<\/button>/);
  assert.doesNotMatch(js, /clear all/);
  assert.match(js, /for \(const name of names\) \{\s*await fetchJson\(`\/api\/threads\/\$\{encodeURIComponent\(name\)\}\/archive`/);
  assert.match(js, /cache: 'no-store'/);
});

test('recently finished rows show title, run meta, then summary', () => {
  assert.match(js, /function finalAnswerSummary\(thread, maxLength = 160\)/);
  assert.match(js, /function finishedOutcome\(thread, rawStatus\)/);
  assert.match(js, /thread\?\.finalAnswerSummary/);
  assert.match(js, /const outcome = active \? '' : finishedOutcome\(thread, rawStatus\);/);
  assert.match(js, /function finishedAt\(thread\) \{/);
  assert.match(js, /function finishedAtMs\(thread\) \{/);
  assert.match(js, /const finishedValue = finishedAt\(thread\);/);
  assert.match(js, /const inactiveTimes = !active \? \[finished, runtime \? `ran \$\{runtime\}` : ''\]\.filter\(Boolean\) : \[\];/);
  assert.match(js, /<span class="finished-meta">\$\{inactiveTimes\.map\(\(text\) => `<time>\$\{escapeHtml\(text\)\}<\/time>`\)\.join\(''\)\}<\/span>/);
  assert.match(js, /\$\{detail \? `<small>\$\{escapeHtml\(detail\)\}<\/small>` : ''\}\s+\$\{inactiveMeta\}/);
  assert.match(js, /\$\{archiveButton\}\s+\$\{activeRuntime\}/);
  assert.match(js, /class="answer-preview">\$\{escapeHtml\(outcome\)\}/);
  assert.match(js, /grouped\.done\.sort\(\(left, right\) => finishedAtMs\(right\) - finishedAtMs\(left\)\);/);
  assert.match(runState, /scheduleFinalAnswerSummaryGeneration\(updated, text, runId\);/);
  assert.match(runState, /scheduleFinalTurnStatusClassification\(updated, \{ text \}, runId\);/);
  assert.match(runState, /scheduleSuggestedNextStepsGeneration\(updated, text, runId\);/);
});

test('recently finished success indicators can be dismissed locally', () => {
  assert.ok(js.includes("const SEEN_FINISHED_THREADS_KEY = 'spannerSeenFinishedThreads';"));
  assert.ok(js.includes("return !active && ['completed', 'ready'].includes(rawStatus);"));
  assert.ok(js.includes('data-finished-indicator="${escapeHtml(indicatorKey)}"'));
  assert.ok(js.includes('data-finished-thread="${escapeHtml(indicatorKey)}"'));
  assert.match(js, /threadsList\.addEventListener\('keydown'/);
});

test('workspace toasts when running agents finish', () => {
  assert.match(entry, /import \{ Toaster \} from '\.\/components\/ui\/sonner\.jsx';/);
  assert.match(entry, /<Toaster[\s\S]+position="top-right"[\s\S]+richColors[\s\S]+closeButton/);
  assert.match(entry, /offset=\{\{ top: 18, right: 18 \}\}/);
  assert.match(entry, /mobileOffset=\{\{ top: 16, left: 16, right: 16 \}\}/);
  assert.match(entry, /closest\?\.\('\[data-sonner-toast\]\.agent-main-link-toast'\)/);
  assert.match(entry, /location\.assign\(MAIN_PAGE_PATH\)/);
  assert.match(js, /import \{ toast \} from 'sonner';/);
  assert.match(js, /function showAgentToast\(title, detail = '', tone = 'success'\)/);
  assert.match(js, /const notify = tone === 'error' \? toast\.error : toast\.success;/);
  assert.match(js, /description: detail \|\| undefined,\s*duration: 8000,\s*className: 'agent-main-link-toast',\s*\}\);/);
  assert.doesNotMatch(js, /action: \{ label: 'Open main'/);
  assert.match(appCss, /\[data-sonner-toaster\] \[data-sonner-toast\]\.agent-main-link-toast\[data-styled="true"\]/);
  assert.match(appCss, /background: color-mix\(in srgb, var\(--paper-2\) 84%, var\(--green\) 16%\);/);
  assert.doesNotMatch(appCss, /\[data-button\]\[data-action\]/);
  assert.match(js, /function notifyFinishedThreads\(threads\)/);
  assert.match(js, /const wasActive = isActiveThread\(\{ runStatus: knownThreadStatuses\.get\(name\) \}\);/);
  assert.match(js, /showAgentToast\(title, detail, rawStatus === 'failed' \? 'error' : 'success'\);/);
  assert.doesNotMatch(`${js}\n${agentToasts}\n${appCss}`, /#agent-toast-stack|\.agent-toast/);
  assert.match(js, /setInterval\(\(\) => \{\s*if \(document\.visibilityState !== 'visible'\) return;\s*loadThreads\(\)\.catch\(\(\) => \{\}\);\s*\}, 10000\);/);
});

test('global toasts load outside the workspace screen', () => {
  assert.match(entry, /import \{ startAgentToastWatcher \} from '\.\/runtime\/agent-toasts\.js';/);
  assert.match(entry, /if \(page !== 'workspace'\) startAgentToastWatcher\(\);/);
  assert.match(agentToasts, /import \{ toast \} from 'sonner';/);
  assert.match(agentToasts, /export function startAgentToastWatcher\(\) \{/);
  assert.match(agentToasts, /function notifyFinishedThreads\(threads\)/);
  assert.match(agentToasts, /const wasActive = isActiveThread\(\{ runStatus: knownThreadStatuses\.get\(name\) \}\);/);
  assert.match(agentToasts, /const notify = tone === 'error' \? toast\.error : toast\.success;/);
  assert.doesNotMatch(agentToasts, /action: \{ label: 'Open main'/);
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
