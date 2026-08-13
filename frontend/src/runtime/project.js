import './appearance.js?v=palette-2';

import { captureSpannerEvent } from '../lib/posthog.js';
import { redirectIfAuthRequired } from './auth-redirect.js';
import { notifyAgentThreads } from './agent-toasts.js';
import { projectIconSvg } from './project-icons.js';
import { bindSidebarPromptLightbox, openSidebarPromptLightbox } from './sidebar-prompt-lightbox.js';

const BROWSER_SESSION_KEY = 'spannerBrowserSession';
const PROJECT_KEY = 'spannerSelectedProject';
const RECENT_PROJECTS_KEY = 'spannerRecentProjects';
const SEEN_FINISHED_THREADS_KEY = 'spannerSeenFinishedThreads';
const ONBOARDING_DISMISSED_KEY = 'spannerOnboardingDismissed';
const SIDEBAR_SETTLED_EXPANDED_KEY = 'spannerSidebarSettledExpanded';
const SIDEBAR_SETTLED_VISIBLE_KEY = 'spannerSidebarSettledVisible';
const SIDEBAR_SETTLED_THREADS_KEY = 'spannerSidebarSettledThreads';
const SIDEBAR_PROJECT_SCOPE_KEY = 'spannerSidebarProjectScope';
const GLOBAL_SIDEBAR_THREADS_CACHE_KEY = 'spannerGlobalSidebarThreadsCache';
const INITIAL_REPO_SUGGESTIONS = 12;
const REPO_SUGGESTION_PAGE_SIZE = 24;
const INITIAL_SETTLED_VISIBLE_COUNT = 20;
const SETTLED_TAIL_PAGE_COUNT = 20;
const SETTLEABLE_THREAD_STATUSES = ['completed', 'ready', 'failed'];
const FINISHED_INDICATOR_RESET_ATTRIBUTES = ['role', 'tabindex', 'aria-label', 'title', 'data-finished-indicator'];
const SIDEBAR_POLL_INTERVAL_MS = 30000;
const API_BASE = String(import.meta.env?.VITE_SPANNER_API_BASE || '').trim().replace(/\/+$/, '');

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
migrateStorageKey('workbenchRecentProjects', RECENT_PROJECTS_KEY);
migrateStorageKey('workbenchSeenFinishedThreads', SEEN_FINISHED_THREADS_KEY);

const codexAuthPill = document.querySelector('#codex-auth-pill');
const codexAuthLabel = document.querySelector('#codex-auth-label');
const githubAuthPill = document.querySelector('#github-auth-pill');
const githubAuthLabel = document.querySelector('#github-auth-label');
const githubSigninCard = document.querySelector('#github-signin-card');
const githubSigninButtons = Array.from(document.querySelectorAll('[data-github-signin]'));
const githubSigninCopy = document.querySelector('#github-signin-copy');
const githubSigninStatus = document.querySelector('#github-signin-status');
const projectHero = document.querySelector('#project-hero');
const projectGrid = document.querySelector('#project-grid');
const form = document.querySelector('#project-form');
const repoInput = document.querySelector('#project-repo-url');
const repoSourceInput = document.querySelector('#project-repo-source');
const branchInput = document.querySelector('#project-branch');
const repoOptions = document.querySelector('#project-repo-options');
const repoTray = document.querySelector('#project-repo-tray');
const repoRefresh = document.querySelector('#project-repo-refresh');
const chooseFolder = document.querySelector('#project-choose-folder');
const repoHint = document.querySelector('#project-repo-hint');
const statusLine = document.querySelector('#project-status');
const recentList = document.querySelector('#project-recent-list');
const projectWelcome = document.querySelector('#project-welcome');
const projectSubtitle = document.querySelector('#project-subtitle');
const onboardingDialog = document.querySelector('#onboarding-dialog');
const onboardingClose = document.querySelector('#onboarding-close');
const onboardingActionButtons = Array.from(document.querySelectorAll('[data-onboarding-action]'));
const onboardingPickRepo = document.querySelector('#onboarding-pick-repo');
const agentSearchInput = document.querySelector('#agent-search');
let threadsList = document.querySelector('#threads-list');
let syncedThreadsList = threadsList;
let syncThreadsListScheduled = false;

let providerKind = '';
let githubRepos = [];
let githubRepoRefreshPromise = null;
let selectedRepo = null;
let repoMatches = [];
let activeRepoMatchIndex = -1;
let repoSuggestionLimit = INITIAL_REPO_SUGGESTIONS;
let githubConnected = false;
let codexConfigured = false;
let claudeCodeConfigured = false;
let projectThreadCount = 0;
let recentProjects = [];
let seenFinishedThreads = readSeenFinishedThreads();
let globalSidebarThreads = [];
let settledShelfExpanded = readSettledShelfExpanded();
let settledVisibleCount = readSettledVisibleCount();
let settledThreadNames = readSettledThreadNames();
let sidebarProjectScope = readSidebarProjectScope();
let renderedSidebarThreadNames = [];
let selectedSidebarThreadNames = new Set();
let selectionAnchorThreadName = '';
let contextMenuThreadName = '';
let lastSidebarRenderSignature = '';
let lastSidebarRenderList = null;

