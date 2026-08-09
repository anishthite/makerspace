import { toast } from 'sonner';

import { captureSpannerEvent } from '../lib/posthog.js';
import { redirectIfAuthRequired } from './auth-redirect.js';
import './appearance.js?v=palette-2';
import { bindImageDropZone, clearImageInput, filesToImageAttachments, imageInputFiles, updateImageStatus } from './image-attachments.js';
import { bindSidebarPromptLightbox, openSidebarPromptLightbox } from './sidebar-prompt-lightbox.js';
import { submitOnEnter } from './submit-on-enter.js';

const BROWSER_SESSION_KEY = 'spannerBrowserSession';
const MODEL_REF_KEY = 'spannerModelRef';
const THINKING_LEVEL_KEY = 'spannerThinkingLevel';
const PROJECT_KEY = 'spannerSelectedProject';
const RECENT_PROJECTS_KEY = 'spannerRecentProjects';
const SEEN_FINISHED_THREADS_KEY = 'spannerSeenFinishedThreads';
const WORKSPACE_THREADS_CACHE_KEY = 'spannerWorkspaceThreadsCache';
const GLOBAL_SIDEBAR_THREADS_CACHE_KEY = 'spannerGlobalSidebarThreadsCache';
const SIDEBAR_SETTLED_EXPANDED_KEY = 'spannerSidebarSettledExpanded';
const SIDEBAR_SETTLED_VISIBLE_KEY = 'spannerSidebarSettledVisible';
const SIDEBAR_SETTLED_THREADS_KEY = 'spannerSidebarSettledThreads';
const SIDEBAR_PROJECT_SCOPE_KEY = 'spannerSidebarProjectScope';
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const INITIAL_SETTLED_VISIBLE_COUNT = 20;
const SETTLED_TAIL_PAGE_COUNT = 20;
const SETTLEABLE_THREAD_STATUSES = ['completed', 'ready', 'failed'];
const FINISHED_INDICATOR_RESET_ATTRIBUTES = ['role', 'tabindex', 'aria-label', 'title', 'data-finished-indicator'];
const SIDEBAR_RUNTIME_TICK_MS = 30000;
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
migrateStorageKey('workbenchModelRef', MODEL_REF_KEY);
migrateStorageKey('workbenchThinkingLevel', THINKING_LEVEL_KEY);
migrateStorageKey('workbenchSelectedProject', PROJECT_KEY);
migrateStorageKey('workbenchRecentProjects', RECENT_PROJECTS_KEY);
migrateStorageKey('workbenchSeenFinishedThreads', SEEN_FINISHED_THREADS_KEY);

const providerBanner = document.querySelector('#provider-banner');
const projectLabel = document.querySelector('#project-label');
const workspaceSwitcherToggle = document.querySelector('#workspace-switcher-toggle');
const workspaceSwitcherMenu = document.querySelector('#workspace-switcher-menu');
const workspaceSwitcherSearch = document.querySelector('#workspace-switcher-search');
const workspaceSwitcherRecents = document.querySelector('#workspace-switcher-recents');
const codexAuthPill = document.querySelector('#codex-auth-pill');
const codexAuthLabel = document.querySelector('#codex-auth-label');
const githubAuthPill = document.querySelector('#github-auth-pill');
const githubAuthLabel = document.querySelector('#github-auth-label');
const githubSigninCard = document.querySelector('#github-signin-card');
const githubSigninButtons = Array.from(document.querySelectorAll('[data-github-signin]'));
const githubSigninCopy = document.querySelector('#github-signin-copy');
const githubSigninStatus = document.querySelector('#github-signin-status');
const agentsSection = document.querySelector('#agents-section');
const repoUrlInput = document.querySelector('input[name="repoUrl"]');
const promptInput = document.querySelector('textarea[name="prompt"]');
const imageInput = document.querySelector('#prompt-images');
const imageStatus = document.querySelector('#image-status');
const workspaceProjectLightboxTrigger = document.querySelector('#workspace-project-lightbox-trigger');
const workspaceProjectLightbox = document.querySelector('#workspace-project-lightbox');
const workspaceProjectLightboxClose = document.querySelector('#workspace-project-lightbox-close');
const workspaceProjectLightboxCurrent = document.querySelector('#workspace-project-lightbox-current');
const workspaceProjectLightboxSearch = document.querySelector('#workspace-project-lightbox-search');
const workspaceProjectLightboxList = document.querySelector('#workspace-project-lightbox-list');
const workspaceProjectLightboxImages = document.querySelector('#workspace-project-lightbox-images');
const modelRefInput = document.querySelector('#model-ref');
const thinkingLevelInput = document.querySelector('#thinking-level');
const thinkingLevelOutput = document.querySelector('#thinking-level-value');
const branchInput = document.querySelector('input[name="branch"]');
const repoSourceInput = document.querySelector('input[name="repoSource"]');
const repoPicker = document.querySelector('#repo-picker');
const repoRefresh = document.querySelector('#repo-refresh');
const chooseFolder = document.querySelector('#choose-folder');
const repoHint = document.querySelector('#repo-hint');
const threadForm = document.querySelector('#thread-form');
const threadSubmit = document.querySelector('#thread-submit');
const threadStatus = document.querySelector('#thread-status');
const launchSuggestions = document.querySelector('#launch-suggestions');
const launchSuggestionsInitialHtml = launchSuggestions?.innerHTML || '';
const agentSearchInput = document.querySelector('#agent-search');
let threadsList = document.querySelector('#threads-list');
let syncedThreadsList = threadsList;
let syncThreadsListScheduled = false;

let githubRepos = [];
let githubRepoRefreshPromise = null;
let selectedRepo = null;
let selectedProject = readSelectedProject();
let recentProjects = readCachedRecentProjects();
let workspaceSwitcherThreads = [];
let currentWorkspaceThreads = [];
let workspaceSwitcherSearchQuery = '';
let workspaceProjectLightboxSearchQuery = '';
let localProvider = false;
let defaultThinkingLevel = 'xhigh';
let runtimeTickTimer = null;
let seenFinishedThreads = readSeenFinishedThreads();
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
let knownThreadStatuses = new Map();
let loadedThreadSnapshot = false;
let workspaceSuggestionSignature = '';
let workspaceSuggestionRequestId = 0;
const notifiedFinishToasts = new Set();

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showAgentToast(title, detail = '', tone = 'success') {
  const notify = tone === 'error' ? toast.error : toast.success;
  notify(title, {
    description: detail || undefined,
    duration: 8000,
    className: 'agent-main-link-toast',
  });
}

