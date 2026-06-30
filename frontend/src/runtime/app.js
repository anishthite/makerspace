import './appearance.js?v=palette-2';
import { bindImageDropZone, clearImageInput, filesToImageAttachments, imageInputFiles, updateImageStatus } from './image-attachments.js';
import { submitOnEnter } from './submit-on-enter.js';

const BROWSER_SESSION_KEY = 'makerspaceBrowserSession';
const MODEL_REF_KEY = 'makerspaceModelRef';
const THINKING_LEVEL_KEY = 'makerspaceThinkingLevel';
const PROJECT_KEY = 'makerspaceSelectedProject';
const SEEN_FINISHED_THREADS_KEY = 'makerspaceSeenFinishedThreads';
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const ARCHIVEABLE_THREAD_STATUSES = ['completed', 'ready', 'failed'];
const API_BASE = String(import.meta.env.VITE_MAKERSPACE_API_BASE || '').trim().replace(/\/+$/, '');

const providerBanner = document.querySelector('#provider-banner');
const projectLabel = document.querySelector('#project-label');
const workspaceLabel = document.querySelector('#workspace-label');
const actionSummary = document.querySelector('#action-summary');
const codexAuthPill = document.querySelector('#codex-auth-pill');
const codexAuthLabel = document.querySelector('#codex-auth-label');
const githubAuthPill = document.querySelector('#github-auth-pill');
const githubAuthLabel = document.querySelector('#github-auth-label');
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
const threadsList = document.querySelector('#threads-list');
const refreshThreads = document.querySelector('#refresh-threads');

let githubRepos = [];
let selectedRepo = null;
let selectedProject = readSelectedProject();
let localProvider = false;
let defaultThinkingLevel = 'xhigh';
let runtimeTickTimer = null;
let finishedThreadNames = [];
let seenFinishedThreads = readSeenFinishedThreads();
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
  const headers = { 'x-makerspace-session': getBrowserSessionId() };
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

function compactProjectLabel(value) {
  const text = cleanProjectValue(value)
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '');
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join('/') || text || 'workspace';
}

