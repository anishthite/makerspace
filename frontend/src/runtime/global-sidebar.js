import { notifyAgentThreads } from './agent-toasts.js';
import { projectIconSvg } from './project-icons.js';
import { bindSidebarPromptLightbox, openSidebarPromptLightbox } from './sidebar-prompt-lightbox.js';

const BROWSER_SESSION_KEY = 'spannerBrowserSession';
const PROJECT_KEY = 'spannerSelectedProject';
const SEEN_FINISHED_THREADS_KEY = 'spannerSeenFinishedThreads';
const SIDEBAR_SETTLED_EXPANDED_KEY = 'spannerSidebarSettledExpanded';
const SIDEBAR_SETTLED_VISIBLE_KEY = 'spannerSidebarSettledVisible';
const SIDEBAR_SETTLED_THREADS_KEY = 'spannerSidebarSettledThreads';
const SIDEBAR_PROJECT_SCOPE_KEY = 'spannerSidebarProjectScope';
const GLOBAL_SIDEBAR_THREADS_CACHE_KEY = 'spannerGlobalSidebarThreadsCache';
const INITIAL_SETTLED_VISIBLE_COUNT = 20;
const SETTLED_TAIL_PAGE_COUNT = 20;
const SETTLEABLE_THREAD_STATUSES = ['completed', 'ready', 'failed'];
const FINISHED_INDICATOR_RESET_ATTRIBUTES = ['role', 'tabindex', 'aria-label', 'title', 'data-finished-indicator'];
const SIDEBAR_POLL_INTERVAL_MS = 30000;
const SIDEBAR_RUNTIME_TICK_MS = 30000;
const API_BASE = String(import.meta.env?.VITE_SPANNER_API_BASE || '').trim().replace(/\/+$/, '');

let threadsList = null;
let agentSearchInput = null;
let statusNode = null;
let sidebarThreads = [];
let runtimeTickTimer = null;
let settledShelfExpanded = readSettledShelfExpanded();
let settledVisibleCount = readSettledVisibleCount();
let settledThreadNames = readSettledThreadNames();
let sidebarProjectScope = readSidebarProjectScope();
let seenFinishedThreads = readSeenFinishedThreads();
let renderedSidebarThreadNames = [];
let selectedSidebarThreadNames = new Set();
let selectionAnchorThreadName = '';
let contextMenuThreadName = '';
let lastSidebarRenderSignature = '';
let lastSidebarRenderList = null;
let started = false;

function getBrowserSessionId() {
  let sessionId = localStorage.getItem(BROWSER_SESSION_KEY) || '';
  if (!sessionId) {
    sessionId = globalThis.crypto?.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('-');
    localStorage.setItem(BROWSER_SESSION_KEY, sessionId);
  }
  return sessionId;
}