function getBrowserSessionId() {
  let sessionId = localStorage.getItem(BROWSER_SESSION_KEY) || '';
  if (!sessionId) {
    sessionId = globalThis.crypto?.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('-');
    localStorage.setItem(BROWSER_SESSION_KEY, sessionId);
  }
  return sessionId;
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

function getApiBase() {
  return API_BASE;
}

function getApiToken() {
  return '';
}

function authHeaders() {
  const headers = { 'x-spanner-session': getBrowserSessionId() };
  const token = getApiToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function apiUrl(path) {
  return `${getApiBase()}${path}`;
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
  if (!response.ok) {
    if (redirectIfAuthRequired(payload, response)) return new Promise(() => {});
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
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
    sourceRepoPath: thread.sourceRepoPath,
    worktreePath: thread.worktreePath,
    worktreeBranch: thread.worktreeBranch,
    localWorktree: thread.localWorktree,
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

function projectLabel(value) {
  const text = cleanProjectValue(value)
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '');
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join('/') || text || 'workspace';
}

function looksLikeLocalPath(value) {
  return /^(~|\/|[A-Za-z]:[\\/]|\\\\)/.test(String(value || '').trim());
}

function repoFullName(repo) {
  return String(repo?.fullName || [repo?.owner, repo?.name].filter(Boolean).join('/') || repo?.name || '').trim();
}

function repoShortName(repo) {
  return String(repo?.name || repoFullName(repo).split('/').pop() || '').trim();
}

function repoVisibility(repo) {
  return repo?.private ? 'private' : 'public';
}

function repoSelectionLabel(repo) {
  return `${repoFullName(repo)} · ${repoVisibility(repo)}`;
}

function normalizeSearch(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/^github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/i, '');
}

function compactSearch(value) {
  return normalizeSearch(value).replace(/[^a-z0-9]+/g, '');
}

function searchTokens(value) {
  return normalizeSearch(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function fuzzyScore(haystack, needle) {
  if (!needle) return 0;
  let cursor = -1;
  let gaps = 0;
  for (const character of needle) {
    const next = haystack.indexOf(character, cursor + 1);
    if (next === -1) return 0;
    gaps += next - cursor - 1;
    cursor = next;
  }
  return Math.max(1, 260 - gaps);
}

function scoreRepo(repo, query) {
  const rawQuery = normalizeSearch(query);
  if (!rawQuery) return 1;

  const fullName = repoFullName(repo).toLowerCase();
  const shortName = repoShortName(repo).toLowerCase();
  const owner = String(repo?.owner || fullName.split('/')[0] || '').toLowerCase();
  const cloneUrl = String(repo?.cloneUrl || '').toLowerCase();
  const normalizedCloneUrl = normalizeSearch(cloneUrl);
  const compactQuery = compactSearch(rawQuery);
  const compactFullName = compactSearch(fullName);
  const compactShortName = compactSearch(shortName);

  if ([fullName, shortName, cloneUrl, normalizedCloneUrl].includes(rawQuery)) return 1000;
  if (shortName.startsWith(rawQuery)) return 930;
  if (fullName.startsWith(rawQuery)) return 900;
  if (compactQuery && compactShortName.startsWith(compactQuery)) return 860;
  if (compactQuery && compactFullName.startsWith(compactQuery)) return 830;

  const tokens = searchTokens(rawQuery);
  if (tokens.length && tokens.every((token) => fullName.includes(token) || shortName.includes(token) || owner.includes(token))) {
    return 760 - Math.min(120, Math.max(0, fullName.indexOf(tokens[0])));
  }

  if (shortName.includes(rawQuery)) return 720;
  if (fullName.includes(rawQuery)) return 700;
  if (compactQuery && compactShortName.includes(compactQuery)) return 660;
  if (compactQuery && compactFullName.includes(compactQuery)) return 630;

  const fuzzy = fuzzyScore(compactFullName, compactQuery);
  return fuzzy ? 420 + fuzzy : -1;
}

function filterRepos(query, limit = repoSuggestionLimit) {
  return githubRepos
    .map((repo) => ({ repo, score: scoreRepo(repo, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || repoFullName(left.repo).localeCompare(repoFullName(right.repo)))
    .slice(0, limit)
    .map((entry) => entry.repo);
}

function repoMatchesInput(repo, value) {
  const text = cleanProjectValue(value);
  if (!repo || !text) return false;
  const normalized = normalizeSearch(text);
  return [repoFullName(repo), repoShortName(repo), repo.cloneUrl].some((candidate) => normalizeSearch(candidate) === normalized);
}

function matchingRepoFromInput(value) {
  const text = cleanProjectValue(value);
  if (!text || looksLikeLocalPath(text) || !githubRepos.length) return null;
  const exactMatches = githubRepos.filter((repo) => repoMatchesInput(repo, text));
  if (exactMatches.length === 1) return exactMatches[0];

  const smartMatches = filterRepos(text, 2);
  if (smartMatches.length === 1 && scoreRepo(smartMatches[0], text) >= 700) return smartMatches[0];
  return null;
}

function looksLikeBareRepoName(value) {
  return /^[\w.-]+$/i.test(String(value || '').trim());
}

function looksLikeGitRepoInput(value) {
  const text = String(value || '').trim();
  return /^git@github\.com:/i.test(text)
    || /^https?:\/\/github\.com\/[^/]+\/[^/]+/i.test(text)
    || /^github\.com\/[^/]+\/[^/]+/i.test(text)
    || /^[\w.-]+\/[\w.-]+(?:\.git)?$/i.test(text);
}

function acceptsLocalFolders() {
  return providerKind === 'local' || Boolean(globalThis.spannerDesktop?.chooseFolder);
}

function projectFromInput() {
  const rawValue = cleanProjectValue(repoInput.value);
  if (!rawValue) return null;

  if (looksLikeLocalPath(rawValue) && !acceptsLocalFolders()) return null;

  const matchedRepo = repoMatchesInput(selectedRepo, rawValue) ? selectedRepo : matchingRepoFromInput(rawValue);
  if (matchedRepo) {
    selectedRepo = matchedRepo;
    repoSourceInput.value = 'github';
    branchInput.value = matchedRepo.defaultBranch || branchInput.value || 'main';
    return {
      kind: 'git',
      value: matchedRepo.cloneUrl || normalizeRepoUrl(repoFullName(matchedRepo)),
      label: repoFullName(matchedRepo),
      repoSource: 'github',
      branch: branchInput.value || 'main',
    };
  }

  const local = acceptsLocalFolders() && !looksLikeGitRepoInput(rawValue);
  if (local) {
    return {
      kind: 'local',
      value: rawValue,
      label: folderLabel(rawValue),
      repoSource: '',
      branch: branchInput.value || 'main',
    };
  }

  if (githubConnected && looksLikeBareRepoName(rawValue)) return null;

  const value = normalizeRepoUrl(rawValue);
  return {
    kind: 'git',
    value,
    label: projectLabel(value),
    repoSource: repoSourceInput.value,
    branch: branchInput.value || 'main',
  };
}

function normalizeRecentProjects(projects) {
  return Array.isArray(projects) ? projects.filter((project) => project?.value).slice(0, 8) : [];
}

function readCachedRecentProjects() {
  try {
    return normalizeRecentProjects(JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) || '[]'));
  } catch {
    return [];
  }
}

function readRecentProjects() {
  return recentProjects;
}

function cacheRecentProjects(projects) {
  recentProjects = normalizeRecentProjects(projects);
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(recentProjects));
  return recentProjects;
}

async function loadRecentProjects() {
  try {
    const payload = await fetchJson('/api/recent-projects');
    return cacheRecentProjects(payload.projects || []);
  } catch {
    return recentProjects;
  }
}

async function saveProject(project) {
  localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
  const key = `${project.kind}:${project.value}`;
  const recent = [project, ...readRecentProjects().filter((entry) => `${entry.kind}:${entry.value}` !== key)].slice(0, 8);
  cacheRecentProjects(recent);
  try {
    const payload = await fetchJson('/api/recent-projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project }),
    });
    cacheRecentProjects(payload.projects || recent);
  } catch {}
}

cacheRecentProjects(readCachedRecentProjects());

function effectiveThreadStatus(thread) {
  const runStatus = String(thread?.runStatus || '').toLowerCase();
  return runStatus && runStatus !== 'unknown' ? runStatus : String(thread?.status || '').toLowerCase();
}

function isActiveThread(thread) {
  return ['launching', 'starting', 'queued', 'running'].includes(effectiveThreadStatus(thread));
}

function threadMatchesProject(thread, project) {
  if (project.kind === 'local') return cleanProjectValue(thread.repoPath) === cleanProjectValue(project.value);
  return canonicalRepo(thread.repoUrl) === canonicalRepo(project.value);
}

function runningAgentCount(project, threads = []) {
  return threads.filter((thread) => isActiveThread(thread) && threadMatchesProject(thread, project)).length;
}

function finishedAtMs(thread) {
  const runEndedAtMs = Number(thread?.runEndedAtMs);
  const value = Number.isFinite(runEndedAtMs) && runEndedAtMs > 0
    ? runEndedAtMs
    : Date.parse(thread?.endedAt || thread?.completedAt || thread?.updatedAt || thread?.createdAt || '');
  return Number.isNaN(value) ? 0 : value;
}

function finishedIndicatorKey(thread, rawStatus) {
  return `${thread?.name || ''}|${rawStatus || ''}|${finishedAtMs(thread) || ''}`;
}

function isUnreadFinishedThread(thread) {
  const rawStatus = effectiveThreadStatus(thread) || 'unknown';
  return !isActiveThread(thread) && ['completed', 'ready'].includes(rawStatus) && !seenFinishedThreads.has(finishedIndicatorKey(thread, rawStatus));
}

function unreadFinishedCount(project, threads = []) {
  return threads.filter((thread) => isUnreadFinishedThread(thread) && threadMatchesProject(thread, project)).length;
}

function threadUrl(name) {
  return `/thread.html?name=${encodeURIComponent(name)}`;
}

function statusClass(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'unknown';
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
    thread?.sourceRepoPath,
    thread?.worktreePath,
    thread?.worktreeBranch,
    thread?.localWorktree,
    thread?.repoUrl,
    thread?.branch,
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

function sidebarThreadProjectValue(thread) {
  return thread?.sourceRepoPath || thread?.repoUrl || thread?.repoPath || '';
}

function sidebarThreadProjectLabel(thread) {
  return folderLabel(sidebarThreadProjectValue(thread));
}

function sidebarThreadProjectKey(thread) {
  return cleanProjectValue(sidebarThreadProjectValue(thread));
}

function sidebarThreadWorktreeValue(thread) {
  return thread?.worktreePath || thread?.repoPath || thread?.repoUrl || sidebarThreadProjectValue(thread);
}

function sidebarThreadWorktreeLabel(thread) {
  const worktreeKey = sidebarThreadWorktreeKey(thread);
  return worktreeKey && worktreeKey !== sidebarThreadProjectKey(thread) ? folderLabel(worktreeKey) : 'main';
}

function sidebarThreadWorktreeKey(thread) {
  return cleanProjectValue(sidebarThreadWorktreeValue(thread));
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

function projectFromScopeValue(value, label = folderLabel(value), options = {}) {
  const cleanValue = cleanProjectValue(value);
  if (!cleanValue) return null;
  const local = looksLikeLocalPath(cleanValue);
  const sourceRepoPath = cleanProjectValue(options.sourceRepoPath);
  const worktreePath = cleanProjectValue(options.worktreePath);
  return {
    kind: local ? 'local' : 'git',
    value: cleanValue,
    label: label || folderLabel(cleanValue),
    repoSource: local ? '' : 'github',
    branch: options.branch || 'main',
    ...(sourceRepoPath ? { sourceRepoPath } : {}),
    ...(worktreePath ? { worktreePath } : {}),
    ...(options.reuseRepoPath ? { reuseRepoPath: true } : {}),
  };
}

function writeSelectedProject(project) {
  if (!project?.value) return;
  localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
}

function selectedScopeProject() {
  if (!sidebarProjectScope || sidebarProjectScope === 'all') return null;
  const project = sidebarProjects(globalSidebarThreads).find((entry) => entry.key === sidebarProjectScope);
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
  const menu = document.querySelector('#sidebar-project-scope-menu');
  const toggle = document.querySelector('#sidebar-project-scope');
  if (label) label.textContent = currentProject?.label || 'All projects';
  if (toggle) toggle.disabled = projects.length < 1;
  if (!menu) return;
  const options = [
    { key: 'all', label: 'All projects' },
    ...projects,
  ];
  menu.innerHTML = options.map((project) => `
    <button class="sidebar-scope-option" type="button" role="menuitemradio" aria-checked="${project.key === sidebarProjectScope ? 'true' : 'false'}" data-sidebar-scope-option="${escapeHtml(project.key)}">
      ${sidebarProjectIcon(project.label)}
      <span>${escapeHtml(project.label)}</span>
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
    sidebarThreadWorktreeLabel(thread),
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

function sidebarGroupSort(left, right) {
  return left.label.localeCompare(right.label);
}

function groupedSidebarThreads(threads) {
  const projects = new Map();
  for (const thread of threads) {
    const projectKey = sidebarThreadProjectKey(thread) || 'workspace';
    const projectLabel = sidebarThreadProjectLabel(thread) || 'workspace';
    const worktreeKey = sidebarThreadWorktreeKey(thread) || projectKey;
    const worktreeLabel = sidebarThreadWorktreeLabel(thread) || 'main';
    const project = projects.get(projectKey) || { key: projectKey, label: projectLabel, worktrees: new Map() };
    const worktree = project.worktrees.get(worktreeKey) || { key: worktreeKey, label: worktreeLabel, branch: 'main', threads: [] };
    worktree.branch = worktree.branch === 'main' ? thread?.branch || 'main' : worktree.branch;
    worktree.threads.push(thread);
    project.worktrees.set(worktreeKey, worktree);
    projects.set(projectKey, project);
  }
  return [...projects.values()]
    .sort(sidebarGroupSort)
    .map((project) => ({ ...project, worktrees: [...project.worktrees.values()].sort(sidebarGroupSort) }));
}

function renderSidebarWorktreeNewButton(project, worktree) {
  const label = worktree.label || project.label || 'workspace';
  const reuseRepoPath = looksLikeLocalPath(worktree.key);
  return `<button class="sidebar-worktree-new" type="button" data-sidebar-worktree-new-thread data-sidebar-project-key="${escapeHtml(project.key)}" data-sidebar-project-label="${escapeHtml(project.label)}" data-sidebar-worktree-key="${escapeHtml(worktree.key)}" data-sidebar-worktree-label="${escapeHtml(label)}" data-sidebar-worktree-branch="${escapeHtml(worktree.branch || 'main')}"${reuseRepoPath ? ' data-sidebar-reuse-repo-path="true"' : ''} aria-label="New agent in ${escapeHtml(label)}" title="New agent in ${escapeHtml(label)}">+</button>`;
}

function projectFromWorktreeButton(button) {
  if (!button) return null;
  const reuseRepoPath = button.dataset.sidebarReuseRepoPath === 'true';
  return projectFromScopeValue(button.dataset.sidebarWorktreeKey || button.dataset.sidebarProjectKey, button.dataset.sidebarWorktreeLabel || button.dataset.sidebarProjectLabel, {
    branch: button.dataset.sidebarWorktreeBranch || 'main',
    ...(reuseRepoPath ? {
      sourceRepoPath: button.dataset.sidebarProjectKey,
      worktreePath: button.dataset.sidebarWorktreeKey,
      reuseRepoPath: true,
    } : {}),
  });
}

function renderSidebarThreadGroups(threads, renderCard) {
  return groupedSidebarThreads(threads).map((project) => `
    <section class="sidebar-project-group" aria-label="${escapeHtml(project.label)}">
      <div class="sidebar-project-group-head">
        ${sidebarProjectIcon(project.label)}
        <span>${escapeHtml(project.label)}</span>
      </div>
      ${project.worktrees.map((worktree) => `
        <section class="sidebar-worktree-group" aria-label="${escapeHtml(`${project.label} ${worktree.label}`)}">
          <div class="sidebar-worktree-group-head">
            <span>${escapeHtml(worktree.label)}</span>
            ${renderSidebarWorktreeNewButton(project, worktree)}
          </div>
          <div class="action-list sidebar-worktree-thread-list">${worktree.threads.map(renderCard).join('')}</div>
        </section>
      `).join('')}
    </section>
  `).join('');
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

function renderThreadCard(thread, jumpLabel = '') {
  const rawStatus = effectiveThreadStatus(thread) || 'unknown';
  const badgeClass = statusClass(rawStatus);
  const running = isActiveThread(thread);
  const settled = isSettledThread(thread);
  const cardMode = !settled;
  const modeClass = cardMode ? 'active-work' : 'settled-work';
  const finishedValue = finishedAt(thread);
  const finished = running ? '' : sidebarDurationLabel(formatFinishedAgo(finishedValue));
  const outcome = running ? '' : finishedOutcome(thread, rawStatus);
  const inactiveTimes = !running ? [finished].filter(Boolean) : [];
  const inactiveMeta = inactiveTimes.length ? `<span class="finished-meta">${inactiveTimes.map((text) => `<time>${escapeHtml(text)}</time>`).join('')}</span>` : '';
  const indicatorKey = settled && canDismissFinishedIndicator(rawStatus, running) ? finishedIndicatorKey(thread, rawStatus) : '';
  const indicatorSeen = indicatorKey && seenFinishedThreads.has(indicatorKey);
  const indicatorAttrs = indicatorKey && !indicatorSeen
    ? `role="button" tabindex="0" aria-label="hide finished indicator" title="hide finished indicator" data-finished-indicator="${escapeHtml(indicatorKey)}"`
    : 'aria-hidden="true"';
  const displayTitle = thread.title || thread.name;
  const projectLabelText = sidebarThreadProjectLabel(thread);
  const projectKeyText = sidebarThreadProjectKey(thread);
  const worktreeKeyText = sidebarThreadWorktreeKey(thread);
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
  const activeBody = `
    <a class="inbox-main" href="${escapeHtml(threadUrl(thread.name))}"${indicatorKey ? ` data-finished-thread="${escapeHtml(indicatorKey)}"` : ''}>
      <span class="sidebar-thread-title-row"><strong>${escapeHtml(displayTitle)}</strong></span>
    </a>
    <span class="inbox-side">${selectButton}${stopButton}${settleButton}</span>
  `;
  const settledBody = `
    <a class="inbox-main" href="${escapeHtml(threadUrl(thread.name))}"${indicatorKey ? ` data-finished-thread="${escapeHtml(indicatorKey)}"` : ''}>
      ${sidebarProjectIcon(projectLabelText)}
      <span class="sidebar-thread-title-row"><strong>${escapeHtml(displayTitle)}</strong></span>
      ${inactiveMeta}
    </a>
    <span class="inbox-side">${selectButton}${unsettleButton}</span>
    ${outcome ? `<small class="answer-preview">${escapeHtml(outcome)}</small>` : ''}
  `;
  return `
    <div class="inbox-item action-thread sidebar-thread ${modeClass} ${badgeClass}${selected ? ' is-selected' : ''}" data-sidebar-thread-row data-thread-name="${escapeHtml(thread.name)}" data-thread-project-key="${escapeHtml(projectKeyText)}" data-thread-worktree-key="${escapeHtml(worktreeKeyText)}" aria-selected="${selected ? 'true' : 'false'}"${jumpLabel ? ` data-jump-index="${escapeHtml(jumpLabel)}"` : ''}>
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


function updateFinishedIndicatorCount() {
  const list = currentThreadsListNode();
  const badge = list?.querySelector('[data-finished-indicator-count]');
  if (!badge) return;
  const count = list.querySelectorAll('[data-finished-indicator]').length;
  badge.hidden = count < 1;
  badge.textContent = 'new';
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

function renderGlobalSidebar(threads = globalSidebarThreads) {
  seenFinishedThreads = readSeenFinishedThreads();
  settledThreadNames = readSettledThreadNames();
  globalSidebarThreads = Array.isArray(threads) ? threads : [];
  updateProjectScopeMenu(globalSidebarThreads);
  const scopedThreads = scopedAgentThreads(globalSidebarThreads);
  const filteredThreads = filterAgentThreads(scopedThreads);
  const searchActive = Boolean(agentSearchQuery());
  const inboxThreads = filteredThreads;
  const activeThreads = inboxThreads.filter((thread) => !isSettledThread(thread));
  const settledThreads = inboxThreads.filter(isSettledThread);
  const renderedSettledThreads = searchActive
    ? settledThreads
    : settledShelfExpanded
      ? settledThreads.slice(0, settledVisibleCount)
      : [];
  const hiddenSettledCount = Math.max(0, settledThreads.length - renderedSettledThreads.length);
  const renderedThreads = [...activeThreads, ...renderedSettledThreads];
  pruneSidebarSelection(renderedThreads);

  const hasFreshFinished = settledThreads.some(hasFreshFinishedIndicator);
  const list = currentThreadsListNode();
  if (!list) {
    return;
  }
  const renderSignature = sidebarRenderSignature(globalSidebarThreads);
  if (list === lastSidebarRenderList && renderSignature === lastSidebarRenderSignature) {
    updateFinishedIndicatorCount();
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
        <span class="action-lane-tools">${selectActiveButton}</span>
      </div>
      <div class="action-list sidebar-active-list">${renderSidebarThreadGroups(activeThreads, renderJumpThreadCard)}</div>
    </section>
  ` : '';
  const freshBadge = hasFreshFinished ? '<span class="fresh-finished-count" data-finished-indicator-count>new</span>' : '';
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
  const settledLabel = 'Archived';
  const settledSection = `
    <section class="action-lane sidebar-inbox-section sidebar-inbox-settled" aria-label="Archived agents">
      <div class="action-lane-head">
        <button class="settled-shelf-toggle" type="button" data-settled-shelf-toggle aria-expanded="${settledShelfExpanded ? 'true' : 'false'}">
          <span>${escapeHtml(settledLabel)}</span>
          <span class="settled-shelf-chevron" aria-hidden="true">⌄</span>
        </button>
        <span class="action-lane-tools">
          ${freshBadge}
          ${historyLink}
        </span>
      </div>
      <div class="action-list sidebar-settled-list">
        ${renderedSettledThreads.length ? renderSidebarThreadGroups(renderedSettledThreads, renderJumpThreadCard) : settledThreads.length ? '' : `<p class="empty-state">${escapeHtml(settledEmpty)}</p>`}
        ${settledShelfExpanded && hiddenSettledCount > 0 ? `<button class="settled-show-more" type="button" data-settled-show-more><span aria-hidden="true">+</span>Show ${Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} more</button>` : ''}
      </div>
    </section>
  `;
  list.innerHTML = `${batchBar}${activeSection}${settledSection}`;
  updateFinishedIndicatorCount();
}

function renderCachedGlobalSidebar() {
  const threads = cachedGlobalSidebarThreads();
  if (!threads.length) return false;
  renderGlobalSidebar(threads);
  return true;
}

function syncThreadsListMount() {
  const list = currentThreadsListNode();
  if (!list || list === syncedThreadsList) return;
  syncedThreadsList = list;
  renderGlobalSidebar(globalSidebarThreads.length ? globalSidebarThreads : cachedGlobalSidebarThreads());
}

function scheduleSyncThreadsListMount() {
  if (syncThreadsListScheduled) return;
  syncThreadsListScheduled = true;
  requestAnimationFrame(() => {
    syncThreadsListScheduled = false;
    syncThreadsListMount();
  });
}

if (globalThis.MutationObserver) {
  new MutationObserver(scheduleSyncThreadsListMount).observe(document.body, { childList: true, subtree: true });
}

function renderRecentProjects(threads = []) {
  seenFinishedThreads = readSeenFinishedThreads();
  projectThreadCount = Array.isArray(threads) ? threads.length : 0;
  const projects = readRecentProjects()
    .map((project, index) => ({ project, index }))
    .filter(({ project }) => acceptsLocalFolders() || project.kind !== 'local');
  if (!projects.length) {
    recentList.innerHTML = '<p class="empty-state">No recent projects yet.</p>';
    return;
  }
  recentList.innerHTML = projects.map(({ project, index }) => {
    const unread = unreadFinishedCount(project, threads);
    const running = runningAgentCount(project, threads);
    const unreadLabel = `${unread} unread finished agent${unread === 1 ? '' : 's'}`;
    const runningLabel = `${running} running agent${running === 1 ? '' : 's'}`;
    const badges = [
      unread ? `<span class="project-activity-badge project-unread-badge" aria-label="${escapeHtml(unreadLabel)}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(unread)}</span>` : '',
      running ? `<span class="project-activity-badge project-running-badge" aria-label="${escapeHtml(runningLabel)}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(running)}</span>` : '',
    ].filter(Boolean).join('');
    return `
      <button class="project-choice" type="button" data-project-index="${index}">
        <span class="project-choice-title">
          ${projectIconSvg(project, 'project-line-icon project-choice-icon')}
          <strong>${escapeHtml(project.kind === 'local' || looksLikeLocalPath(project.value) ? folderLabel(project.value) : project.label || projectLabel(project.value))}</strong>
          ${badges ? `<span class="project-activity-badges">${badges}</span>` : ''}
        </span>
        <small>${escapeHtml(project.value)}</small>
      </button>
    `;
  }).join('');
}

function renderAuthPill(node, labelNode, ok, title, label) {
  node.dataset.status = ok ? 'authed' : 'missing';
  node.title = title;
  node.setAttribute('aria-label', title);
  labelNode.textContent = label;
}

function renderWelcome(user) {
  if (!projectWelcome) return;
  const name = String(user?.name || user?.login || '').trim().replace(/\s+/g, ' ');
  projectWelcome.textContent = name ? `Welcome back, ${name}.` : 'Welcome back.';
}

function onboardingDismissed() {
  try { return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1'; }
  catch { return false; }
}

function dismissOnboarding() {
  try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1'); }
  catch {}
  onboardingDialog?.close?.();
}

function showOnboardingAfterGitHubSignIn(connected) {
  if (!connected || new URLSearchParams(location.search).get('github') !== 'connected') return;
  try { localStorage.removeItem(ONBOARDING_DISMISSED_KEY); }
  catch {}
  history.replaceState({}, '', location.pathname);
}

function setOnboardingStep(key, state) {
  const step = onboardingDialog?.querySelector(`[data-onboarding-step="${key}"]`);
  if (!step) return;
  step.dataset.state = state;
  const marker = step.querySelector('.onboarding-step-num');
  if (!marker) return;
  const number = step.dataset.stepNumber || marker.textContent;
  marker.textContent = state === 'done' ? '✓' : number;
  marker.setAttribute('aria-label', state === 'done' ? 'completed' : `step ${number}`);
}

function renderOnboarding() {
  if (!onboardingDialog) return;
  const remoteProvider = providerKind === 'cloudflare';
  if (!remoteProvider || globalThis.spannerDesktop) {
    onboardingDialog.close?.();
    return;
  }
  if (githubSigninCard && !githubSigninCard.hidden) {
    onboardingDialog.close?.();
    return;
  }
  const steps = [
    ['github', githubConnected],
    ['llm', codexConfigured || claudeCodeConfigured],
    ['project', Boolean(cleanProjectValue(repoInput.value)) || readRecentProjects().length > 0],
    ['agent', projectThreadCount > 0],
  ];
  const currentIndex = steps.findIndex(([, done]) => !done);
  for (const [index, [key, done]] of steps.entries()) {
    setOnboardingStep(key, done ? 'done' : index === currentIndex ? 'current' : 'todo');
  }
  const currentStep = steps[currentIndex]?.[0] || '';
  for (const button of onboardingActionButtons) button.hidden = button.dataset.onboardingAction !== currentStep;
  const complete = currentIndex < 0;
  if (complete) dismissOnboarding();
  if (!complete && !onboardingDismissed() && !onboardingDialog.open) {
    try { onboardingDialog.showModal ? onboardingDialog.showModal() : onboardingDialog.setAttribute('open', ''); }
    catch {}
  }
}

function focusProjectPicker() {
  onboardingDialog?.close?.();
  projectGrid.hidden = false;
  projectHero.hidden = false;
  repoInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
  repoInput.focus();
  renderRepoSuggestions();
}

function renderAuthError(message) {
  for (const pill of [codexAuthPill, githubAuthPill]) {
    pill.dataset.status = 'error';
    pill.title = message;
  }
  githubConnected = false;
  repoRefresh.disabled = true;
  hideRepoSuggestions();
  if (githubSigninCard) githubSigninCard.hidden = true;
  if (projectHero) projectHero.hidden = false;
  if (projectGrid) projectGrid.hidden = false;
}

function hideRepoSuggestions() {
  repoOptions.hidden = true;
  repoInput.setAttribute('aria-expanded', 'false');
  repoInput.removeAttribute('aria-activedescendant');
  activeRepoMatchIndex = -1;
}

function resetRepoSelection(message) {
  selectedRepo = null;
  repoSourceInput.value = '';
  branchInput.value = 'main';
  if (message !== undefined) repoHint.textContent = message;
}

function selectRepo(repo) {
  if (!repo) return;
  selectedRepo = repo;
  repoSourceInput.value = 'github';
  branchInput.value = repo.defaultBranch || 'main';
  repoInput.value = repoFullName(repo);
  repoHint.textContent = repoSelectionLabel(repo);
  hideRepoSuggestions();
  renderOnboarding();
}

function setActiveRepoMatch(index) {
  if (!repoMatches.length) {
    activeRepoMatchIndex = -1;
    repoInput.removeAttribute('aria-activedescendant');
    return;
  }
  activeRepoMatchIndex = (index + repoMatches.length) % repoMatches.length;
  renderRepoSuggestions();
}

function resetRepoSuggestionLimit() {
  repoSuggestionLimit = INITIAL_REPO_SUGGESTIONS;
}

function showMoreRepoSuggestions() {
  if (repoOptions.hidden || repoMatches.length < repoSuggestionLimit) return;
  const scrollTop = repoOptions.scrollTop;
  repoSuggestionLimit += REPO_SUGGESTION_PAGE_SIZE;
  renderRepoSuggestions();
  repoOptions.scrollTop = scrollTop;
}

function renderRepoSuggestions() {
  if (!githubConnected || !githubRepos.length) {
    hideRepoSuggestions();
    return;
  }

  const query = repoInput.value.trim();
  repoMatches = filterRepos(query);
  if (!repoMatches.length) {
    repoOptions.innerHTML = '<div class="repo-suggestion-empty" role="presentation">No matching repos. Paste a full URL to use it anyway.</div>';
    repoInput.setAttribute('aria-expanded', 'true');
    repoInput.removeAttribute('aria-activedescendant');
    repoOptions.hidden = false;
    activeRepoMatchIndex = -1;
    return;
  }

  if (query && activeRepoMatchIndex < 0) activeRepoMatchIndex = 0;
  if (activeRepoMatchIndex >= repoMatches.length) activeRepoMatchIndex = repoMatches.length - 1;

  repoOptions.innerHTML = repoMatches.map((repo, index) => {
    const active = index === activeRepoMatchIndex;
    const visibility = repoVisibility(repo);
    const branch = repo.defaultBranch || '';
    return `
      <button id="project-repo-option-${index}" class="repo-suggestion${active ? ' is-active' : ''}" type="button" role="option" aria-selected="${active ? 'true' : 'false'}" data-repo-index="${index}">
        <span class="repo-suggestion-copy"><strong>${escapeHtml(repoFullName(repo))}</strong><small>${escapeHtml(repo.cloneUrl || '')}</small></span>
        <span class="repo-suggestion-meta"><span>${escapeHtml(visibility)}</span>${branch ? `<span>${escapeHtml(branch)}</span>` : ''}</span>
      </button>
    `;
  }).join('');

  repoInput.setAttribute('aria-expanded', 'true');
  if (activeRepoMatchIndex >= 0) repoInput.setAttribute('aria-activedescendant', `project-repo-option-${activeRepoMatchIndex}`);
  else repoInput.removeAttribute('aria-activedescendant');
  repoOptions.hidden = false;
}

async function loadLastFolder() {
  if (!globalThis.spannerDesktop?.getLastFolder || repoInput.value.trim()) return;
  try {
    const folder = await globalThis.spannerDesktop.getLastFolder();
    if (!folder || repoInput.value.trim()) return;
    repoInput.value = folder;
    if (!branchInput.value) branchInput.value = 'main';
    repoHint.textContent = 'Last local folder loaded.';
  } catch {}
}

function renderProjectModeCopy() {
  const local = acceptsLocalFolders();
  form.dataset.projectMode = local ? 'local' : 'remote';
  if (projectSubtitle) projectSubtitle.textContent = local
    ? 'Choose a local folder, pick a GitHub repo, or paste a repo URL.'
    : 'Choose a GitHub repo or paste a repo URL.';
  repoInput.placeholder = local ? '/Users/you/project or owner/repo' : 'owner/repo or URL';
}

function renderProvider(provider) {
  providerKind = provider?.kind || '';
  const local = providerKind === 'local';
  const canChooseFolder = Boolean(globalThis.spannerDesktop?.chooseFolder);
  renderProjectModeCopy();
  repoTray.hidden = false;
  repoRefresh.hidden = false;
  chooseFolder.hidden = !canChooseFolder;
  if (local) {
    if (!repoInput.value.trim()) resetRepoSelection('Choose a local folder, pick a GitHub repo, or paste a repo URL.');
    void loadLastFolder();
  }
}

function renderRepoOptions(repos, options = {}) {
  resetRepoSuggestionLimit();
  const suffix = options.refreshing ? ' · updating…' : ' · type to filter';
  repoHint.textContent = repos.length ? `${repos.length} GitHub repos${suffix}` : options.refreshing ? 'Loading GitHub repos…' : 'No GitHub repos found.';
  if (document.activeElement === repoInput) renderRepoSuggestions();
}

function hydrateCachedGitHubRepos(status) {
  const repos = Array.isArray(status?.repos) ? status.repos : [];
  if (!repos.length) return false;
  githubRepos = repos;
  renderRepoOptions(githubRepos, { refreshing: true });
  return true;
}

async function loadGitHubRepos() {
  if (githubRepoRefreshPromise) return githubRepoRefreshPromise;
  githubRepoRefreshPromise = fetchJson('/api/github/repos')
    .then((payload) => {
      githubRepos = payload.repos || [];
      renderRepoOptions(githubRepos);
      return githubRepos;
    })
    .finally(() => {
      githubRepoRefreshPromise = null;
    });
  return githubRepoRefreshPromise;
}

function setSignInBusy(busy) {
  for (const button of githubSigninButtons) {
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
}

function setSignInStatus(message) {
  if (githubSigninStatus) githubSigninStatus.textContent = message;
  statusLine.textContent = message;
}

function renderGitHubSignIn(status) {
  const connected = Boolean(status.connected);
  const desktop = Boolean(globalThis.spannerDesktop);
  const showGate = !desktop && providerKind !== 'local' && !connected && status.configured;
  if (githubSigninCard) githubSigninCard.hidden = !showGate;
  if (projectHero) projectHero.hidden = showGate;
  if (projectGrid) projectGrid.hidden = showGate;
  for (const button of githubSigninButtons) {
    button.hidden = desktop || connected || !status.configured;
    button.disabled = !status.configured;
  }
  if (githubSigninCopy && status.configured) githubSigninCopy.textContent = 'Connect GitHub to launch agents on your repos without sharing credentials with anyone else.';
  if (showGate) setSignInStatus('Sign in with GitHub to continue.');
}

async function startGitHubSignIn() {
  setSignInBusy(true);
  setSignInStatus('Opening GitHub sign-in…');
  try {
    const payload = await fetchJson('/api/auth/github/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnTo: location.href }),
    });
    location.href = payload.loginUrl;
  } catch (error) {
    setSignInStatus(error.message);
    setSignInBusy(false);
  }
}

async function refreshProjectThreads() {
  await loadRecentProjects();
  const payload = await fetchJson('/api/threads');
  const threads = payload.threads || [];
  notifyAgentThreads(threads);
  cacheGlobalSidebarThreads(threads);
  renderProvider(payload.provider);
  renderRecentProjects(threads);
  renderGlobalSidebar(threads);
}

function renderProjectAuth(codex = {}, github = {}, claudeCode = {}) {
  codexConfigured = Boolean(codex.configured);
  claudeCodeConfigured = Boolean(claudeCode.configured);
  renderAuthPill(codexAuthPill, codexAuthLabel, codexConfigured || claudeCodeConfigured, codexConfigured ? `Codex: ${codex.source || 'signed in'}` : claudeCodeConfigured ? `Claude: ${claudeCode.source || 'signed in'}` : 'LLM: signed out', 'llm');
  const connected = Boolean(github.connected);
  githubConnected = connected;
  showOnboardingAfterGitHubSignIn(connected);
  renderWelcome(connected ? github.user : null);
  renderAuthPill(githubAuthPill, githubAuthLabel, connected, connected ? `GitHub: ${github.user?.login || 'connected'}` : github.configured ? 'GitHub: signed out' : 'GitHub: not configured', 'github');
  renderGitHubSignIn(github);
  repoRefresh.disabled = !connected;
  if (connected) {
    const hydrated = hydrateCachedGitHubRepos(github);
    if (!hydrated) repoHint.textContent = 'Loading GitHub repos…';
    void loadGitHubRepos().catch((error) => {
      repoHint.textContent = hydrated && githubRepos.length ? `${githubRepos.length} GitHub repos · refresh failed` : error.message;
    });
  } else {
    githubRepos = [];
    githubRepoRefreshPromise = null;
    hideRepoSuggestions();
    repoHint.textContent = github.configured
      ? acceptsLocalFolders() ? 'Sign in to pick repos, or paste a local folder.' : 'Sign in to pick repos.'
      : acceptsLocalFolders() ? 'Paste a GitHub repo URL or local folder.' : 'Paste a GitHub repo URL.';
  }
  renderOnboarding();
}

async function loadProjectAuth() {
  const [codex, github, claudeCode] = await Promise.all([
    fetchJson('/api/auth/openai-codex'),
    fetchJson('/api/auth/github'),
    fetchJson('/api/auth/claude-code'),
  ]);
  renderProjectAuth(codex, github, claudeCode);
}

async function loadProjectBootstrap() {
  const payload = await fetchJson('/api/bootstrap?page=project&fast=1');
  const threads = payload.threads || [];
  notifyAgentThreads(threads);
  cacheGlobalSidebarThreads(threads);
  cacheRecentProjects(payload.recentProjects || []);
  renderProvider(payload.provider);
  renderRecentProjects(threads);
  renderGlobalSidebar(threads);

  if (payload.codex?.deferred || payload.github?.deferred || payload.claudeCode?.deferred) {
    void loadProjectAuth().catch((error) => {
      repoHint.textContent = error.message;
    });
  } else {
    renderProjectAuth(payload.codex || {}, payload.github || {}, payload.claudeCode || {});
  }
}

async function loadStatus() {
  getBrowserSessionId();
  renderRecentProjects();
  if (!renderCachedGlobalSidebar()) renderGlobalSidebar();
  renderProjectModeCopy();
  if (globalThis.spannerDesktop?.chooseFolder) {
    chooseFolder.hidden = false;
    repoTray.hidden = true;
    repoHint.textContent = 'Choose a local folder or paste its path.';
    void loadLastFolder();
  }

  try {
    await loadProjectBootstrap();
  } catch (error) {
    renderAuthError(error.message);
  }
}

async function openWorkspace(project) {
  await saveProject(project);
  captureSpannerEvent('workspace_opened', {
    source: project.kind === 'local' ? 'local' : 'github',
    desktop: Boolean(globalThis.spannerDesktop),
    has_branch: Boolean(project.branch),
  });
  if (project.kind === 'local') {
    try {
      await globalThis.spannerDesktop?.rememberFolder?.(project.value);
    } catch {}
  }
  location.href = '/workspace.html';
}

repoRefresh.addEventListener('click', async () => {
  repoRefresh.disabled = true;
  repoHint.textContent = 'Loading…';
  try {
    await refreshProjectThreads();
    await loadGitHubRepos();
  } catch (error) {
    repoHint.textContent = error.message;
  } finally {
    repoRefresh.disabled = false;
  }
});

chooseFolder.addEventListener('click', async () => {
  try {
    const folder = await globalThis.spannerDesktop?.chooseFolder?.(repoInput.value.trim());
    if (!folder) return;
    repoInput.value = folder;
    resetRepoSelection('Local folder selected.');
    statusLine.textContent = 'Ready to open the workspace.';
    renderOnboarding();
  } catch (error) {
    statusLine.textContent = error.message;
  }
});

repoInput.addEventListener('focus', () => {
  resetRepoSuggestionLimit();
  renderRepoSuggestions();
});

repoInput.addEventListener('input', () => {
  const value = repoInput.value.trim();
  if (!selectedRepo || !repoMatchesInput(selectedRepo, value)) {
    resetRepoSelection(value ? 'Type to filter GitHub repos, or paste a URL.' : '');
  }
  activeRepoMatchIndex = -1;
  resetRepoSuggestionLimit();
  renderRepoSuggestions();
  renderOnboarding();
});

repoInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (repoOptions.hidden) renderRepoSuggestions();
    setActiveRepoMatch(activeRepoMatchIndex + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (repoOptions.hidden) renderRepoSuggestions();
    setActiveRepoMatch(activeRepoMatchIndex < 0 ? repoMatches.length - 1 : activeRepoMatchIndex - 1);
  } else if (event.key === 'Enter' && !repoOptions.hidden && activeRepoMatchIndex >= 0) {
    event.preventDefault();
    selectRepo(repoMatches[activeRepoMatchIndex]);
  } else if (event.key === 'Escape') {
    hideRepoSuggestions();
  }
});

repoOptions.addEventListener('mousedown', (event) => {
  event.preventDefault();
});

repoOptions.addEventListener('scroll', () => {
  const nearBottom = repoOptions.scrollTop + repoOptions.clientHeight >= repoOptions.scrollHeight - 32;
  if (nearBottom) showMoreRepoSuggestions();
});

repoOptions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-repo-index]');
  if (!button) return;
  selectRepo(repoMatches[Number(button.dataset.repoIndex)]);
});

document.addEventListener('mousedown', (event) => {
  if (event.target === repoInput || repoOptions.contains(event.target)) return;
  hideRepoSuggestions();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const project = projectFromInput();
  if (!project) {
    statusLine.textContent = acceptsLocalFolders()
      ? 'Choose a local folder or GitHub repo.'
      : 'Pick a GitHub repo or paste a repo URL.';
    renderRepoSuggestions();
    return;
  }
  statusLine.textContent = 'Opening workspace…';
  await openWorkspace(project);
});

recentList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-project-index]');
  if (!button) return;
  const project = readRecentProjects()[Number(button.dataset.projectIndex)];
  if (project) await openWorkspace(project);
});