function readSeenFinishedThreads() {
  try {
    const value = JSON.parse(localStorage.getItem(SEEN_FINISHED_THREADS_KEY) || '[]');
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
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

function rememberSeenFinishedThread(key) {
  if (!key) return;
  seenFinishedThreads.add(key);
  localStorage.setItem(SEEN_FINISHED_THREADS_KEY, JSON.stringify([...seenFinishedThreads].slice(-300)));
}

function getBrowserSessionId() {
  let sessionId = localStorage.getItem(BROWSER_SESSION_KEY) || '';
  if (!sessionId) {
    sessionId = globalThis.crypto?.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('-');
    localStorage.setItem(BROWSER_SESSION_KEY, sessionId);
  }
  return sessionId;
}

function getApiBase() {
  return API_BASE;
}

function getApiToken() {
  return '';
}

function thinkingLevelValue() {
  return THINKING_LEVELS[Number(thinkingLevelInput.value)] || '';
}

function renderThinkingLevel() {
  const level = thinkingLevelValue();
  const label = level || defaultThinkingLevel || 'xhigh';
  const title = `Thinking: ${label}`;
  thinkingLevelOutput.textContent = label;
  thinkingLevelOutput.title = title;
  thinkingLevelInput.title = title;
  thinkingLevelInput.setAttribute('aria-valuetext', label);
}

function setThinkingLevel(value) {
  const level = String(value || 'xhigh').trim().toLowerCase();
  thinkingLevelInput.value = String(Math.max(0, THINKING_LEVELS.indexOf(level)));
  renderThinkingLevel();
}

function ensureModelOption(value) {
  const text = String(value || '').trim();
  if (!text || Array.from(modelRefInput.options).some((option) => option.value === text)) return;
  const option = document.createElement('option');
  option.value = text;
  option.textContent = text;
  modelRefInput.append(option);
}

function setModelRef(value) {
  const text = String(value || '').trim();
  ensureModelOption(text);
  modelRefInput.value = text;
}

function saveRunControls() {
  localStorage.setItem(MODEL_REF_KEY, modelRefInput.value.trim());
  localStorage.setItem(THINKING_LEVEL_KEY, thinkingLevelValue());
}

function loadRunControls() {
  setModelRef(localStorage.getItem(MODEL_REF_KEY) || '');
  setThinkingLevel(localStorage.getItem(THINKING_LEVEL_KEY) || '');
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

function readSelectedProject() {
  try {
    const project = JSON.parse(localStorage.getItem(PROJECT_KEY) || 'null');
    return project?.value ? project : null;
  } catch {
    return null;
  }
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

function cacheRecentProjects(projects) {
  recentProjects = normalizeRecentProjects(projects);
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(recentProjects));
  if (workspaceProjectLightbox?.open) renderWorkspaceProjectLightbox();
  return recentProjects;
}

function workspaceThreadsCacheKey() {
  const key = selectedProject?.value ? `${selectedProject.kind || ''}:${selectedProject.value}` : 'all';
  return `${WORKSPACE_THREADS_CACHE_KEY}:${key}`;
}

function cachedWorkspaceThreads() {
  try {
    const payload = JSON.parse(localStorage.getItem(workspaceThreadsCacheKey()) || 'null');
    return Array.isArray(payload?.threads) ? payload.threads : [];
  } catch {
    return [];
  }
}

function cacheableWorkspaceThread(thread = {}) {
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

function cacheWorkspaceThreads(threads) {
  try {
    const safeThreads = Array.isArray(threads) ? threads.map(cacheableWorkspaceThread) : [];
    localStorage.setItem(workspaceThreadsCacheKey(), JSON.stringify({ savedAt: Date.now(), threads: safeThreads }));
  } catch {}
}

function cacheGlobalSidebarThreads(threads) {
  try {
    const safeThreads = Array.isArray(threads) ? threads.map(cacheableWorkspaceThread) : [];
    localStorage.setItem(GLOBAL_SIDEBAR_THREADS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), threads: safeThreads }));
  } catch {}
}

function renderCachedWorkspaceThreads() {
  const threads = cachedWorkspaceThreads();
  if (threads.length) renderThreads(threads, { suggestions: false });
}

function cleanProjectValue(value) {
  return String(value || '').trim().replace(/[\\/]+$/, '');
}

function looksLikeLocalPath(value) {
  return /^(~|\/|[A-Za-z]:[\\/]|\\\\)/.test(String(value || '').trim());
}

function folderLabel(value) {
  const text = cleanProjectValue(value);
  return text.split(/[\\/]+/).filter(Boolean).pop() || text || 'workspace';
}

function sidebarProjectInitial(label) {
  return String(label || '').trim().match(/[A-Za-z0-9]/)?.[0]?.toUpperCase() || '#';
}

function sidebarProjectIcon(label) {
  return `<span class="sidebar-thread-favicon" aria-hidden="true">${escapeHtml(sidebarProjectInitial(label))}</span>`;
}

function compactProjectLabel(value) {
  const text = cleanProjectValue(value)
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '');
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join('/') || text || 'workspace';
}

function selectedProjectLabel(project) {
  return project?.kind === 'local' || looksLikeLocalPath(project?.value)
    ? folderLabel(project?.value)
    : project?.label || compactProjectLabel(project?.value);
}

function acceptsSwitcherProject(project) {
  return localProvider || Boolean(globalThis.spannerDesktop?.chooseFolder) || (project?.kind !== 'local' && !looksLikeLocalPath(project?.value));
}

function sameSwitcherProject(left, right) {
  if (!left?.value || !right?.value) return false;
  if (left.kind === 'local' || right.kind === 'local' || looksLikeLocalPath(left.value) || looksLikeLocalPath(right.value)) {
    return cleanProjectValue(left.value) === cleanProjectValue(right.value);
  }
  return canonicalRepo(left.value) === canonicalRepo(right.value);
}

function threadMatchesProject(thread, project) {
  if (!project?.value) return false;
  if (project.kind === 'local' || looksLikeLocalPath(project.value)) return cleanProjectValue(thread.repoPath) === cleanProjectValue(project.value);
  return canonicalRepo(thread.repoUrl) === canonicalRepo(project.value);
}

function switcherRunningCount(project) {
  return workspaceSwitcherThreads.filter((thread) => isActiveThread(thread) && threadMatchesProject(thread, project)).length;
}

function switcherUnreadCount(project) {
  return workspaceSwitcherThreads.filter((thread) => {
    const rawStatus = effectiveThreadStatus(thread) || 'unknown';
    return threadMatchesProject(thread, project) && canDismissFinishedIndicator(rawStatus, isActiveThread(thread)) && !seenFinishedThreads.has(finishedIndicatorKey(thread, rawStatus));
  }).length;
}

