import { toast } from 'sonner';

import { captureSpannerEvent } from '../lib/posthog.js';
import { redirectIfAuthRequired } from './auth-redirect.js';
import './appearance.js?v=palette-2';
import { bindImageDropZone, clearImageInput, filesToImageAttachments, imageInputFiles, updateImageStatus } from './image-attachments.js';
import { submitOnEnter } from './submit-on-enter.js';

const BROWSER_SESSION_KEY = 'spannerBrowserSession';
const MODEL_REF_KEY = 'spannerModelRef';
const THINKING_LEVEL_KEY = 'spannerThinkingLevel';
const PROJECT_KEY = 'spannerSelectedProject';
const RECENT_PROJECTS_KEY = 'spannerRecentProjects';
const SEEN_FINISHED_THREADS_KEY = 'spannerSeenFinishedThreads';
const WORKSPACE_THREADS_CACHE_KEY = 'spannerWorkspaceThreadsCache';
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const ARCHIVEABLE_THREAD_STATUSES = ['completed', 'ready', 'failed'];
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
let selectedRepo = null;
let selectedProject = readSelectedProject();
let recentProjects = readCachedRecentProjects();
let workspaceSwitcherThreads = [];
let currentWorkspaceThreads = [];
let workspaceSwitcherSearchQuery = '';
let localProvider = false;
let defaultThinkingLevel = 'xhigh';
let runtimeTickTimer = null;
let finishedThreadNames = [];
let seenFinishedThreads = readSeenFinishedThreads();
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
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
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