function applySelectedProject() {
  if (!selectedProject) {
    location.replace('/');
    return;
  }
  repoUrlInput.value = selectedProject.value || '';
  repoSourceInput.value = selectedProject.repoSource || '';
  branchInput.value = selectedProject.branch || '';
  if (workspaceLabel) {
    workspaceLabel.textContent = selectedProject.label || compactProjectLabel(selectedProject.value);
    workspaceLabel.title = selectedProject.value;
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
  const visible = name && name !== 'makerspace';
  if (!projectLabel) return;
  projectLabel.hidden = !visible;
  projectLabel.textContent = visible ? name : '';
  projectLabel.title = project.home ? `Project state: ${project.home}` : `Project: ${name}`;
  document.title = visible ? `Makerspace · ${name}` : 'Makerspace';
}

function providerSummary(provider) {
  if (provider?.kind === 'daytona') {
    const env = provider.env || {};
    const auth = env.apiKey ? 'api key' : 'no api key';
    const snapshot = env.snapshot ? 'snapshot' : 'default image';
    return `${auth}; ${snapshot}; stop ${env.autostopMinutes}m; delete ${env.autodeleteMinutes}m`;
  }
  if (provider?.kind === 'local') return 'local folders';
  return '';
}

async function loadLastLocalFolder() {
  if (!globalThis.makerspaceDesktop?.getLastFolder || repoUrlInput.value.trim()) return;
  try {
    const folder = await globalThis.makerspaceDesktop.getLastFolder();
    if (!folder || repoUrlInput.value.trim()) return;
    repoUrlInput.value = folder;
    repoHint.textContent = 'Last local folder.';
  } catch {}
}

function applyProviderMode(provider) {
  localProvider = provider?.kind === 'local';
  repoUrlInput.placeholder = localProvider ? '/Users/you/project' : 'github.com/you/repo';
  chooseFolder.hidden = !localProvider || !globalThis.makerspaceDesktop?.chooseFolder;

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
  repoPicker.disabled = localProvider || !connected;
  repoRefresh.disabled = localProvider || !connected;
  if (!connected && !localProvider) {
    githubRepos = [];
    repoPicker.innerHTML = '<option value="">Sign in first</option>';
    resetRepoSelection(status.configured ? 'Sign in in Settings.' : 'GitHub OAuth missing.');
  }
}

function renderAuthError(message) {
  codexAuthPill.dataset.status = 'error';
  githubAuthPill.dataset.status = 'error';
  codexAuthPill.title = message;
  githubAuthPill.title = message;
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

function statusClass(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'unknown';
}

function effectiveThreadStatus(thread) {
  const runStatus = String(thread?.runStatus || '').toLowerCase();
  return runStatus && runStatus !== 'unknown' ? runStatus : String(thread?.status || '').toLowerCase();
}

function repoLabel(thread) {
  const value = typeof thread === 'string' ? thread : thread.repoPath || thread.repoUrl;
  const text = String(value || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/i, '');
  return text || 'repo';
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

function canArchiveThread(thread) {
  return ARCHIVEABLE_THREAD_STATUSES.includes(effectiveThreadStatus(thread));
}

function runtimeStart(thread) {
  return thread.createdAt || thread.updatedAt || '';
}

function formatRunningTotal(starts, endValue = Date.now()) {
  const end = typeof endValue === 'number' ? endValue : Date.parse(endValue || '');
  if (Number.isNaN(end)) return '';
  let totalMs = 0;
  for (const startValue of starts) {
    const start = Date.parse(startValue || '');
    if (!Number.isNaN(start)) totalMs += Math.max(0, end - start);
  }
  return totalMs ? formatDurationSeconds(Math.floor(totalMs / 1000), true) : '';
}

function renderActionSummary(runningCount, doneCount, runningStarts = []) {
  actionSummary.dataset.runningCount = String(runningCount);
  actionSummary.dataset.doneCount = String(doneCount);
  actionSummary.dataset.runningStarts = JSON.stringify(runningStarts);
  const total = formatRunningTotal(runningStarts);
  actionSummary.textContent = `${runningCount} running${total ? ` for ${total} total` : ''} · ${doneCount} recently finished`;
}

function updateActionSummary() {
  let runningStarts = [];
  try {
    runningStarts = JSON.parse(actionSummary.dataset.runningStarts || '[]');
  } catch {}
  renderActionSummary(Number(actionSummary.dataset.runningCount || 0), Number(actionSummary.dataset.doneCount || 0), runningStarts);
}

function threadLane(thread) {
  return isActiveThread(thread) ? 'running' : 'done';
}

function renderThreadCard(thread) {
  const rawStatus = effectiveThreadStatus(thread) || 'unknown';
  const badgeClass = statusClass(rawStatus);
  const repo = repoLabel(thread);
  const branch = thread.branch ? ` · ${thread.branch}` : '';
  const active = isActiveThread(thread);
  const finishedValue = finishedAt(thread);
  const finished = active ? '' : formatFinishedAgo(finishedValue);
  const detail = active ? runningActivity(thread, rawStatus) : `${repo}${branch}`;
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
    ? `<button class="textbtn archive-thread" type="button" data-archive-thread="${escapeHtml(thread.name)}">mark as done</button>`
    : '';
  return `
    <div class="inbox-item action-thread ${badgeClass}">
      <span class="status-dot${indicatorSeen ? ' is-seen' : ''}" ${indicatorAttrs}></span>
      <a class="inbox-main" href="${escapeHtml(threadUrl(thread.name))}"${indicatorKey ? ` data-finished-thread="${escapeHtml(indicatorKey)}"` : ''}>
        <strong>${escapeHtml(displayTitle)}</strong>
        <small>${escapeHtml(detail)}</small>
      </a>
      <span class="inbox-side">
        ${archiveButton}
        ${inactiveMeta || activeRuntime}
      </span>
      ${outcome ? `<small class="answer-preview">${escapeHtml(outcome)}</small>` : ''}
    </div>
  `;
}

function updateRuntimeLabels() {
  const labels = threadsList.querySelectorAll('[data-runtime-start]');
  for (const label of labels) {
    label.textContent = `running ${formatElapsed(label.dataset.runtimeStart, Date.now(), true)}`;
  }
  updateActionSummary();
  if (!labels.length && runtimeTickTimer) {
    clearInterval(runtimeTickTimer);
    runtimeTickTimer = null;
  }
}

function syncRuntimeTick() {
  const hasActiveRuntime = Boolean(threadsList.querySelector('[data-runtime-start]'));
  if (hasActiveRuntime && !runtimeTickTimer) {
    runtimeTickTimer = setInterval(updateRuntimeLabels, 1000);
  } else if (!hasActiveRuntime && runtimeTickTimer) {
    clearInterval(runtimeTickTimer);
    runtimeTickTimer = null;
  }
}

function dismissFinishedIndicator(indicator) {
  rememberSeenFinishedThread(indicator.dataset.finishedIndicator);
  indicator.classList.add('is-seen');
  indicator.removeAttribute('role');
  indicator.removeAttribute('tabindex');
  indicator.removeAttribute('aria-label');
  indicator.removeAttribute('title');
  indicator.removeAttribute('data-finished-indicator');
  indicator.setAttribute('aria-hidden', 'true');
}

function renderThreads(threads) {
  const lanes = [
    { key: 'running', title: 'Running', empty: 'No agents running.' },
    { key: 'done', title: 'Recently finished', empty: 'Nothing finished recently.' },
  ];
  const grouped = Object.fromEntries(lanes.map((lane) => [lane.key, []]));
  for (const thread of threads) grouped[threadLane(thread)].push(thread);
  grouped.done.sort((left, right) => finishedAtMs(right) - finishedAtMs(left));

  const runningStarts = grouped.running.filter(isActiveThread).map(runtimeStart).filter(Boolean);
  finishedThreadNames = grouped.done.filter(canArchiveThread).map((thread) => thread.name);
  renderActionSummary(grouped.running.length, grouped.done.length, runningStarts);
  threadsList.innerHTML = lanes.map((lane) => `
    <section class="action-lane" aria-label="${escapeHtml(lane.title)} agents">
      <div class="action-lane-head">
        <h3>${escapeHtml(lane.title)}</h3>
        <span class="action-lane-tools">
          <span class="action-count">${grouped[lane.key].length}</span>
          ${lane.key === 'done' && finishedThreadNames.length ? '<button id="clear-finished-threads" class="textbtn lane-clear" type="button">clear all</button>' : ''}
        </span>
      </div>
      <div class="action-list">
        ${grouped[lane.key].length ? grouped[lane.key].map(renderThreadCard).join('') : `<p class="empty-state">${escapeHtml(lane.empty)}</p>`}
      </div>
    </section>
  `).join('');
  syncRuntimeTick();
}

async function loadThreads() {
  const payload = await fetchJson('/api/threads');
  renderProvider(payload.provider);
  renderPiDefaults(payload.defaults);
  renderThreads((payload.threads || []).filter(sameSelectedProject));
  return payload;
}

async function reloadControlData() {
  try {
    const github = await loadGitHubAuth();
    await Promise.all([loadCodexAuth(), loadThreads()]);
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
loadRunControls();
modelRefInput.addEventListener('change', saveRunControls);
thinkingLevelInput.addEventListener('input', () => {
  renderThinkingLevel();
  saveRunControls();
});
imageInput?.addEventListener('change', () => updateImageStatus(imageInput, imageStatus));
bindImageDropZone(threadForm, imageInput, imageStatus);
submitOnEnter(promptInput, threadForm, threadSubmit);

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
  const folder = await globalThis.makerspaceDesktop?.chooseFolder?.(repoUrlInput.value.trim());
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
    if (localProject) {
      try {
        await globalThis.makerspaceDesktop?.rememberFolder?.(repoInput);
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

refreshThreads.addEventListener('click', async () => {
  refreshThreads.disabled = true;
  try {
    await loadThreads();
  } finally {
    refreshThreads.disabled = false;
  }
});

threadsList.addEventListener('click', async (event) => {
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
      clearButton.textContent = 'clear all';
      threadStatus.textContent = error.message;
    }
    return;
  }

  const button = event.target.closest('[data-archive-thread]');
  if (!button) return;
  button.disabled = true;
  button.textContent = 'marking…';
  try {
    await fetchJson(`/api/threads/${encodeURIComponent(button.dataset.archiveThread)}/archive`, { method: 'POST' });
    await loadThreads();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'mark as done';
    threadStatus.textContent = error.message;
  }
});

threadsList.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const indicator = event.target.closest('[data-finished-indicator]');
  if (!indicator) return;
  event.preventDefault();
  dismissFinishedIndicator(indicator);
});

reloadControlData();