for (const button of githubSigninButtons) button.addEventListener('click', () => startGitHubSignIn());
onboardingClose?.addEventListener('click', dismissOnboarding);
onboardingDialog?.addEventListener('cancel', () => {
  try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1'); }
  catch {}
});
onboardingPickRepo?.addEventListener('click', focusProjectPicker);

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
  const activeRow = document.activeElement?.closest?.('[data-sidebar-thread-row]');
  const currentName = activeRow?.dataset?.threadName || '';
  const currentIndex = names.indexOf(currentName);
  const baseIndex = currentIndex === -1 ? (offset > 0 ? -1 : 0) : currentIndex;
  navigateToThreadName(names[(baseIndex + offset + names.length) % names.length]);
}

function closeThreadMenu() {
  document.querySelector('#sidebar-thread-menu')?.remove();
  contextMenuThreadName = '';
}

function threadByName(name) {
  return globalSidebarThreads.find((thread) => thread.name === name) || null;
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
    `<button type="button" role="menuitem" data-thread-menu-action="new-thread-project">New worktree in project</button>`,
    active ? `<button type="button" role="menuitem" data-thread-menu-action="stop">Stop thread</button>` : '',
    canSettle && !settled ? `<button type="button" role="menuitem" data-thread-menu-action="settle">Archive thread</button>` : '',
    settled ? `<button type="button" role="menuitem" data-thread-menu-action="unsettle">Unarchive thread</button>` : '',
    `<button type="button" role="menuitem" data-thread-menu-action="delete" data-danger="true">Delete</button>`,
  ].filter(Boolean).join('');
  document.body.append(menu);
  menu.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - menu.offsetHeight - 8))}px`;
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
    await refreshProjectThreads();
    return;
  }
  if (action === 'settle') {
    markThreadSettled(thread.name);
    renderGlobalSidebar(globalSidebarThreads);
    return;
  }
  if (action === 'unsettle') {
    markThreadUnsettled(thread.name);
    renderGlobalSidebar(globalSidebarThreads);
    return;
  }
  if (action === 'delete') {
    if (!confirm(`Delete "${thread.title || thread.name}"?`)) return;
    await fetchJson(`/api/threads/${encodeURIComponent(thread.name)}/delete`, { method: 'POST' });
    await refreshProjectThreads();
  }
}

loadStatus();
bindSidebarPromptLightbox({ fetchJson, makeThreadUrl: threadUrl });

document.addEventListener('input', (event) => {
  if (event.target?.matches?.('#agent-search')) {
    setSettledVisibleCount(INITIAL_SETTLED_VISIBLE_COUNT);
    renderGlobalSidebar(globalSidebarThreads);
  }
});

document.addEventListener('click', async (event) => {
  const worktreeNewThread = event.target?.closest?.('[data-sidebar-worktree-new-thread]');
  if (worktreeNewThread) {
    event.preventDefault();
    const project = projectFromWorktreeButton(worktreeNewThread);
    if (project) writeSelectedProject(project);
    closeScopeMenu();
    openSidebarPromptLightbox();
    return;
  }

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
      statusLine.textContent = error.message;
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
    renderGlobalSidebar(globalSidebarThreads);
    return;
  }

  if (!event.target?.closest?.('.sidebar-command-row')) closeScopeMenu();

  const showMore = event.target?.closest?.('[data-settled-show-more]');
  if (showMore) {
    setSettledVisibleCount(settledVisibleCount + SETTLED_TAIL_PAGE_COUNT);
    renderGlobalSidebar(globalSidebarThreads);
    return;
  }

  const toggle = event.target?.closest?.('[data-settled-shelf-toggle]');
  if (toggle) {
    setSettledShelfExpanded(!settledShelfExpanded);
    renderGlobalSidebar(globalSidebarThreads);
    return;
  }

  if (!event.target?.closest?.('#threads-list')) return;

  const selectVisible = event.target.closest('[data-sidebar-select-visible]');
  if (selectVisible) {
    selectVisibleSettleableThreads(globalSidebarThreads.filter((thread) => renderedSidebarThreadNames.includes(thread.name)));
    renderGlobalSidebar(globalSidebarThreads);
    return;
  }

  const batchSettle = event.target.closest('[data-sidebar-batch-settle]');
  if (batchSettle) {
    const count = settleSelectedSidebarThreads();
    renderGlobalSidebar(globalSidebarThreads);
    if (count > 0) statusLine.textContent = `Archived ${count} agent${count === 1 ? '' : 's'}.`;
    return;
  }

  const selectionClear = event.target.closest('[data-sidebar-selection-clear]');
  if (selectionClear) {
    clearSidebarSelection();
    renderGlobalSidebar(globalSidebarThreads);
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
      await refreshProjectThreads();
    } catch (error) {
      stopButton.disabled = false;
      stopButton.textContent = 'stop';
      statusLine.textContent = error.message;
    }
    return;
  }

  const selectionButton = event.target.closest('[data-sidebar-thread-select]');
  if (selectionButton) {
    event.preventDefault();
    toggleSidebarThreadSelection(selectionButton.dataset.sidebarThreadSelect, { range: event.shiftKey });
    renderGlobalSidebar(globalSidebarThreads);
    return;
  }

  const settleButton = event.target.closest('[data-settle-thread]');
  if (settleButton) {
    markThreadSettled(settleButton.dataset.settleThread);
    selectedSidebarThreadNames.delete(settleButton.dataset.settleThread);
    renderGlobalSidebar(globalSidebarThreads);
    return;
  }

  const unsettleButton = event.target.closest('[data-unsettle-thread]');
  if (unsettleButton) {
    markThreadUnsettled(unsettleButton.dataset.unsettleThread);
    selectedSidebarThreadNames.delete(unsettleButton.dataset.unsettleThread);
    renderGlobalSidebar(globalSidebarThreads);
    return;
  }

  const row = event.target?.closest?.('[data-sidebar-thread-row]');
  if (row && (event.metaKey || event.ctrlKey || event.shiftKey)) {
    event.preventDefault();
    toggleSidebarThreadSelection(row.dataset.threadName, { range: event.shiftKey });
    renderGlobalSidebar(globalSidebarThreads);
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
      renderGlobalSidebar(globalSidebarThreads);
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
      renderGlobalSidebar(globalSidebarThreads);
      return;
    }
  }
});

document.addEventListener('keyup', (event) => {
  if (event.key === 'Meta' || event.key === 'Control') document.body.classList.remove('sidebar-jump-hints');
});

document.addEventListener('keydown', (event) => {
  if (!event.target?.closest?.('#threads-list')) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const indicator = event.target.closest('[data-finished-indicator]');
  if (!indicator) return;
  event.preventDefault();
  dismissFinishedIndicator(indicator);
});

setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  refreshProjectThreads().catch(() => {});
}, SIDEBAR_POLL_INTERVAL_MS);