function normalizedProjectSearch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/^github\.com\//, '')
    .replace(/\.git$/i, '')
    .trim();
}

function switcherProjectMatches(project, query) {
  const tokens = normalizedProjectSearch(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const text = normalizedProjectSearch([selectedProjectLabel(project), project?.value, project?.repoSource, project?.branch].filter(Boolean).join(' '));
  return tokens.every((token) => text.includes(token));
}

function renderWorkspaceSwitcher(message = '') {
  if (!workspaceSwitcherRecents) return;
  const query = workspaceSwitcherSearchQuery.trim();
  const projects = recentProjects
    .map((project, index) => ({ project, index }))
    .filter(({ project }) => acceptsSwitcherProject(project) && switcherProjectMatches(project, query))
    .slice(0, query ? 12 : 6);
  if (!projects.length) {
    workspaceSwitcherRecents.innerHTML = `<p class="workspace-switcher-empty">${escapeHtml(message || (query ? `No projects match “${query}”.` : 'No recent projects yet.'))}</p>`;
    return;
  }
  workspaceSwitcherRecents.innerHTML = projects.map(({ project, index }) => {
    const active = sameSwitcherProject(project, selectedProject);
    const unread = switcherUnreadCount(project);
    const running = switcherRunningCount(project);
    const counts = [
      unread ? `<span class="project-activity-badge project-unread-badge" aria-label="${escapeHtml(`${unread} unread finished agent${unread === 1 ? '' : 's'}`)}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(unread)}</span>` : '',
      running ? `<span class="project-activity-badge project-running-badge" aria-label="${escapeHtml(`${running} running agent${running === 1 ? '' : 's'}`)}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(running)}</span>` : '',
    ].filter(Boolean).join('');
    return `
      <button class="workspace-switcher-project" type="button" data-workspace-project-index="${index}"${active ? ' aria-current="page"' : ''}>
        <span><strong>${escapeHtml(selectedProjectLabel(project))}</strong>${counts ? `<span class="project-activity-badges">${counts}</span>` : ''}</span>
        <small>${escapeHtml(project.value)}</small>
      </button>
    `;
  }).join('');
}

function lightboxProjectActivity(project) {
  const unread = switcherUnreadCount(project);
  const running = switcherRunningCount(project);
  return [
    unread ? `<span class="project-activity-badge project-unread-badge" aria-label="${escapeHtml(`${unread} unread finished agent${unread === 1 ? '' : 's'}`)}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(unread)}</span>` : '',
    running ? `<span class="project-activity-badge project-running-badge" aria-label="${escapeHtml(`${running} running agent${running === 1 ? '' : 's'}`)}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(running)}</span>` : '',
  ].filter(Boolean).join('');
}

function renderWorkspaceProjectLightbox(message = '') {
  if (!workspaceProjectLightboxList) return;
  if (workspaceProjectLightboxCurrent) {
    workspaceProjectLightboxCurrent.innerHTML = selectedProject?.value
      ? `<span>selected</span><strong>${escapeHtml(selectedProjectLabel(selectedProject))}</strong><small>${escapeHtml(selectedProject.value)}</small>`
      : '<span>selected</span><strong>No project</strong><small>Browse all projects</small>';
  }

  const query = workspaceProjectLightboxSearchQuery.trim();
  const projects = recentProjects
    .map((project, index) => ({ project, index }))
    .filter(({ project }) => acceptsSwitcherProject(project) && switcherProjectMatches(project, query))
    .slice(0, query ? 16 : 8);
  if (!projects.length) {
    workspaceProjectLightboxList.innerHTML = `<p class="workspace-project-lightbox-empty">${escapeHtml(message || (query ? `No projects match “${query}”.` : 'No recent projects yet.'))}</p>`;
    return;
  }
  workspaceProjectLightboxList.innerHTML = projects.map(({ project, index }) => {
    const active = sameSwitcherProject(project, selectedProject);
    const badges = lightboxProjectActivity(project);
    return `
      <button class="workspace-project-lightbox-project" type="button" data-workspace-lightbox-project-index="${index}"${active ? ' aria-current="page"' : ''}>
        <span><strong>${escapeHtml(selectedProjectLabel(project))}</strong>${badges ? `<span class="project-activity-badges">${badges}</span>` : ''}</span>
        <small>${escapeHtml(project.value)}</small>
      </button>
    `;
  }).join('');
}

function setWorkspaceProjectLightboxOpen(open) {
  if (!workspaceProjectLightbox) return;
  if (open) {
    workspaceProjectLightboxSearchQuery = workspaceProjectLightboxSearch?.value || '';
    renderWorkspaceProjectLightbox();
    workspaceProjectLightboxTrigger?.setAttribute('aria-expanded', 'true');
    try {
      workspaceProjectLightbox.showModal ? workspaceProjectLightbox.showModal() : workspaceProjectLightbox.setAttribute('open', '');
    } catch {}
    setTimeout(() => {
      if (workspaceProjectLightbox.open) workspaceProjectLightboxSearch?.focus();
    }, 0);
    return;
  }
  workspaceProjectLightboxTrigger?.setAttribute('aria-expanded', 'false');
  if (workspaceProjectLightbox.open) workspaceProjectLightbox.close?.();
  workspaceProjectLightbox.removeAttribute('open');
}

function selectWorkspaceProject(project) {
  if (!project?.value) return;
  writeSelectedProject(project);
  setWorkspaceProjectLightboxOpen(false);
  threadStatus.textContent = `Project set to ${selectedProjectLabel(project)}.`;
  promptInput?.focus();
}

async function loadRecentProjects() {
  try {
    const payload = await fetchJson('/api/recent-projects');
    cacheRecentProjects(payload.projects || []);
    renderWorkspaceSwitcher();
  } catch {
    renderWorkspaceSwitcher();
  }
}

function setWorkspaceSwitcherOpen(open) {
  if (!workspaceSwitcherToggle || !workspaceSwitcherMenu) return;
  workspaceSwitcherMenu.hidden = !open;
  workspaceSwitcherToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) setTimeout(() => {
    if (!workspaceSwitcherMenu.hidden) workspaceSwitcherSearch?.focus();
  }, 0);
}

function switchWorkspaceProject(project) {
  if (!project?.value) return;
  if (sameSwitcherProject(project, selectedProject)) {
    setWorkspaceSwitcherOpen(false);
    return;
  }
  localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
  selectedProject = project;
  location.href = '/workspace.html';
}