function authHeaders() {
  return { 'x-spanner-session': getBrowserSessionId() };
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Backend unavailable. Check Settings.');
  }
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readSeenFinishedThreads() {
  try {
    const value = JSON.parse(localStorage.getItem(SEEN_FINISHED_THREADS_KEY) || '[]');
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function rememberSeenFinishedThread(key) {
  if (!key) return;
  seenFinishedThreads.add(key);
  localStorage.setItem(SEEN_FINISHED_THREADS_KEY, JSON.stringify([...seenFinishedThreads].slice(-250)));
}

function readSettledShelfExpanded() {
  try { return localStorage.getItem(SIDEBAR_SETTLED_EXPANDED_KEY) === '1'; }
  catch { return false; }
}

function setSettledShelfExpanded(expanded) {
  settledShelfExpanded = Boolean(expanded);
  try { localStorage.setItem(SIDEBAR_SETTLED_EXPANDED_KEY, settledShelfExpanded ? '1' : '0'); }
  catch {}
}

function readSettledVisibleCount() {
  try {
    const value = Number(localStorage.getItem(SIDEBAR_SETTLED_VISIBLE_KEY));
    return Number.isFinite(value) && value > 0 ? value : INITIAL_SETTLED_VISIBLE_COUNT;
  } catch {
    return INITIAL_SETTLED_VISIBLE_COUNT;
  }
}

function setSettledVisibleCount(value) {
  settledVisibleCount = Math.max(INITIAL_SETTLED_VISIBLE_COUNT, Number(value) || INITIAL_SETTLED_VISIBLE_COUNT);
  try { localStorage.setItem(SIDEBAR_SETTLED_VISIBLE_KEY, String(settledVisibleCount)); }
  catch {}
}

function readSettledThreadNames() {
  try {
    const value = JSON.parse(localStorage.getItem(SIDEBAR_SETTLED_THREADS_KEY) || '[]');
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function writeSettledThreadNames(nextNames) {
  settledThreadNames = nextNames instanceof Set ? nextNames : new Set();
  try { localStorage.setItem(SIDEBAR_SETTLED_THREADS_KEY, JSON.stringify([...settledThreadNames].slice(-500))); }
  catch {}
}

function markThreadSettled(name) {
  if (!name) return;
  const nextNames = new Set(settledThreadNames);
  nextNames.add(name);
  writeSettledThreadNames(nextNames);
  setSettledShelfExpanded(true);
}

function markThreadUnsettled(name) {
  if (!name) return;
  const nextNames = new Set(settledThreadNames);
  nextNames.delete(name);
  writeSettledThreadNames(nextNames);
}

function readSidebarProjectScope() {
  try { return localStorage.getItem(SIDEBAR_PROJECT_SCOPE_KEY) || 'all'; }
  catch { return 'all'; }
}

function setSidebarProjectScope(value) {
  sidebarProjectScope = value || 'all';
  setSettledVisibleCount(INITIAL_SETTLED_VISIBLE_COUNT);
  try { localStorage.setItem(SIDEBAR_PROJECT_SCOPE_KEY, sidebarProjectScope); }
  catch {}
}

function cleanProjectValue(value) {
  return String(value || '').trim().replace(/[\\/]+$/, '');
}

function folderLabel(value) {
  const text = cleanProjectValue(value);
  return text.split(/[\\/]+/).filter(Boolean).pop() || text || 'workspace';
}

function sidebarProjectIcon(label) {
  return projectIconSvg(label, 'sidebar-thread-favicon project-line-icon');
}

function looksLikeLocalPath(value) {
  return /^(~|\/|[A-Za-z]:[\\/]|\\\\)/.test(String(value || '').trim());
}

function projectFromScopeValue(value, label = folderLabel(value)) {
  const cleanValue = cleanProjectValue(value);
  if (!cleanValue) return null;
  const local = looksLikeLocalPath(cleanValue);
  return {
    kind: local ? 'local' : 'git',
    value: cleanValue,
    label: label || folderLabel(cleanValue),
    repoSource: local ? '' : 'github',
    branch: 'main',
  };
}

function writeSelectedProject(project) {
  if (!project?.value) return;
  localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
}

function cachedGlobalSidebarThreads() {
  try {
    const payload = JSON.parse(localStorage.getItem(GLOBAL_SIDEBAR_THREADS_CACHE_KEY) || 'null');
    return Array.isArray(payload?.threads) ? payload.threads : [];
  } catch {
    return [];
  }
}

function cacheableGlobalSidebarThread(thread = {}) {
  return {
    name: thread.name,
    title: thread.title,
    status: thread.status,
    runStatus: thread.runStatus,
    warning: thread.warning,
    latestActivity: thread.latestActivity,
    finalAnswerSummary: thread.finalAnswerSummary,
    repoPath: thread.repoPath,
    repoUrl: thread.repoUrl,
    provider: thread.provider,
    localMode: thread.localMode,
    branch: thread.branch,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    startedAt: thread.startedAt,
    endedAt: thread.endedAt,
    completedAt: thread.completedAt,
    runEndedAtMs: thread.runEndedAtMs,
  };
}

function cacheGlobalSidebarThreads(threads) {
  try {
    const safeThreads = Array.isArray(threads) ? threads.map(cacheableGlobalSidebarThread) : [];
    localStorage.setItem(GLOBAL_SIDEBAR_THREADS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), threads: safeThreads }));
  } catch {}
}

function renderCachedGlobalSidebar() {
  const threads = cachedGlobalSidebarThreads();
  if (!threads.length) return false;
  renderGlobalSidebar(threads);
  return true;
}

function threadUrl(name) {
  return `/thread.html?name=${encodeURIComponent(name)}`;
}

function currentThreadName() {
  return new URLSearchParams(location.search).get('name') || '';
}

function effectiveThreadStatus(thread) {
  const runStatus = String(thread?.runStatus || '').toLowerCase();
  return runStatus && runStatus !== 'unknown' ? runStatus : String(thread?.status || '').toLowerCase();
}

function statusClass(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'unknown';
}

function isActiveThread(thread) {
  return ['launching', 'starting', 'queued', 'running'].includes(effectiveThreadStatus(thread));
}

function formatDurationSeconds(totalSeconds, showSeconds = false) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  if (showSeconds && minutes < 60) return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (showSeconds && hours < 24) return `${hours}h ${minutes % 60}m ${seconds}s`;
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatElapsed(startValue, endValue = Date.now(), showSeconds = false) {
  const start = Date.parse(startValue || '');
  const end = typeof endValue === 'number' ? endValue : Date.parse(endValue || '');
  if (Number.isNaN(start) || Number.isNaN(end)) return '';
  return formatDurationSeconds(Math.floor(Math.max(0, end - start) / 1000), showSeconds);
}

function finishedAt(thread) {
  const runEndedAtMs = Number(thread?.runEndedAtMs);
  if (Number.isFinite(runEndedAtMs) && runEndedAtMs > 0) return new Date(runEndedAtMs).toISOString();
  return thread?.endedAt || thread?.completedAt || thread?.updatedAt || thread?.createdAt || '';
}

function finishedAtMs(thread) {
  const parsed = Date.parse(finishedAt(thread));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function finishedIndicatorKey(thread, rawStatus) {
  return `${thread?.name || ''}|${rawStatus || ''}|${finishedAtMs(thread) || ''}`;
}

function formatFinishedAgo(value) {
  const elapsed = formatElapsed(value).replace(/m\b/g, ' min');
  return elapsed ? `finished ${elapsed} ago` : '';
}

function finalAnswerSummary(thread, maxLength = 160) {
  const text = String(thread?.finalAnswerSummary || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}...` : text;
}

function finishedOutcome(thread, rawStatus) {
  const summary = finalAnswerSummary(thread, 150);
  if (summary) return summary;
  const warning = String(thread?.warning || '').replace(/\s+/g, ' ').trim();
  if (warning) return `status: ${warning}`;
  return '';
}

function sortedSetSignature(values) {
  return [...values].sort().join('\n');
}

function sidebarThreadRenderSignature(thread) {
  return [
    thread?.name,
    thread?.title,
    effectiveThreadStatus(thread),
    thread?.status,
    thread?.runStatus,
    thread?.warning,
    thread?.latestActivity,
    thread?.finalAnswerSummary,
    thread?.repoPath,
    thread?.repoUrl,
    thread?.branch,
    runtimeStart(thread),
    finishedAt(thread),
    thread?.updatedAt,
  ].map((value) => String(value ?? '')).join('\t');
}

function sidebarRenderSignature(threads) {
  return JSON.stringify({
    search: agentSearchQuery(),
    scope: sidebarProjectScope || 'all',
    expanded: settledShelfExpanded,
    visible: settledVisibleCount,
    settled: sortedSetSignature(settledThreadNames),
    selected: sortedSetSignature(selectedSidebarThreadNames),
    seen: sortedSetSignature(seenFinishedThreads),
    current: currentThreadName(),
    threads: threads.map(sidebarThreadRenderSignature),
  });
}

function runningActivity(thread, rawStatus = effectiveThreadStatus(thread)) {
  const activity = String(thread?.latestActivity || thread?.warning || '').trim();
  if (activity) return activity;
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'queued') return 'waiting for main agent';
  if (status === 'launching' || status === 'starting') return 'starting main agent';
  return status === 'running' ? 'working' : status || 'working';
}

function agentSearchQuery() {
  return String(agentSearchInput?.value || '').trim().toLowerCase();
}

function sidebarThreadProjectLabel(thread) {
  return folderLabel(thread?.repoPath || thread?.repoUrl || '');
}

function sidebarThreadProjectKey(thread) {
  return cleanProjectValue(thread?.repoPath || thread?.repoUrl || '');
}

function sidebarProjects(threads) {
  const projects = new Map();
  for (const thread of threads) {
    const key = sidebarThreadProjectKey(thread);
    if (!key) continue;
    const current = projects.get(key) || { key, label: sidebarThreadProjectLabel(thread), count: 0 };
    current.count += 1;
    projects.set(key, current);
  }
  return [...projects.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function selectedScopeProject() {
  if (!sidebarProjectScope || sidebarProjectScope === 'all') return null;
  const project = sidebarProjects(sidebarThreads).find((entry) => entry.key === sidebarProjectScope);
  return projectFromScopeValue(sidebarProjectScope, project?.label);
}

function scopedAgentThreads(threads) {
  if (!sidebarProjectScope || sidebarProjectScope === 'all') return threads;
  return threads.filter((thread) => sidebarThreadProjectKey(thread) === sidebarProjectScope);
}

function updateProjectScopeMenu(threads) {
  const projects = sidebarProjects(threads);
  if (sidebarProjectScope !== 'all' && !projects.some((project) => project.key === sidebarProjectScope)) {
    setSidebarProjectScope('all');
  }
  const currentProject = projects.find((project) => project.key === sidebarProjectScope);
  const label = document.querySelector('#sidebar-project-scope-label');
  const count = document.querySelector('#sidebar-project-scope-count');
  const menu = document.querySelector('#sidebar-project-scope-menu');
  const toggle = document.querySelector('#sidebar-project-scope');
  if (label) label.textContent = currentProject?.label || 'All projects';
  if (count) {
    count.hidden = sidebarProjectScope === 'all';
    count.textContent = currentProject ? String(currentProject.count) : '';
  }
  if (toggle) toggle.disabled = projects.length < 1;
  if (!menu) return;
  const options = [
    { key: 'all', label: 'All projects', count: threads.length },
    ...projects,
  ];
  menu.innerHTML = options.map((project) => `
    <button class="sidebar-scope-option" type="button" role="menuitemradio" aria-checked="${project.key === sidebarProjectScope ? 'true' : 'false'}" data-sidebar-scope-option="${escapeHtml(project.key)}">
      ${sidebarProjectIcon(project.label)}
      <span>${escapeHtml(project.label)}</span>
      <small>${project.count}</small>
    </button>
  `).join('');
}

function agentSearchText(thread) {
  const rawStatus = effectiveThreadStatus(thread) || 'unknown';
  return [
    thread?.title,
    thread?.name,
    rawStatus,
    sidebarThreadProjectLabel(thread),
    isActiveThread(thread) ? runningActivity(thread, rawStatus) : finishedOutcome(thread, rawStatus),
  ].join(' ').toLowerCase();
}

function filterAgentThreads(threads) {
  const query = agentSearchQuery();
  if (!query) return threads;
  return threads.filter((thread) => agentSearchText(thread).includes(query));
}

function canSettleThread(thread) {
  return !isActiveThread(thread) && SETTLEABLE_THREAD_STATUSES.includes(effectiveThreadStatus(thread));
}

function isSettledThread(thread) {
  return canSettleThread(thread) && settledThreadNames.has(thread?.name);
}

function isSidebarThreadSelected(thread) {
  return Boolean(thread?.name && selectedSidebarThreadNames.has(thread.name));
}

function clearSidebarSelection() {
  selectedSidebarThreadNames = new Set();
  selectionAnchorThreadName = '';
}

function pruneSidebarSelection(renderedThreads) {
  if (!selectedSidebarThreadNames.size) return;
  const visibleNames = new Set(renderedThreads.map((thread) => thread.name).filter(Boolean));
  selectedSidebarThreadNames = new Set([...selectedSidebarThreadNames].filter((name) => visibleNames.has(name)));
  if (selectionAnchorThreadName && !visibleNames.has(selectionAnchorThreadName)) {
    selectionAnchorThreadName = [...selectedSidebarThreadNames][0] || '';
  }
}

function toggleSidebarThreadSelection(name, options = {}) {
  if (!name) return;
  const visibleNames = visibleThreadNames();
  const nextNames = new Set(selectedSidebarThreadNames);
  if (options.range && selectionAnchorThreadName && visibleNames.includes(selectionAnchorThreadName) && visibleNames.includes(name)) {
    const firstIndex = visibleNames.indexOf(selectionAnchorThreadName);
    const secondIndex = visibleNames.indexOf(name);
    const [start, end] = firstIndex < secondIndex ? [firstIndex, secondIndex] : [secondIndex, firstIndex];
    for (const threadName of visibleNames.slice(start, end + 1)) nextNames.add(threadName);
  } else if (nextNames.has(name)) {
    nextNames.delete(name);
    selectionAnchorThreadName = nextNames.size ? [...nextNames][nextNames.size - 1] : '';
  } else {
    nextNames.add(name);
    selectionAnchorThreadName = name;
  }
  selectedSidebarThreadNames = nextNames;
}

function selectVisibleSettleableThreads(threads) {
  const names = threads
    .filter((thread) => canSettleThread(thread) && !isSettledThread(thread))
    .map((thread) => thread.name)
    .filter(Boolean);
  selectedSidebarThreadNames = new Set(names);
  selectionAnchorThreadName = names[0] || '';
}

function selectedVisibleThreads() {
  const visibleNames = new Set(renderedSidebarThreadNames);
  return [...selectedSidebarThreadNames]
    .map(threadByName)
    .filter((thread) => thread?.name && visibleNames.has(thread.name));
}

function selectedSettleableThreads() {
  return selectedVisibleThreads().filter((thread) => canSettleThread(thread) && !isSettledThread(thread));
}

function settleSelectedSidebarThreads() {
  const threads = selectedSettleableThreads();
  if (!threads.length) return 0;
  const nextNames = new Set(settledThreadNames);
  for (const thread of threads) nextNames.add(thread.name);
  writeSettledThreadNames(nextNames);
  setSettledShelfExpanded(true);
  clearSidebarSelection();
  return threads.length;
}

function renderSidebarBatchBar() {
  const selectedThreads = selectedVisibleThreads();
  if (!selectedThreads.length) return '';
  const settleableCount = selectedThreads.filter((thread) => canSettleThread(thread) && !isSettledThread(thread)).length;
  const settleLabel = settleableCount > 0 ? `Archive ${settleableCount}` : 'Archive';
  return `
    <div class="sidebar-batch-bar" role="toolbar" aria-label="Selected agents">
      <span>${selectedThreads.length} selected</span>
      <button class="textbtn sidebar-batch-action" type="button" data-sidebar-batch-settle${settleableCount ? '' : ' disabled'}>${escapeHtml(settleLabel)}</button>
      <button class="textbtn sidebar-batch-action" type="button" data-sidebar-selection-clear>Clear</button>
    </div>
  `;
}

function renderSidebarSelectButton(thread, selected) {
  const title = thread?.title || thread?.name || 'agent';
  return `<button class="sidebar-thread-select" type="button" data-sidebar-thread-select="${escapeHtml(thread.name)}" aria-pressed="${selected ? 'true' : 'false'}" aria-label="${selected ? 'Deselect' : 'Select'} ${escapeHtml(title)}"><span aria-hidden="true"></span></button>`;
}

function canDismissFinishedIndicator(rawStatus, active) {
  return !active && ['completed', 'ready'].includes(rawStatus);
}

function hasFreshFinishedIndicator(thread) {
  const rawStatus = effectiveThreadStatus(thread) || 'unknown';
  return isSettledThread(thread) && canDismissFinishedIndicator(rawStatus, isActiveThread(thread)) && !seenFinishedThreads.has(finishedIndicatorKey(thread, rawStatus));
}

function runtimeStart(thread) {
  return thread.startedAt || thread.createdAt || thread.updatedAt || '';
}

function threadInboxTimeMs(thread) {
  const active = isActiveThread(thread);
  const value = active
    ? thread?.updatedAt || thread?.createdAt || ''
    : finishedAt(thread) || thread?.updatedAt || thread?.createdAt || '';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortThreadInbox(left, right) {
  const leftActive = isActiveThread(left);
  const rightActive = isActiveThread(right);
  if (leftActive !== rightActive) return leftActive ? -1 : 1;
  return threadInboxTimeMs(right) - threadInboxTimeMs(left);
}

function sidebarDurationLabel(value) {
  const compact = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^finished\s+/i, '')
    .replace(/\s+ago$/i, '')
    .replace(/^ran\s+/i, '')
    .replace(/\b(\d+)\s+hour(s)?\b/g, '$1h')
    .replace(/\b(\d+)\s+min(ute)?(s)?\b/g, '$1m')
    .replace(/\b(\d+)\s+sec(ond)?(s)?\b/g, '$1s')
    .trim();
  return compact.replace(/\b(\d+m)\s+\d+s\b/g, '$1');
}

function sidebarStatusLabel(rawStatus) {
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'running' || status === 'starting' || status === 'launching') return 'Working';
  if (status === 'queued') return 'Queued';
  if (status === 'failed') return 'Failed';
  return status.replace(/[-_]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function renderThreadCard(thread, jumpLabel = '') {
  const rawStatus = effectiveThreadStatus(thread) || 'unknown';
  const badgeClass = statusClass(rawStatus);
  const running = isActiveThread(thread);
  const settled = isSettledThread(thread);
  const cardMode = !settled;
  const modeClass = cardMode ? 'active-work' : 'settled-work';
  const finishedValue = finishedAt(thread);
  const finished = running ? '' : sidebarDurationLabel(formatFinishedAgo(finishedValue));
  const detail = running ? runningActivity(thread, rawStatus) : '';
  const outcome = running ? '' : finishedOutcome(thread, rawStatus);
  const start = runtimeStart(thread);
  const runtimeEnd = running ? Date.now() : finishedValue || start;
  const runtime = formatElapsed(start, runtimeEnd);
  const inactiveTimes = !running ? [finished].filter(Boolean) : [];
  const inactiveMeta = inactiveTimes.length ? `<span class="finished-meta">${inactiveTimes.map((text) => `<time>${escapeHtml(text)}</time>`).join('')}</span>` : '';
  const statusLabel = sidebarStatusLabel(rawStatus);
  const runtimeLabel = sidebarDurationLabel(runtime);
  const activeMeta = thread.branch || detail || outcome;
  const activeRuntime = runtime
    ? `<time class="runtime-label" data-runtime-start="${escapeHtml(start)}" data-runtime-status="${escapeHtml(statusLabel)}" aria-label="${escapeHtml(`${statusLabel} ${runtimeLabel}`)}">${escapeHtml(runtimeLabel)}</time>`
    : '';
  const indicatorKey = settled && canDismissFinishedIndicator(rawStatus, running) ? finishedIndicatorKey(thread, rawStatus) : '';
  const indicatorSeen = indicatorKey && seenFinishedThreads.has(indicatorKey);
  const indicatorAttrs = indicatorKey && !indicatorSeen
    ? `role="button" tabindex="0" aria-label="hide finished indicator" title="hide finished indicator" data-finished-indicator="${escapeHtml(indicatorKey)}"`
    : 'aria-hidden="true"';
  const displayTitle = thread.title || thread.name;
  const projectLabelText = sidebarThreadProjectLabel(thread);
  const projectKeyText = sidebarThreadProjectKey(thread);
  const current = thread.name && thread.name === currentThreadName();
  const settleButton = canSettleThread(thread) && !settled
    ? `<button class="textbtn archive-thread" type="button" data-settle-thread="${escapeHtml(thread.name)}" aria-label="Archive thread">archive</button>`
    : '';
  const unsettleButton = settled
    ? `<button class="textbtn archive-thread" type="button" data-unsettle-thread="${escapeHtml(thread.name)}" aria-label="Unarchive thread">unarchive</button>`
    : '';
  const stopButton = running
    ? `<button class="textbtn stop-thread" type="button" data-stop-thread="${escapeHtml(thread.name)}">stop</button>`
    : '';
  const selected = isSidebarThreadSelected(thread);
  const selectButton = renderSidebarSelectButton(thread, selected);
  const linkAttrs = `href="${escapeHtml(threadUrl(thread.name))}"${current ? ' aria-current="page"' : ''}${indicatorKey ? ` data-finished-thread="${escapeHtml(indicatorKey)}"` : ''}`;
  const activeBody = `
    <a class="inbox-main" ${linkAttrs}>
      <span class="sidebar-thread-project-row">
        ${sidebarProjectIcon(projectLabelText)}
        <span class="sidebar-thread-project">${escapeHtml(projectLabelText)}</span>
        <span class="sidebar-thread-status">${activeRuntime}</span>
      </span>
      <span class="sidebar-thread-title-row"><strong>${escapeHtml(displayTitle)}</strong></span>
      <span class="sidebar-thread-meta-row">
        ${activeMeta ? `<small class="thread-activity">${escapeHtml(activeMeta)}</small>` : '<small></small>'}
      </span>
    </a>
    <span class="inbox-side">${selectButton}${stopButton}${settleButton}</span>
  `;
  const settledBody = `
    <a class="inbox-main" ${linkAttrs}>
      ${sidebarProjectIcon(projectLabelText)}
      <span class="sidebar-thread-title-row"><strong>${escapeHtml(displayTitle)}</strong></span>
      ${inactiveMeta}
    </a>
    <span class="inbox-side">${selectButton}${unsettleButton}</span>
    ${outcome ? `<small class="answer-preview">${escapeHtml(outcome)}</small>` : ''}
  `;
  return `
    <div class="inbox-item action-thread sidebar-thread ${modeClass} ${badgeClass}${current ? ' is-current' : ''}${selected ? ' is-selected' : ''}" data-sidebar-thread-row data-thread-name="${escapeHtml(thread.name)}" data-thread-project-key="${escapeHtml(projectKeyText)}" aria-selected="${selected ? 'true' : 'false'}"${jumpLabel ? ` data-jump-index="${escapeHtml(jumpLabel)}"` : ''}>
      <span class="status-dot${indicatorSeen ? ' is-seen' : ''}" ${indicatorAttrs}></span>
      ${cardMode ? activeBody : settledBody}
      ${jumpLabel ? `<span class="jump-hint" aria-hidden="true">${escapeHtml(jumpLabel)}</span>` : ''}
    </div>
  `;
}

function currentThreadsListNode() {
  threadsList = document.querySelector('#threads-list');
  return threadsList;
}

function updateRuntimeLabels() {
  const list = currentThreadsListNode();
  const labels = list?.querySelectorAll('[data-runtime-start]') || [];
  for (const label of labels) {
    const status = label.dataset.runtimeStatus || 'running';
    const duration = sidebarDurationLabel(formatElapsed(label.dataset.runtimeStart, Date.now()));
    label.textContent = duration;
    label.setAttribute('aria-label', `${status} ${duration}`);
  }
  if (!labels.length && runtimeTickTimer) {
    clearInterval(runtimeTickTimer);
    runtimeTickTimer = null;
  }
}

function syncRuntimeTick() {
  const list = currentThreadsListNode();
  const hasActiveRuntime = Boolean(list?.querySelector('[data-runtime-start]'));
  if (hasActiveRuntime && !runtimeTickTimer) {
    runtimeTickTimer = setInterval(updateRuntimeLabels, SIDEBAR_RUNTIME_TICK_MS);
  } else if (!hasActiveRuntime && runtimeTickTimer) {
    clearInterval(runtimeTickTimer);
    runtimeTickTimer = null;
  }
}

function updateFinishedIndicatorCount() {
  const list = currentThreadsListNode();
  const badge = list?.querySelector('[data-finished-indicator-count]');
  if (!badge) return;
  const count = list.querySelectorAll('[data-finished-indicator]').length;
  badge.hidden = count < 1;
  badge.textContent = `${count} new`;
}

function dismissFinishedIndicator(indicator) {
  rememberSeenFinishedThread(indicator.dataset.finishedIndicator);
  indicator.classList.add('is-seen');
  for (const attribute of FINISHED_INDICATOR_RESET_ATTRIBUTES) {
    indicator.removeAttribute(attribute);
  }
  indicator.setAttribute('aria-hidden', 'true');
  updateFinishedIndicatorCount();
}

function renderGlobalSidebar(threads = sidebarThreads) {
  seenFinishedThreads = readSeenFinishedThreads();
  settledThreadNames = readSettledThreadNames();
  sidebarThreads = Array.isArray(threads) ? threads : [];
  updateProjectScopeMenu(sidebarThreads);
  const scopedThreads = scopedAgentThreads(sidebarThreads);
  const filteredThreads = filterAgentThreads(scopedThreads);
  const searchActive = Boolean(agentSearchQuery());
  const inboxThreads = [...filteredThreads].sort(sortThreadInbox);
  const activeThreads = inboxThreads.filter((thread) => !isSettledThread(thread));
  const settledThreads = inboxThreads.filter(isSettledThread);
  const renderedSettledThreads = searchActive
    ? settledThreads
    : settledShelfExpanded
      ? settledThreads.slice(0, settledVisibleCount)
      : [];
  const currentSettledThread = !searchActive && !settledShelfExpanded && currentThreadName()
    ? settledThreads.find((thread) => thread.name === currentThreadName())
    : null;
  if (currentSettledThread && !renderedSettledThreads.some((thread) => thread.name === currentSettledThread.name)) {
    renderedSettledThreads.push(currentSettledThread);
  }
  const hiddenSettledCount = Math.max(0, settledThreads.length - renderedSettledThreads.length);
  const renderedThreads = [...activeThreads, ...renderedSettledThreads];
  pruneSidebarSelection(renderedThreads);

  const freshFinishedCount = settledThreads.filter(hasFreshFinishedIndicator).length;
  const list = currentThreadsListNode();
  if (!list) {
    syncRuntimeTick();
    return;
  }
  const renderSignature = sidebarRenderSignature(sidebarThreads);
  if (list === lastSidebarRenderList && renderSignature === lastSidebarRenderSignature) {
    updateRuntimeLabels();
    updateFinishedIndicatorCount();
    syncRuntimeTick();
    return;
  }
  lastSidebarRenderSignature = renderSignature;
  lastSidebarRenderList = list;
  list.classList.toggle('has-sidebar-selection', selectedSidebarThreadNames.size > 0);

  renderedSidebarThreadNames = renderedThreads.map((thread) => thread.name).filter(Boolean);
  const jumpLabels = new Map(renderedSidebarThreadNames.slice(0, 9).map((name, index) => [name, String(index + 1)]));
  const renderJumpThreadCard = (thread) => renderThreadCard(thread, jumpLabels.get(thread.name) || '');
  const batchBar = renderSidebarBatchBar();
  const selectableActiveCount = activeThreads.filter((thread) => canSettleThread(thread) && !isSettledThread(thread)).length;
  const selectActiveButton = selectableActiveCount
    ? `<button class="textbtn lane-select" type="button" data-sidebar-select-visible>Select</button>`
    : '';
  const activeSection = activeThreads.length ? `
    <section class="action-lane sidebar-inbox-section sidebar-inbox-active" aria-label="Active work">
      <div class="action-lane-head">
        <h3>Active work</h3>
        <span class="action-lane-tools">${selectActiveButton}<span class="action-count">${activeThreads.length}</span></span>
      </div>
      <div class="action-list sidebar-active-list">${activeThreads.map(renderJumpThreadCard).join('')}</div>
    </section>
  ` : '';
  const freshBadge = freshFinishedCount ? `<span class="fresh-finished-count" data-finished-indicator-count>${freshFinishedCount} new</span>` : '';
  const historyLink = '<a class="textbtn lane-history" href="/history.html">history</a>';
  const settledEmpty = searchActive && !filteredThreads.length
    ? 'No agents match that search.'
    : searchActive
      ? 'No matching archived agents.'
      : sidebarProjectScope !== 'all' && !scopedThreads.length
        ? 'No agents in this project yet.'
      : activeThreads.length
        ? 'No archived agents yet.'
        : 'No agents yet.';
  const settledLabel = settledShelfExpanded ? 'Archived' : `Archived (${settledThreads.length})`;
  const settledSection = `
    <section class="action-lane sidebar-inbox-section sidebar-inbox-settled" aria-label="Archived agents">
      <div class="action-lane-head">
        <button class="settled-shelf-toggle" type="button" data-settled-shelf-toggle aria-expanded="${settledShelfExpanded ? 'true' : 'false'}">
          <span>${escapeHtml(settledLabel)}</span>
          <span class="settled-shelf-chevron" aria-hidden="true">⌄</span>
        </button>
        <span class="action-lane-tools">
          ${freshBadge}<span class="action-count">${settledThreads.length}</span>
          ${historyLink}
        </span>
      </div>
      <div class="action-list sidebar-settled-list">
        ${renderedSettledThreads.length ? renderedSettledThreads.map(renderJumpThreadCard).join('') : settledThreads.length ? '' : `<p class="empty-state">${escapeHtml(settledEmpty)}</p>`}
        ${settledShelfExpanded && hiddenSettledCount > 0 ? `<button class="settled-show-more" type="button" data-settled-show-more><span aria-hidden="true">+</span>Show ${Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} more</button>` : ''}
      </div>
    </section>
  `;
  list.innerHTML = `${batchBar}${activeSection}${settledSection}`;
  updateFinishedIndicatorCount();
  syncRuntimeTick();
}

async function refreshGlobalSidebar() {
  const payload = await fetchJson('/api/threads');
  const threads = payload.threads || [];
  notifyAgentThreads(threads);
  cacheGlobalSidebarThreads(threads);
  renderGlobalSidebar(threads);
}

function setStatus(message) {
  if (statusNode) statusNode.textContent = message;
}

function closeScopeMenu() {
  const toggle = document.querySelector('#sidebar-project-scope');
  const menu = document.querySelector('#sidebar-project-scope-menu');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  if (menu) menu.hidden = true;
}

function openScopeMenu() {
  const toggle = document.querySelector('#sidebar-project-scope');
  const menu = document.querySelector('#sidebar-project-scope-menu');
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
  if (menu) {
    menu.hidden = false;
    menu.querySelector('[aria-checked="true"]')?.focus();
  }
}

function prepareNewThreadFromScope() {
  const project = selectedScopeProject();
  if (project) writeSelectedProject(project);
}

function navigateToThreadName(name) {
  if (!name) return;
  location.href = threadUrl(name);
}

function visibleThreadNames() {
  return [...renderedSidebarThreadNames];
}

function navigateByOffset(offset) {
  const names = visibleThreadNames();
  if (!names.length) return;
  const current = currentThreadName();
  const currentIndex = Math.max(0, names.indexOf(current));
  const nextIndex = (currentIndex + offset + names.length) % names.length;
  navigateToThreadName(names[nextIndex]);
}

function closeThreadMenu() {
  document.querySelector('#sidebar-thread-menu')?.remove();
  contextMenuThreadName = '';
}

function threadByName(name) {
  return sidebarThreads.find((thread) => thread.name === name) || null;
}

function showThreadMenu(thread, position) {
  closeThreadMenu();
  if (!thread?.name) return;
  contextMenuThreadName = thread.name;
  const active = isActiveThread(thread);
  const settled = isSettledThread(thread);
  const canSettle = canSettleThread(thread);
  const menu = document.createElement('div');
  menu.id = 'sidebar-thread-menu';
  menu.className = 'sidebar-thread-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = [
    `<button type="button" role="menuitem" data-thread-menu-action="open">Open<kbd>↵</kbd></button>`,
    `<button type="button" role="menuitem" data-thread-menu-action="new-thread-project">New thread in project</button>`,
    active ? `<button type="button" role="menuitem" data-thread-menu-action="stop">Stop thread</button>` : '',
    canSettle && !settled ? `<button type="button" role="menuitem" data-thread-menu-action="settle">Archive thread</button>` : '',
    settled ? `<button type="button" role="menuitem" data-thread-menu-action="unsettle">Unarchive thread</button>` : '',
    `<button type="button" role="menuitem" data-thread-menu-action="delete" data-danger="true">Delete</button>`,
  ].filter(Boolean).join('');
  document.body.append(menu);
  const left = Math.min(position.x, window.innerWidth - menu.offsetWidth - 8);
  const top = Math.min(position.y, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.querySelector('button')?.focus();
}

async function runThreadMenuAction(action, thread) {
  if (!thread?.name) return;
  if (action === 'open') {
    navigateToThreadName(thread.name);
    return;
  }
  if (action === 'new-thread-project') {
    const project = projectFromScopeValue(sidebarThreadProjectKey(thread), sidebarThreadProjectLabel(thread));
    if (project) writeSelectedProject(project);
    openSidebarPromptLightbox();
    return;
  }
  if (action === 'stop') {
    await fetchJson(`/api/threads/${encodeURIComponent(thread.name)}/stop`, { method: 'POST' });
    await refreshGlobalSidebar();
    return;
  }
  if (action === 'settle') {
    markThreadSettled(thread.name);
    renderGlobalSidebar(sidebarThreads);
    return;
  }
  if (action === 'unsettle') {
    markThreadUnsettled(thread.name);
    renderGlobalSidebar(sidebarThreads);
    return;
  }
  if (action === 'delete') {
    if (!confirm(`Delete "${thread.title || thread.name}"?`)) return;
    await fetchJson(`/api/threads/${encodeURIComponent(thread.name)}/delete`, { method: 'POST' });
    await refreshGlobalSidebar();
  }
}

function bindGlobalSidebarEvents() {
  document.addEventListener('input', (event) => {
    if (event.target?.matches?.('#agent-search')) {
      setSettledVisibleCount(INITIAL_SETTLED_VISIBLE_COUNT);
      renderGlobalSidebar(sidebarThreads);
    }
  });

  document.addEventListener('click', async (event) => {
    const newThread = event.target?.closest?.('[data-sidebar-new-thread]');
    if (newThread) {
      event.preventDefault();
      prepareNewThreadFromScope();
      closeScopeMenu();
      openSidebarPromptLightbox();
      return;
    }

    const menuAction = event.target?.closest?.('[data-thread-menu-action]');
    if (menuAction) {
      const thread = threadByName(contextMenuThreadName);
      const action = menuAction.dataset.threadMenuAction;
      closeThreadMenu();
      try {
        await runThreadMenuAction(action, thread);
      } catch (error) {
        setStatus(error.message);
      }
      return;
    }

    if (!event.target?.closest?.('#sidebar-thread-menu')) closeThreadMenu();

    const scopeToggle = event.target?.closest?.('[data-sidebar-scope-toggle]');
    if (scopeToggle) {
      const expanded = scopeToggle.getAttribute('aria-expanded') === 'true';
      if (expanded) closeScopeMenu();
      else openScopeMenu();
      return;
    }

    const scopeOption = event.target?.closest?.('[data-sidebar-scope-option]');
    if (scopeOption) {
      setSidebarProjectScope(scopeOption.dataset.sidebarScopeOption || 'all');
      closeScopeMenu();
      document.querySelector('#sidebar-project-scope')?.focus();
      renderGlobalSidebar(sidebarThreads);
      return;
    }

    if (!event.target?.closest?.('.sidebar-command-row')) closeScopeMenu();

    const showMore = event.target?.closest?.('[data-settled-show-more]');
    if (showMore) {
      setSettledVisibleCount(settledVisibleCount + SETTLED_TAIL_PAGE_COUNT);
      renderGlobalSidebar(sidebarThreads);
      return;
    }

    const toggle = event.target?.closest?.('[data-settled-shelf-toggle]');
    if (toggle) {
      setSettledShelfExpanded(!settledShelfExpanded);
      renderGlobalSidebar(sidebarThreads);
      return;
    }

    if (!event.target?.closest?.('#threads-list')) return;

    const selectVisible = event.target.closest('[data-sidebar-select-visible]');
    if (selectVisible) {
      selectVisibleSettleableThreads(sidebarThreads.filter((thread) => renderedSidebarThreadNames.includes(thread.name)));
      renderGlobalSidebar(sidebarThreads);
      return;
    }

    const batchSettle = event.target.closest('[data-sidebar-batch-settle]');
    if (batchSettle) {
      const count = settleSelectedSidebarThreads();
      renderGlobalSidebar(sidebarThreads);
      if (count > 0) setStatus(`Archived ${count} agent${count === 1 ? '' : 's'}.`);
      return;
    }

    const selectionClear = event.target.closest('[data-sidebar-selection-clear]');
    if (selectionClear) {
      clearSidebarSelection();
      renderGlobalSidebar(sidebarThreads);
      return;
    }

    const indicator = event.target.closest('[data-finished-indicator]');
    if (indicator) {
      event.preventDefault();
      dismissFinishedIndicator(indicator);
      return;
    }

    const finishedLink = event.target.closest('[data-finished-thread]');
    if (finishedLink) rememberSeenFinishedThread(finishedLink.dataset.finishedThread);

    const stopButton = event.target.closest('[data-stop-thread]');
    if (stopButton) {
      stopButton.disabled = true;
      stopButton.textContent = 'stopping...';
      try {
        await fetchJson(`/api/threads/${encodeURIComponent(stopButton.dataset.stopThread)}/stop`, { method: 'POST' });
        await refreshGlobalSidebar();
      } catch (error) {
        stopButton.disabled = false;
        stopButton.textContent = 'stop';
        setStatus(error.message);
      }
      return;
    }

    const selectionButton = event.target.closest('[data-sidebar-thread-select]');
    if (selectionButton) {
      event.preventDefault();
      toggleSidebarThreadSelection(selectionButton.dataset.sidebarThreadSelect, { range: event.shiftKey });
      renderGlobalSidebar(sidebarThreads);
      return;
    }

    const settleButton = event.target.closest('[data-settle-thread]');
    if (settleButton) {
      markThreadSettled(settleButton.dataset.settleThread);
      selectedSidebarThreadNames.delete(settleButton.dataset.settleThread);
      renderGlobalSidebar(sidebarThreads);
      return;
    }

    const unsettleButton = event.target.closest('[data-unsettle-thread]');
    if (unsettleButton) {
      markThreadUnsettled(unsettleButton.dataset.unsettleThread);
      selectedSidebarThreadNames.delete(unsettleButton.dataset.unsettleThread);
      renderGlobalSidebar(sidebarThreads);
      return;
    }

    const row = event.target?.closest?.('[data-sidebar-thread-row]');
    if (row && (event.metaKey || event.ctrlKey || event.shiftKey)) {
      event.preventDefault();
      toggleSidebarThreadSelection(row.dataset.threadName, { range: event.shiftKey });
      renderGlobalSidebar(sidebarThreads);
    }
  });

  document.addEventListener('contextmenu', (event) => {
    const row = event.target?.closest?.('[data-sidebar-thread-row]');
    if (!row) return;
    const thread = threadByName(row.dataset.threadName);
    if (!thread) return;
    event.preventDefault();
    showThreadMenu(thread, { x: event.clientX, y: event.clientY });
  });

  document.addEventListener('keydown', (event) => {
    const isCommand = event.metaKey || event.ctrlKey;
    if (isCommand && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      closeScopeMenu();
      closeThreadMenu();
      agentSearchInput?.focus();
      agentSearchInput?.select();
      return;
    }
    if (isCommand && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      prepareNewThreadFromScope();
      location.href = '/workspace.html';
      return;
    }
    if (isCommand && /^[1-9]$/.test(event.key)) {
      const name = visibleThreadNames()[Number(event.key) - 1];
      if (name) {
        event.preventDefault();
        navigateToThreadName(name);
      }
      return;
    }
    if (isCommand && event.key === ']') {
      event.preventDefault();
      navigateByOffset(1);
      return;
    }
    if (isCommand && event.key === '[') {
      event.preventDefault();
      navigateByOffset(-1);
      return;
    }
    if (event.key === 'Meta' || event.key === 'Control') document.body.classList.add('sidebar-jump-hints');

    const scopeMenu = event.target?.closest?.('#sidebar-project-scope-menu');
    if (scopeMenu) {
      const options = [...scopeMenu.querySelectorAll('[data-sidebar-scope-option]')];
      const index = options.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        closeScopeMenu();
        document.querySelector('#sidebar-project-scope')?.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
        options[(next + options.length) % options.length]?.focus();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        document.activeElement?.click?.();
        return;
      }
    }

    if (event.target?.matches?.('#sidebar-project-scope') && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openScopeMenu();
      return;
    }
    if (event.key === 'Escape') {
      if (document.querySelector('#sidebar-thread-menu')) {
        event.preventDefault();
        closeThreadMenu();
        return;
      }
      if (selectedSidebarThreadNames.size > 0) {
        event.preventDefault();
        clearSidebarSelection();
        renderGlobalSidebar(sidebarThreads);
        return;
      }
      if (document.querySelector('#sidebar-project-scope')?.getAttribute('aria-expanded') === 'true') {
        event.preventDefault();
        closeScopeMenu();
        document.querySelector('#sidebar-project-scope')?.focus();
        return;
      }
      if (event.target?.matches?.('#agent-search') && agentSearchInput?.value) {
        event.preventDefault();
        agentSearchInput.value = '';
        setSettledVisibleCount(INITIAL_SETTLED_VISIBLE_COUNT);
        renderGlobalSidebar(sidebarThreads);
        return;
      }
    }

    if (!event.target?.closest?.('#threads-list')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const indicator = event.target.closest('[data-finished-indicator]');
    if (!indicator) return;
    event.preventDefault();
    dismissFinishedIndicator(indicator);
  });

  document.addEventListener('keyup', (event) => {
    if (event.key === 'Meta' || event.key === 'Control') document.body.classList.remove('sidebar-jump-hints');
  });
}

export function startGlobalSidebar(options = {}) {
  if (started) return;
  threadsList = document.querySelector('#threads-list');
  agentSearchInput = document.querySelector('#agent-search');
  statusNode = options.statusNode || null;
  if (!threadsList || !agentSearchInput) return;
  started = true;
  if (!renderCachedGlobalSidebar()) renderGlobalSidebar();
  bindSidebarPromptLightbox({ fetchJson, makeThreadUrl: threadUrl });
  bindGlobalSidebarEvents();
  refreshGlobalSidebar().catch((error) => setStatus(error.message));
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    refreshGlobalSidebar().catch(() => {});
  }, SIDEBAR_POLL_INTERVAL_MS);
}