function renderCachedWorkspaceThreads() {
  const threads = cachedWorkspaceThreads().filter(sameSelectedProject);
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
  return selectedProject?.kind === 'local' || localProvider;
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
  repoUrlInput.placeholder = localProvider ? '/Users/you/project' : 'github.com/you/repo';
  chooseFolder.hidden = !localProvider || !globalThis.spannerDesktop?.chooseFolder;

  if (localProvider) {
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
  repoPicker.disabled = localProvider || !connected;
  repoRefresh.disabled = localProvider || !connected;
  if (!connected && !localProvider) {
    githubRepos = [];
    repoPicker.innerHTML = '<option value="">Sign in first</option>';
    resetRepoSelection(status.configured ? 'Sign in to continue.' : 'GitHub OAuth missing.');
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

function renderRepoOptions(repos) {
  const options = ['<option value="">GitHub repos</option>'];
  for (const repo of repos) {
    options.push(`<option value="${escapeHtml(repo.id)}">${escapeHtml(repo.fullName)}${repo.private ? ' · private' : ''}</option>`);
  }
  repoPicker.innerHTML = options.join('');
  repoHint.textContent = repos.length ? `${repos.length} repos` : 'No repos';
}

async function loadGitHubRepos() {
  const payload = await fetchJson('/api/github/repos');
  githubRepos = payload.repos || [];
  renderRepoOptions(githubRepos);
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
    button.hidden = desktop || localProvider || connected || !status.configured;
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
  return canDismissFinishedIndicator(rawStatus, isActiveThread(thread)) && !seenFinishedThreads.has(finishedIndicatorKey(thread, rawStatus));
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

function canArchiveThread(thread) {
  return ARCHIVEABLE_THREAD_STATUSES.includes(effectiveThreadStatus(thread));
}

function notifyFinishedThreads(threads) {
  const nextStatuses = new Map();
  for (const thread of threads) {
    const name = String(thread?.name || '');
    const rawStatus = effectiveThreadStatus(thread) || 'unknown';
    if (name) nextStatuses.set(name, rawStatus);
    const wasActive = isActiveThread({ runStatus: knownThreadStatuses.get(name) });
    if (!loadedThreadSnapshot || !name || !wasActive || isActiveThread(thread) || !canArchiveThread(thread)) continue;
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
  return thread.createdAt || thread.updatedAt || '';
}

function threadLane(thread) {
  return isActiveThread(thread) ? 'running' : 'done';
}

function renderThreadCard(thread) {
  const rawStatus = effectiveThreadStatus(thread) || 'unknown';
  const badgeClass = statusClass(rawStatus);
  const active = isActiveThread(thread);
  const finishedValue = finishedAt(thread);
  const finished = active ? '' : formatFinishedAgo(finishedValue);
  const detail = active ? runningActivity(thread, rawStatus) : '';
  const outcome = active ? '' : finishedOutcome(thread, rawStatus);
  const start = runtimeStart(thread);
  const runtimeEnd = active ? Date.now() : finishedValue || start;
  const runtime = formatElapsed(start, runtimeEnd, active);
  const inactiveTimes = !active ? [finished, runtime ? `ran ${runtime}` : ''].filter(Boolean) : [];
  const inactiveMeta = inactiveTimes.length ? `<span class="finished-meta">${inactiveTimes.map((text) => `<time>${escapeHtml(text)}</time>`).join('')}</span>` : '';
  const activeRuntime = active && runtime ? `<time class="runtime-label" data-runtime-start="${escapeHtml(start)}">running ${escapeHtml(runtime)}</time>` : '';
  const indicatorKey = canDismissFinishedIndicator(rawStatus, active) ? finishedIndicatorKey(thread, rawStatus) : '';
  const indicatorSeen = indicatorKey && seenFinishedThreads.has(indicatorKey);
  const indicatorAttrs = indicatorKey && !indicatorSeen
    ? `role="button" tabindex="0" aria-label="hide finished indicator" title="hide finished indicator" data-finished-indicator="${escapeHtml(indicatorKey)}"`
    : 'aria-hidden="true"';
  const displayTitle = thread.title || thread.name;
  const archiveButton = canArchiveThread(thread)
    ? `<button class="textbtn archive-thread" type="button" data-archive-thread="${escapeHtml(thread.name)}">archive</button>`
    : '';
  return `
    <div class="inbox-item action-thread ${badgeClass}">
      <span class="status-dot${indicatorSeen ? ' is-seen' : ''}" ${indicatorAttrs}></span>
      <a class="inbox-main" href="${escapeHtml(threadUrl(thread.name))}"${indicatorKey ? ` data-finished-thread="${escapeHtml(indicatorKey)}"` : ''}>
        <strong>${escapeHtml(displayTitle)}</strong>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
        ${inactiveMeta}
      </a>
      <span class="inbox-side">
        ${archiveButton}
        ${activeRuntime}
      </span>
      ${outcome ? `<small class="answer-preview">${escapeHtml(outcome)}</small>` : ''}
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
    label.textContent = `running ${formatElapsed(label.dataset.runtimeStart, Date.now(), true)}`;
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
    runtimeTickTimer = setInterval(updateRuntimeLabels, 1000);
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
  indicator.removeAttribute('role');
  indicator.removeAttribute('tabindex');
  indicator.removeAttribute('aria-label');
  indicator.removeAttribute('title');
  indicator.removeAttribute('data-finished-indicator');
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
  currentWorkspaceThreads = Array.isArray(threads) ? threads : [];
  const filteredThreads = filterAgentThreads(currentWorkspaceThreads);
  const searchActive = Boolean(agentSearchQuery());
  const lanes = [
    { key: 'running', title: 'Running', empty: searchActive ? 'No matching running agents.' : 'No agents running.' },
    { key: 'done', title: 'Recently finished', empty: searchActive && !filteredThreads.length ? 'No agents match that search.' : searchActive ? 'No matching finished agents.' : 'Nothing finished recently.' },
  ];
  const grouped = Object.fromEntries(lanes.map((lane) => [lane.key, []]));
  for (const thread of filteredThreads) grouped[threadLane(thread)].push(thread);
  grouped.done.sort((left, right) => finishedAtMs(right) - finishedAtMs(left));

  const freshFinishedCount = grouped.done.filter(hasFreshFinishedIndicator).length;
  finishedThreadNames = grouped.done.filter(canArchiveThread).map((thread) => thread.name);
  if (options.suggestions !== false) loadWorkspaceLaunchSuggestions(currentWorkspaceThreads).catch(() => {});
  const visibleLanes = grouped.running.length ? lanes : lanes.filter((lane) => lane.key !== 'running');
  const list = currentThreadsListNode();
  if (!list) {
    syncRuntimeTick();
    return;
  }
  list.innerHTML = visibleLanes.map((lane) => {
    const freshBadge = lane.key === 'done' && freshFinishedCount ? `<span class="fresh-finished-count" data-finished-indicator-count>${freshFinishedCount} new</span>` : '';
    const historyLink = lane.key === 'done' ? '<a class="textbtn lane-history" href="/history.html">history</a>' : '';
    const clearButton = lane.key === 'done' && finishedThreadNames.length ? '<button id="clear-finished-threads" class="textbtn lane-clear" type="button">clear</button>' : '';
    return `
    <section class="action-lane" aria-label="${escapeHtml(lane.title)} agents">
      <div class="action-lane-head">
        <h3>${escapeHtml(lane.title)}</h3>
        <span class="action-lane-tools">
          ${freshBadge}<span class="action-count">${grouped[lane.key].length}</span>
          ${historyLink}${clearButton}
        </span>
      </div>
      <div class="action-list">
        ${grouped[lane.key].length ? grouped[lane.key].map(renderThreadCard).join('') : `<p class="empty-state">${escapeHtml(lane.empty)}</p>`}
      </div>
    </section>
  `;
  }).join('');
  updateFinishedIndicatorCount();
  syncRuntimeTick();
}

function syncThreadsListMount() {
  const list = currentThreadsListNode();
  if (!list || list === syncedThreadsList) return;
  syncedThreadsList = list;
  applySelectedProject();
  renderThreads(currentWorkspaceThreads.length ? currentWorkspaceThreads : cachedWorkspaceThreads().filter(sameSelectedProject), { suggestions: false });
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
  const threads = workspaceSwitcherThreads.filter(sameSelectedProject);
  renderProvider(payload.provider);
  renderPiDefaults(payload.defaults || {});
  cacheWorkspaceThreads(threads);
  notifyFinishedThreads(workspaceSwitcherThreads);
  renderThreads(threads);
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
  const threads = workspaceSwitcherThreads.filter(sameSelectedProject);
  renderProvider(payload.provider);
  renderPiDefaults(payload.defaults || {});
  cacheWorkspaceThreads(threads);
  notifyFinishedThreads(workspaceSwitcherThreads);
  renderThreads(threads);
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
document.addEventListener('input', (event) => {
  if (event.target?.matches?.('#agent-search')) renderThreads(currentWorkspaceThreads, { suggestions: false });
});

repoRefresh.addEventListener('click', async () => {
  if (localProvider) return;
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
  const indicator = event.target.closest('[data-finished-indicator]');
  if (indicator) {
    event.preventDefault();
    dismissFinishedIndicator(indicator);
    return;
  }

  const finishedLink = event.target.closest('[data-finished-thread]');
  if (finishedLink) rememberSeenFinishedThread(finishedLink.dataset.finishedThread);

  const clearButton = event.target.closest('#clear-finished-threads');
  if (clearButton) {
    const names = [...finishedThreadNames];
    if (!names.length) return;
    clearButton.disabled = true;
    clearButton.textContent = 'clearing…';
    try {
      for (const name of names) {
        await fetchJson(`/api/threads/${encodeURIComponent(name)}/archive`, { method: 'POST' });
      }
      await loadThreads();
    } catch (error) {
      clearButton.disabled = false;
      clearButton.textContent = 'clear';
      threadStatus.textContent = error.message;
    }
    return;
  }

  const button = event.target.closest('[data-archive-thread]');
  if (!button) return;
  button.disabled = true;
  button.textContent = 'archiving…';
  try {
    await fetchJson(`/api/threads/${encodeURIComponent(button.dataset.archiveThread)}/archive`, { method: 'POST' });
    await loadThreads();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'archive';
    threadStatus.textContent = error.message;
  }
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