function applySelectedProject() {
  if (!selectedProject) {
    location.replace('/');
    return;
  }
  repoUrlInput.value = selectedProject.value || '';
  repoSourceInput.value = selectedProject.repoSource || '';
  branchInput.value = selectedProject.branch || '';
  for (const label of document.querySelectorAll('#workspace-label')) {
    label.textContent = selectedProjectLabel(selectedProject);
    label.title = selectedProject.value;
  }
}

function threadUrl(name) {
  return `/thread.html?${new URLSearchParams({ name })}`;
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

function selectedProjectIsLocal() {
  return selectedProject?.kind === 'local' || looksLikeLocalPath(selectedProject?.value);
}

function sameSelectedProject(thread) {
  if (!selectedProject?.value) return true;
  if (selectedProject.kind === 'local') return cleanProjectValue(thread.repoPath) === cleanProjectValue(selectedProject.value);
  return canonicalRepo(thread.repoUrl) === canonicalRepo(selectedProject.value);
}

function renderProject(provider) {
  const project = provider?.project || {};
  const name = String(project.name || '').trim();
  const visible = name && name !== 'spanner';
  if (!projectLabel) return;
  projectLabel.hidden = !visible;
  projectLabel.textContent = visible ? name : '';
  projectLabel.title = project.home ? `Project state: ${project.home}` : `Project: ${name}`;
  document.title = visible ? `Spanner · ${name}` : 'Spanner';
}

function providerSummary(provider) {
  if (provider?.kind === 'cloudflare') {
    return provider.ready ? `Cloudflare ${provider.machine || 'sandbox'}` : 'Cloudflare broker missing';
  }
  if (provider?.kind === 'local') return 'local folders';
  return '';
}

async function loadLastLocalFolder() {
  if (!globalThis.spannerDesktop?.getLastFolder || repoUrlInput.value.trim()) return;
  try {
    const folder = await globalThis.spannerDesktop.getLastFolder();
    if (!folder || repoUrlInput.value.trim()) return;
    repoUrlInput.value = folder;
    repoHint.textContent = 'Last local folder.';
  } catch {}
}

function applyProviderMode(provider) {
  localProvider = provider?.kind === 'local';
  repoUrlInput.placeholder = localProvider ? '/Users/you/project or github.com/you/repo' : 'github.com/you/repo';
  chooseFolder.hidden = !localProvider || !globalThis.spannerDesktop?.chooseFolder;

  if (localProvider && selectedProjectIsLocal()) {
    repoPicker.disabled = true;
    repoRefresh.disabled = true;
    resetRepoSelection('Pick or paste a local folder.');
    loadLastLocalFolder();
  }
}

function renderProvider(provider) {
  renderProject(provider);
  const target = getApiBase() ? 'remote' : 'local';
  const summary = providerSummary(provider);
  providerBanner.dataset.tone = provider?.ready === false ? 'error' : 'success';
  providerBanner.textContent = provider
    ? [target, provider.kind, summary].filter(Boolean).join(' · ')
    : target;
  applyProviderMode(provider);
  renderWorkspaceSwitcher();
}

function renderModelOptions(model, options = []) {
  const modelLabel = model === 'Pi default model' ? 'main agent model' : model;
  const selected = localStorage.getItem(MODEL_REF_KEY) || modelRefInput.value || '';
  const selectedValue = selected === model || selected === 'Pi default model' ? '' : selected;
  const values = [];
  const seen = new Set();
  for (const value of [...(Array.isArray(options) ? options : []), selectedValue]) {
    const text = String(value || '').trim();
    if (!text || text === model || text === modelLabel || text === 'Pi default model' || seen.has(text)) continue;
    seen.add(text);
    values.push(text);
  }

  modelRefInput.innerHTML = `<option value="">${escapeHtml(modelLabel)}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  setModelRef(selectedValue);
  modelRefInput.title = values.length
    ? `Model: ${modelLabel}\nOptions: ${values.join(', ')}`
    : `Model: ${modelLabel}`;
}

function renderPiDefaults(defaults = {}) {
  const model = String(defaults.model || defaults.agent || 'main agent model').trim();
  defaultThinkingLevel = String(defaults.thinking || 'xhigh').trim();
  renderModelOptions(model, defaults.models);
  renderThinkingLevel();
}

function renderAuthPill(node, labelNode, ok, title, label) {
  node.dataset.status = ok ? 'authed' : 'missing';
  node.title = title;
  node.setAttribute('aria-label', title);
  labelNode.textContent = label;
}

function resetRepoSelection(message) {
  selectedRepo = null;
  repoSourceInput.value = '';
  repoPicker.value = '';
  if (message) repoHint.textContent = message;
}

function renderCodexAuth(status) {
  const configured = Boolean(status.configured);
  renderAuthPill(codexAuthPill, codexAuthLabel, configured, configured ? `Codex: ${status.source || 'signed in'}` : 'Codex: signed out', 'codex');
}

function renderGitHubAuth(status) {
  const connected = Boolean(status.connected);
  const login = status.user?.login || '';
  renderAuthPill(githubAuthPill, githubAuthLabel, connected, connected ? `GitHub: ${login || 'connected'}` : status.configured ? 'GitHub: signed out' : 'GitHub: not configured', 'github');
  renderGitHubSignIn(status);
  repoPicker.disabled = !connected;
  repoRefresh.disabled = !connected;
  if (connected) {
    const hydrated = hydrateCachedGitHubRepos(status);
    if (!hydrated) repoHint.textContent = 'Loading repos…';
    void loadGitHubRepos().catch((error) => {
      repoHint.textContent = hydrated && githubRepos.length ? `${githubRepos.length} repos · refresh failed` : error.message;
    });
  } else {
    githubRepos = [];
    githubRepoRefreshPromise = null;
    repoPicker.innerHTML = '<option value="">Sign in first</option>';
    const message = selectedProjectIsLocal()
      ? status.configured ? 'Local folder selected. Sign in to also pick GitHub repos.' : 'Local folder selected.'
      : status.configured ? 'Sign in to continue.' : 'GitHub OAuth missing.';
    resetRepoSelection(message);
  }
}

function renderAuthError(message) {
  codexAuthPill.dataset.status = 'error';
  githubAuthPill.dataset.status = 'error';
  codexAuthPill.title = message;
  githubAuthPill.title = message;
  if (githubSigninCard) githubSigninCard.hidden = true;
  threadForm.hidden = false;
  if (agentsSection) agentsSection.hidden = false;
  repoPicker.disabled = true;
  repoRefresh.disabled = true;
}

async function loadCodexAuth() {
  const status = await fetchJson('/api/auth/openai-codex');
  renderCodexAuth(status);
}

async function loadGitHubAuth() {
  const status = await fetchJson('/api/auth/github');
  renderGitHubAuth(status);
  return status;
}

function renderRepoOptions(repos, meta = {}) {
  const selectedValue = String(selectedRepo?.id || repoPicker.value || '');
  const choices = ['<option value="">GitHub repos</option>'];
  for (const repo of repos) {
    choices.push(`<option value="${escapeHtml(repo.id)}">${escapeHtml(repo.fullName)}${repo.private ? ' · private' : ''}</option>`);
  }
  repoPicker.innerHTML = choices.join('');
  if (selectedValue && repos.some((repo) => String(repo.id) === selectedValue)) repoPicker.value = selectedValue;
  repoHint.textContent = repos.length ? `${repos.length} repos${meta.refreshing ? ' · updating…' : ''}` : meta.refreshing ? 'Loading repos…' : 'No repos';
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
  threadStatus.textContent = message;
}

function renderGitHubSignIn(status) {
  const connected = Boolean(status.connected);
  const desktop = Boolean(globalThis.spannerDesktop);
  const showGate = !desktop && !localProvider && !connected && status.configured;
  if (githubSigninCard) githubSigninCard.hidden = !showGate;
  threadForm.hidden = showGate;
  if (agentsSection) agentsSection.hidden = showGate;
  for (const button of githubSigninButtons) {
    button.hidden = desktop || connected || !status.configured;
    button.disabled = !status.configured;
  }
  if (githubSigninCopy && status.configured) githubSigninCopy.textContent = 'Sign in once to launch agents against private repos.';
  if (showGate) setSignInStatus('Sign in with GitHub to launch agents.');
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

function statusClass(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'unknown';
}

function effectiveThreadStatus(thread) {
  const runStatus = String(thread?.runStatus || '').toLowerCase();
  return runStatus && runStatus !== 'unknown' ? runStatus : String(thread?.status || '').toLowerCase();
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

function canDismissFinishedIndicator(rawStatus, active) {
  return !active && ['completed', 'ready'].includes(rawStatus);
}

function hasFreshFinishedIndicator(thread) {
  const rawStatus = effectiveThreadStatus(thread) || 'unknown';
  return isSettledThread(thread) && canDismissFinishedIndicator(rawStatus, isActiveThread(thread)) && !seenFinishedThreads.has(finishedIndicatorKey(thread, rawStatus));
}

function formatFinishedAgo(value) {
  const elapsed = formatElapsed(value).replace(/m\b/g, ' min');
  return elapsed ? `finished ${elapsed} ago` : '';
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
    selectedProject: selectedProject?.value || '',
    expanded: settledShelfExpanded,
    visible: settledVisibleCount,
    settled: sortedSetSignature(settledThreadNames),
    selected: sortedSetSignature(selectedSidebarThreadNames),
    seen: sortedSetSignature(seenFinishedThreads),
    threads: threads.map(sidebarThreadRenderSignature),
  });
}

function isActiveThread(thread) {
  return ['launching', 'starting', 'queued', 'running'].includes(effectiveThreadStatus(thread));
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

function agentSearchText(thread) {
  const rawStatus = effectiveThreadStatus(thread) || 'unknown';
  return [
    thread?.title,
    thread?.name,
    rawStatus,
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
  const settleLabel = settleableCount > 0 ? `Settle ${settleableCount}` : 'Settle';
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

function notifyFinishedThreads(threads) {
  const nextStatuses = new Map();
  for (const thread of threads) {
    const name = String(thread?.name || '');
    const rawStatus = effectiveThreadStatus(thread) || 'unknown';
    if (name) nextStatuses.set(name, rawStatus);
    const wasActive = isActiveThread({ runStatus: knownThreadStatuses.get(name) });
    if (!loadedThreadSnapshot || !name || !wasActive || isActiveThread(thread) || !canSettleThread(thread)) continue;
    const key = finishedIndicatorKey(thread, rawStatus);
    if (notifiedFinishToasts.has(key)) continue;
    notifiedFinishToasts.add(key);
    const title = rawStatus === 'failed' ? 'Agent failed' : 'Agent finished';
    const detail = [thread.title || thread.name, finishedOutcome(thread, rawStatus)].filter(Boolean).join(' · ');
    showAgentToast(title, detail, rawStatus === 'failed' ? 'error' : 'success');
  }
  knownThreadStatuses = nextStatuses;
  loadedThreadSnapshot = true;
}

function runtimeStart(thread) {
  return thread.startedAt || thread.createdAt || thread.updatedAt || '';
}

function threadLane(thread) {
  return isActiveThread(thread) ? 'running' : 'done';
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

function sidebarThreadProjectLabel(thread) {
  return folderLabel(thread?.repoPath || thread?.repoUrl || selectedProject?.value || '');
}

function sidebarThreadProjectKey(thread) {
  return cleanProjectValue(thread?.repoPath || thread?.repoUrl || selectedProject?.value || '');
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

function projectFromScopeValue(value, label = folderLabel(value)) {
  const cleanValue = cleanProjectValue(value);
  if (!cleanValue) return null;
  const local = looksLikeLocalPath(cleanValue);
  return {
    kind: local ? 'local' : 'git',
    value: cleanValue,
    label: label || folderLabel(cleanValue),
    repoSource: local ? '' : 'github',
    branch: '',
  };
}

function writeSelectedProject(project) {
  if (!project?.value) return;
  selectedProject = project;
  localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
  applySelectedProject();
  renderWorkspaceSwitcher();
  renderWorkspaceProjectLightbox();
  renderThreads(currentWorkspaceThreads, { suggestions: false });
}

function selectedScopeProject() {
  if (!sidebarProjectScope || sidebarProjectScope === 'all') return null;
  const project = sidebarProjects(currentWorkspaceThreads).find((entry) => entry.key === sidebarProjectScope);
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
  const activeMeta = thread.branch || detail || outcome;
  const activeRuntime = runtime
    ? `<time class="runtime-label" data-runtime-start="${escapeHtml(start)}" data-runtime-status="${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)} ${escapeHtml(sidebarDurationLabel(runtime))}</time>`
    : '';
  const indicatorKey = settled && canDismissFinishedIndicator(rawStatus, running) ? finishedIndicatorKey(thread, rawStatus) : '';
  const indicatorSeen = indicatorKey && seenFinishedThreads.has(indicatorKey);
  const indicatorAttrs = indicatorKey && !indicatorSeen
    ? `role="button" tabindex="0" aria-label="hide finished indicator" title="hide finished indicator" data-finished-indicator="${escapeHtml(indicatorKey)}"`
    : 'aria-hidden="true"';
  const displayTitle = thread.title || thread.name;
  const projectLabelText = sidebarThreadProjectLabel(thread);
  const projectKeyText = sidebarThreadProjectKey(thread);
  const settleButton = canSettleThread(thread) && !settled
    ? `<button class="textbtn archive-thread" type="button" data-settle-thread="${escapeHtml(thread.name)}" aria-label="Settle thread">settle</button>`
    : '';
  const unsettleButton = settled
    ? `<button class="textbtn archive-thread" type="button" data-unsettle-thread="${escapeHtml(thread.name)}" aria-label="Un-settle thread">unsettle</button>`
    : '';
  const stopButton = running
    ? `<button class="textbtn stop-thread" type="button" data-stop-thread="${escapeHtml(thread.name)}">stop</button>`
    : '';
  const selected = isSidebarThreadSelected(thread);
  const selectButton = renderSidebarSelectButton(thread, selected);
  const activeBody = `
    <a class="inbox-main" href="${escapeHtml(threadUrl(thread.name))}"${indicatorKey ? ` data-finished-thread="${escapeHtml(indicatorKey)}"` : ''}>
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
    <a class="inbox-main" href="${escapeHtml(threadUrl(thread.name))}"${indicatorKey ? ` data-finished-thread="${escapeHtml(indicatorKey)}"` : ''}>
      ${sidebarProjectIcon(projectLabelText)}
      <span class="sidebar-thread-title-row"><strong>${escapeHtml(displayTitle)}</strong></span>
      ${inactiveMeta}
    </a>
    <span class="inbox-side">${selectButton}${unsettleButton}</span>
    ${outcome ? `<small class="answer-preview">${escapeHtml(outcome)}</small>` : ''}
  `;
  return `
    <div class="inbox-item action-thread sidebar-thread ${modeClass} ${badgeClass}${selected ? ' is-selected' : ''}" data-sidebar-thread-row data-thread-name="${escapeHtml(thread.name)}" data-thread-project-key="${escapeHtml(projectKeyText)}" aria-selected="${selected ? 'true' : 'false'}"${jumpLabel ? ` data-jump-index="${escapeHtml(jumpLabel)}"` : ''}>
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
    label.textContent = `${status} ${sidebarDurationLabel(formatElapsed(label.dataset.runtimeStart, Date.now()))}`;
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
  renderWorkspaceSwitcher();
  indicator.classList.add('is-seen');
  for (const attribute of FINISHED_INDICATOR_RESET_ATTRIBUTES) {
    indicator.removeAttribute(attribute);
  }
  indicator.setAttribute('aria-hidden', 'true');
  updateFinishedIndicatorCount();
}

function clipSuggestionText(value, max = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function workspaceSuggestionThreads(threads) {
  return [...threads]
    .filter((thread) => !isActiveThread(thread))
    .sort((left, right) => finishedAtMs(right) - finishedAtMs(left))
    .slice(0, 6);
}

function workspaceSuggestionThreadContext(thread) {
  return {
    title: clipSuggestionText(thread?.title || thread?.name, 120),
    taskPrompt: clipSuggestionText(thread?.taskPrompt, 700),
    initialPrompt: clipSuggestionText(thread?.initialPrompt, 700),
    finalAnswerSummary: finalAnswerSummary(thread, 700),
    finalTurnStatus: clipSuggestionText(thread?.finalTurnStatus, 80),
    finalTurnReason: clipSuggestionText(thread?.finalTurnReason, 220),
    status: clipSuggestionText(thread?.status, 80),
    runStatus: clipSuggestionText(thread?.runStatus, 80),
    warning: clipSuggestionText(thread?.warning, 220),
    finishedAt: finishedAt(thread),
  };
}

async function loadWorkspaceLaunchSuggestions(threads) {
  const source = workspaceSuggestionThreads(threads).map(workspaceSuggestionThreadContext);
  if (!source.length) {
    workspaceSuggestionSignature = '';
    renderLaunchSuggestions([]);
    return;
  }

  const signature = JSON.stringify(source);
  if (signature === workspaceSuggestionSignature) return;
  workspaceSuggestionSignature = signature;
  const requestId = ++workspaceSuggestionRequestId;

  try {
    const payload = await fetchJson('/api/workspace-suggestions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ threads: source }),
    });
    if (requestId === workspaceSuggestionRequestId) renderLaunchSuggestions(payload.suggestions || []);
  } catch {
    if (requestId === workspaceSuggestionRequestId) renderLaunchSuggestions([]);
  }
}

function renderLaunchSuggestions(suggestions) {
  if (!launchSuggestions) return;
  if (!suggestions?.length) {
    launchSuggestions.innerHTML = launchSuggestionsInitialHtml;
    return;
  }
  launchSuggestions.innerHTML = suggestions.map((suggestion) => `
    <button type="button" data-suggested-prompt="${escapeHtml(suggestion.prompt)}"><strong>${escapeHtml(suggestion.label)}</strong><span>${escapeHtml(clipSuggestionText(suggestion.displayPrompt || suggestion.prompt, 220))}</span></button>
  `).join('');
}

function renderThreads(threads, options = {}) {
  settledThreadNames = readSettledThreadNames();
  currentWorkspaceThreads = Array.isArray(threads) ? threads : [];
  updateProjectScopeMenu(currentWorkspaceThreads);
  const scopedThreads = scopedAgentThreads(currentWorkspaceThreads);
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
  const hiddenSettledCount = Math.max(0, settledThreads.length - renderedSettledThreads.length);
  const renderedThreads = [...activeThreads, ...renderedSettledThreads];
  pruneSidebarSelection(renderedThreads);

  const freshFinishedCount = settledThreads.filter(hasFreshFinishedIndicator).length;
  if (options.suggestions !== false) loadWorkspaceLaunchSuggestions(currentWorkspaceThreads).catch(() => {});
  const list = currentThreadsListNode();
  if (!list) {
    syncRuntimeTick();
    return;
  }
  const renderSignature = sidebarRenderSignature(currentWorkspaceThreads);
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
      ? 'No matching settled agents.'
      : sidebarProjectScope !== 'all' && !scopedThreads.length
        ? 'No agents in this project yet.'
      : activeThreads.length
        ? 'No settled agents yet.'
        : 'No agents yet.';
  const settledLabel = settledShelfExpanded ? 'Settled' : `Settled (${settledThreads.length})`;
  const settledSection = `
    <section class="action-lane sidebar-inbox-section sidebar-inbox-settled" aria-label="Settled agents">
      <div class="action-lane-head">
        <button class="settled-shelf-toggle" type="button" data-settled-shelf-toggle aria-expanded="${settledShelfExpanded ? 'true' : 'false'}">
          <span>${escapeHtml(settledLabel)}</span>
          <span class="settled-shelf-rule" aria-hidden="true"></span>
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

function syncThreadsListMount() {
  const list = currentThreadsListNode();
  if (!list || list === syncedThreadsList) return;
  syncedThreadsList = list;
  applySelectedProject();
  renderThreads(currentWorkspaceThreads.length ? currentWorkspaceThreads : cachedWorkspaceThreads(), { suggestions: false });
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

async function loadThreads() {
  const payload = await fetchJson('/api/threads');
  workspaceSwitcherThreads = payload.threads || [];
  renderProvider(payload.provider);
  renderPiDefaults(payload.defaults || {});
  cacheWorkspaceThreads(workspaceSwitcherThreads);
  cacheGlobalSidebarThreads(workspaceSwitcherThreads);
  notifyFinishedThreads(workspaceSwitcherThreads);
  renderThreads(workspaceSwitcherThreads);
  return payload;
}

async function loadWorkspaceAuth() {
  const [codex, github] = await Promise.all([
    loadCodexAuth(),
    loadGitHubAuth(),
  ]);
  return { codex, github };
}

async function loadWorkspaceBootstrap() {
  const payload = await fetchJson('/api/bootstrap?page=workspace&fast=1');
  workspaceSwitcherThreads = payload.threads || [];
  renderProvider(payload.provider);
  renderPiDefaults(payload.defaults || {});
  cacheWorkspaceThreads(workspaceSwitcherThreads);
  cacheGlobalSidebarThreads(workspaceSwitcherThreads);
  notifyFinishedThreads(workspaceSwitcherThreads);
  renderThreads(workspaceSwitcherThreads);
  if (payload.codex?.deferred || payload.github?.deferred) {
    void loadWorkspaceAuth().catch((error) => {
      threadStatus.textContent = error.message;
    });
  } else {
    renderCodexAuth(payload.codex || {});
    renderGitHubAuth(payload.github || {});
  }
  return payload;
}

async function reloadControlData() {
  try {
    await loadWorkspaceBootstrap();
  } catch (error) {
    renderAuthError(error.message);
    providerBanner.dataset.tone = 'error';
    providerBanner.textContent = error.message;
    threadStatus.textContent = error.message;
    repoHint.textContent = error.message;
  }
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
  return currentWorkspaceThreads.find((thread) => thread.name === name) || null;
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
    canSettle && !settled ? `<button type="button" role="menuitem" data-thread-menu-action="settle">Settle thread</button>` : '',
    settled ? `<button type="button" role="menuitem" data-thread-menu-action="unsettle">Un-settle thread</button>` : '',
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
    await loadThreads();
    return;
  }
  if (action === 'settle') {
    markThreadSettled(thread.name);
    renderThreads(currentWorkspaceThreads, { suggestions: false });
    return;
  }
  if (action === 'unsettle') {
    markThreadUnsettled(thread.name);
    renderThreads(currentWorkspaceThreads, { suggestions: false });
    return;
  }
  if (action === 'delete') {
    if (!confirm(`Delete "${thread.title || thread.name}"?`)) return;
    await fetchJson(`/api/threads/${encodeURIComponent(thread.name)}/delete`, { method: 'POST' });
    await loadThreads();
  }
}

getBrowserSessionId();
applySelectedProject();
renderWorkspaceSwitcher();
void loadRecentProjects();
renderCachedWorkspaceThreads();
loadRunControls();
modelRefInput.addEventListener('change', saveRunControls);
thinkingLevelInput.addEventListener('input', () => {
  renderThinkingLevel();
  saveRunControls();
});
imageInput?.addEventListener('change', () => updateImageStatus(imageInput, imageStatus));
bindImageDropZone(threadForm, imageInput, imageStatus);
submitOnEnter(promptInput, threadForm, threadSubmit);
bindSidebarPromptLightbox({ fetchJson, makeThreadUrl: threadUrl });
workspaceProjectLightboxTrigger?.addEventListener('click', () => setWorkspaceProjectLightboxOpen(true));
workspaceProjectLightboxClose?.addEventListener('click', () => setWorkspaceProjectLightboxOpen(false));
workspaceProjectLightbox?.addEventListener('cancel', () => {
  workspaceProjectLightboxTrigger?.setAttribute('aria-expanded', 'false');
});
workspaceProjectLightbox?.addEventListener('click', (event) => {
  if (event.target === workspaceProjectLightbox) setWorkspaceProjectLightboxOpen(false);
});
workspaceProjectLightboxSearch?.addEventListener('input', () => {
  workspaceProjectLightboxSearchQuery = workspaceProjectLightboxSearch.value;
  renderWorkspaceProjectLightbox();
});
workspaceProjectLightboxSearch?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  workspaceProjectLightboxList?.querySelector('[data-workspace-lightbox-project-index]')?.click();
});
workspaceProjectLightboxList?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-workspace-lightbox-project-index]');
  if (!button) return;
  selectWorkspaceProject(recentProjects[Number(button.dataset.workspaceLightboxProjectIndex)]);
});
workspaceProjectLightboxImages?.addEventListener('click', () => imageInput?.click());
document.addEventListener('input', (event) => {
  if (event.target?.matches?.('#agent-search')) {
    setSettledVisibleCount(INITIAL_SETTLED_VISIBLE_COUNT);
    renderThreads(currentWorkspaceThreads, { suggestions: false });
  }
});

