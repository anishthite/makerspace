import { toast } from 'sonner';

const BROWSER_SESSION_KEY = 'spannerBrowserSession';
const PROJECT_KEY = 'spannerSelectedProject';

function migrateStorageKey(legacyKey, nextKey) {
  try {
    if (localStorage.getItem(nextKey) === null) {
      const value = localStorage.getItem(legacyKey);
      if (value !== null) localStorage.setItem(nextKey, value);
    }
    localStorage.removeItem(legacyKey);
  } catch {}
}

migrateStorageKey('workbenchBrowserSession', BROWSER_SESSION_KEY);
migrateStorageKey('workbenchSelectedProject', PROJECT_KEY);

const ACTIVE_THREAD_STATUSES = ['launching', 'starting', 'queued', 'running'];
const FINISHED_THREAD_STATUSES = ['completed', 'ready', 'failed'];
const API_BASE = String(import.meta.env?.VITE_SPANNER_API_BASE || '').trim().replace(/\/+$/, '');

let loadedThreadSnapshot = false;
let knownThreadStatuses = new Map();
let watcherStarted = false;
const notifiedFinishToasts = new Set();

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

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: authHeaders(),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function readSelectedProject() {
  try {
    const project = JSON.parse(localStorage.getItem(PROJECT_KEY) || 'null');
    return project?.value ? project : null;
  } catch {
    return null;
  }
}

function cleanProjectValue(value) {
  return String(value || '').trim().replace(/[\\/]+$/, '');
}

function normalizeRepoUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^[\w.-]+\/[\w.-]+(?:\.git)?$/i.test(text)) return `https://github.com/${text.replace(/\.git$/i, '')}.git`;
  if (/^github\.com\//i.test(text)) return `https://${text.replace(/\.git$/i, '')}.git`;
  return text;
}

function canonicalRepo(value) {
  return normalizeRepoUrl(value).replace(/\.git$/i, '').toLowerCase();
}

function sameSelectedProject(thread) {
  const project = readSelectedProject();
  if (!project?.value) return true;
  if (project.kind === 'local') return cleanProjectValue(thread?.repoPath) === cleanProjectValue(project.value);
  return canonicalRepo(thread?.repoUrl) === canonicalRepo(project.value);
}

function threadUrl(name) {
  return `/thread.html?${new URLSearchParams({ name })}`;
}

function showAgentToast(title, detail = '', tone = 'success', threadName = '') {
  const options = { duration: tone === 'error' ? Infinity : 8000, description: detail || undefined };
  if (threadName) {
    options.action = {
      label: 'View',
      onClick: () => {
        location.href = threadUrl(threadName);
      },
    };
  }
  if (tone === 'error') toast.error(title, options);
  else toast.success(title, options);
}

function effectiveThreadStatus(thread) {
  const runStatus = String(thread?.runStatus || '').toLowerCase();
  return runStatus && runStatus !== 'unknown' ? runStatus : String(thread?.status || '').toLowerCase();
}

function isActiveThread(thread) {
  return ACTIVE_THREAD_STATUSES.includes(effectiveThreadStatus(thread));
}

function isFinishedThread(thread) {
  return FINISHED_THREAD_STATUSES.includes(effectiveThreadStatus(thread));
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

function finalAnswerSummary(thread, maxLength = 160) {
  const text = String(thread?.finalAnswerSummary || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function finishedOutcome(thread, rawStatus) {
  const summary = finalAnswerSummary(thread, 150);
  if (summary) return summary;
  const warning = String(thread?.warning || '').replace(/\s+/g, ' ').trim();
  if (warning) return `status: ${warning}`;
  const status = String(rawStatus || '').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return status ? `status: ${status}` : '';
}

function notifyFinishedThreads(threads) {
  const nextStatuses = new Map();
  for (const thread of threads.filter(sameSelectedProject)) {
    const name = String(thread?.name || '');
    const rawStatus = effectiveThreadStatus(thread) || 'unknown';
    if (name) nextStatuses.set(name, rawStatus);
    const wasActive = isActiveThread({ runStatus: knownThreadStatuses.get(name) });
    if (!loadedThreadSnapshot || !name || !wasActive || isActiveThread(thread) || !isFinishedThread(thread)) continue;
    const key = finishedIndicatorKey(thread, rawStatus);
    if (notifiedFinishToasts.has(key)) continue;
    notifiedFinishToasts.add(key);
    const title = rawStatus === 'failed' ? 'Agent failed' : 'Agent finished';
    const detail = [thread.title || thread.name, finishedOutcome(thread, rawStatus)].filter(Boolean).join(' · ');
    showAgentToast(title, detail, rawStatus === 'failed' ? 'error' : 'success', name);
  }
  knownThreadStatuses = nextStatuses;
  loadedThreadSnapshot = true;
}

async function loadThreadsForToasts() {
  const payload = await fetchJson('/api/threads');
  notifyFinishedThreads(payload.threads || []);
}

export function startAgentToastWatcher() {
  if (watcherStarted) return;
  watcherStarted = true;
  loadThreadsForToasts().catch(() => {});
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    loadThreadsForToasts().catch(() => {});
  }, 10000);
}