repoRefresh.addEventListener('click', async () => {
  repoRefresh.disabled = true;
  repoHint.textContent = 'Loading…';
  try {
    await loadGitHubRepos();
  } catch (error) {
    repoHint.textContent = error.message;
  } finally {
    repoRefresh.disabled = false;
  }
});

chooseFolder.addEventListener('click', async () => {
  const folder = await globalThis.spannerDesktop?.chooseFolder?.(repoUrlInput.value.trim());
  if (!folder) return;
  repoUrlInput.value = folder;
  resetRepoSelection('Local folder selected.');
});

repoPicker.addEventListener('change', () => {
  selectedRepo = githubRepos.find((entry) => String(entry.id) === repoPicker.value) || null;
  if (!selectedRepo) {
    repoSourceInput.value = '';
    return;
  }
  repoSourceInput.value = 'github';
  repoUrlInput.value = selectedRepo.cloneUrl;
  branchInput.value = selectedRepo.defaultBranch || '';
  repoHint.textContent = `${selectedRepo.fullName}${selectedRepo.private ? ' · private' : ''}`;
});

repoUrlInput.addEventListener('input', () => {
  if (!selectedRepo) return;
  if (repoUrlInput.value.trim() === selectedRepo.cloneUrl) return;
  resetRepoSelection('Manual URL');
});

threadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(threadForm);
  const repoInput = String(form.get('repoUrl') || '').trim();
  saveRunControls();
  threadSubmit.disabled = true;
  threadStatus.textContent = 'Starting…';
  try {
    const images = await filesToImageAttachments(imageInputFiles(imageInput));
    const localProject = selectedProjectIsLocal();
    const body = {
      ...(localProject ? { repoPath: repoInput } : { repoUrl: normalizeRepoUrl(repoInput) }),
      branch: form.get('branch'),
      name: form.get('name'),
      prompt: form.get('prompt'),
      repoSource: localProject ? '' : form.get('repoSource'),
      modelRef: modelRefInput.value,
      thinkingLevel: thinkingLevelValue(),
      images,
    };
    const payload = await fetchJson('/api/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    captureSpannerEvent('thread_created', {
      source: localProject ? 'local' : 'github',
      has_branch: Boolean(body.branch),
      has_images: images.length > 0,
      model_ref_set: Boolean(modelRefInput.value),
      thinking_level: thinkingLevelValue(),
    });
    if (localProject) {
      try {
        await globalThis.spannerDesktop?.rememberFolder?.(repoInput);
      } catch {}
    }
    clearImageInput(imageInput);
    updateImageStatus(imageInput, imageStatus);
    location.href = threadUrl(payload.thread.name);
  } catch (error) {
    providerBanner.dataset.tone = 'error';
    providerBanner.textContent = error.message;
    threadStatus.textContent = error.message;
    threadSubmit.disabled = false;
  }
});

launchSuggestions?.addEventListener('click', (event) => {
  const button = event.target?.closest?.('[data-suggested-prompt]');
  if (!button) return;
  promptInput.value = button.dataset.suggestedPrompt || '';
  promptInput.focus();
  threadStatus.textContent = 'tweak the suggestion, then start agent';
});

for (const button of githubSigninButtons) button.addEventListener('click', () => startGitHubSignIn());

workspaceSwitcherToggle?.addEventListener('click', () => {
  setWorkspaceSwitcherOpen(workspaceSwitcherMenu?.hidden !== false);
});

workspaceSwitcherSearch?.addEventListener('input', () => {
  workspaceSwitcherSearchQuery = workspaceSwitcherSearch.value;
  renderWorkspaceSwitcher();
});

workspaceSwitcherRecents?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-workspace-project-index]');
  if (!button) return;
  switchWorkspaceProject(recentProjects[Number(button.dataset.workspaceProjectIndex)]);
});

document.addEventListener('mousedown', (event) => {
  if (!workspaceSwitcherMenu || workspaceSwitcherMenu.hidden) return;
  if (workspaceSwitcherMenu.contains(event.target) || workspaceSwitcherToggle?.contains(event.target)) return;
  setWorkspaceSwitcherOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setWorkspaceSwitcherOpen(false);
});

document.addEventListener('click', async (event) => {
  if (!event.target?.closest?.('#threads-list')) return;

  const selectVisible = event.target.closest('[data-sidebar-select-visible]');
  if (selectVisible) {
    selectVisibleSettleableThreads(currentWorkspaceThreads.filter((thread) => renderedSidebarThreadNames.includes(thread.name)));
    renderThreads(currentWorkspaceThreads, { suggestions: false });
    return;
  }

  const batchSettle = event.target.closest('[data-sidebar-batch-settle]');
  if (batchSettle) {
    const count = settleSelectedSidebarThreads();
    renderThreads(currentWorkspaceThreads, { suggestions: false });
    if (count > 0) threadStatus.textContent = `Settled ${count} agent${count === 1 ? '' : 's'}.`;
    return;
  }

  const selectionClear = event.target.closest('[data-sidebar-selection-clear]');
  if (selectionClear) {
    clearSidebarSelection();
    renderThreads(currentWorkspaceThreads, { suggestions: false });
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
    stopButton.textContent = 'stopping…';
    try {
      await fetchJson(`/api/threads/${encodeURIComponent(stopButton.dataset.stopThread)}/stop`, { method: 'POST' });
      await loadThreads();
    } catch (error) {
      stopButton.disabled = false;
      stopButton.textContent = 'stop';
      threadStatus.textContent = error.message;
    }
    return;
  }

  const selectionButton = event.target.closest('[data-sidebar-thread-select]');
  if (selectionButton) {
    event.preventDefault();
    toggleSidebarThreadSelection(selectionButton.dataset.sidebarThreadSelect, { range: event.shiftKey });
    renderThreads(currentWorkspaceThreads, { suggestions: false });
    return;
  }

  const settleButton = event.target.closest('[data-settle-thread]');
  if (settleButton) {
    markThreadSettled(settleButton.dataset.settleThread);
    selectedSidebarThreadNames.delete(settleButton.dataset.settleThread);
    renderThreads(currentWorkspaceThreads, { suggestions: false });
    return;
  }

  const unsettleButton = event.target.closest('[data-unsettle-thread]');
  if (unsettleButton) {
    markThreadUnsettled(unsettleButton.dataset.unsettleThread);
    selectedSidebarThreadNames.delete(unsettleButton.dataset.unsettleThread);
    renderThreads(currentWorkspaceThreads, { suggestions: false });
    return;
  }

  const row = event.target?.closest?.('[data-sidebar-thread-row]');
  if (row && (event.metaKey || event.ctrlKey || event.shiftKey)) {
    event.preventDefault();
    toggleSidebarThreadSelection(row.dataset.threadName, { range: event.shiftKey });
    renderThreads(currentWorkspaceThreads, { suggestions: false });
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
      threadStatus.textContent = error.message;
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
    renderThreads(currentWorkspaceThreads, { suggestions: false });
    return;
  }

  if (!event.target?.closest?.('.sidebar-command-row')) closeScopeMenu();

  const showMore = event.target?.closest?.('[data-settled-show-more]');
  if (showMore) {
    setSettledVisibleCount(settledVisibleCount + SETTLED_TAIL_PAGE_COUNT);
    renderThreads(currentWorkspaceThreads, { suggestions: false });
    return;
  }

  const toggle = event.target?.closest?.('[data-settled-shelf-toggle]');
  if (!toggle) return;
  setSettledShelfExpanded(!settledShelfExpanded);
  renderThreads(currentWorkspaceThreads, { suggestions: false });
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
    promptInput?.focus();
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
      renderThreads(currentWorkspaceThreads, { suggestions: false });
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
      renderThreads(currentWorkspaceThreads, { suggestions: false });
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

reloadControlData();
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  loadThreads().catch(() => {});
}, 10000);
