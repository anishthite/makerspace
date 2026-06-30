import './appearance.js?v=palette-2';

const BROWSER_SESSION_KEY = 'makerspaceBrowserSession';
const PROJECT_KEY = 'makerspaceSelectedProject';
const RECENT_PROJECTS_KEY = 'makerspaceRecentProjects';
const API_BASE = '';

const codexAuthPill = document.querySelector('#codex-auth-pill');
const codexAuthLabel = document.querySelector('#codex-auth-label');
const githubAuthPill = document.querySelector('#github-auth-pill');
const githubAuthLabel = document.querySelector('#github-auth-label');
const form = document.querySelector('#project-form');
const repoInput = document.querySelector('#project-repo-url');
const repoSourceInput = document.querySelector('#project-repo-source');
const branchInput = document.querySelector('#project-branch');
const repoPicker = document.querySelector('#project-repo-picker');
const repoRefresh = document.querySelector('#project-repo-refresh');
const chooseFolder = document.querySelector('#project-choose-folder');
const repoHint = document.querySelector('#project-repo-hint');
const statusLine = document.querySelector('#project-status');
const recentList = document.querySelector('#project-recent-list');

let providerKind = '';
let githubRepos = [];
let selectedRepo = null;
let recentProjects = [];

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function projectFromInput() {
  const rawValue = cleanProjectValue(repoInput.value);
  if (!rawValue) return null;
  const local = providerKind === 'local' || looksLikeLocalPath(rawValue);
  const value = local ? rawValue : normalizeRepoUrl(rawValue);
  return {
    kind: local ? 'local' : 'git',
    value,
    label: selectedRepo?.fullName || projectLabel(value),
    repoSource: local ? '' : repoSourceInput.value,
    branch: local ? '' : branchInput.value,
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

function renderRecentProjects(threads = []) {
  const projects = readRecentProjects();
  if (!projects.length) {
    recentList.innerHTML = '<p class="empty-state">No recent projects yet.</p>';
    return;
  }
  recentList.innerHTML = projects.map((project, index) => {
    const running = runningAgentCount(project, threads);
    const runningLabel = `${running} agent${running === 1 ? '' : 's'} running`;
    return `
      <button class="project-choice" type="button" data-project-index="${index}">
        <span class="project-choice-title">
          <strong>${escapeHtml(project.label || projectLabel(project.value))}</strong>
          ${running ? `<span class="project-running-badge"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(runningLabel)}</span>` : ''}
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

function renderAuthError(message) {
  for (const pill of [codexAuthPill, githubAuthPill]) {
    pill.dataset.status = 'error';
    pill.title = message;
  }
}

function resetRepoSelection(message) {
  selectedRepo = null;
  repoSourceInput.value = '';
  repoPicker.value = '';
  if (message) repoHint.textContent = message;
}

async function loadLastFolder() {
  if (!globalThis.makerspaceDesktop?.getLastFolder || repoInput.value.trim()) return;
  try {
    const folder = await globalThis.makerspaceDesktop.getLastFolder();
    if (!folder || repoInput.value.trim()) return;
    repoInput.value = folder;
    repoHint.textContent = 'Last local folder loaded.';
  } catch {}
}

function renderProvider(provider) {
  providerKind = provider?.kind || '';
  const local = providerKind === 'local';
  repoInput.placeholder = local ? '/Users/you/project' : 'github.com/you/repo or /Users/you/project';
  repoPicker.hidden = local;
  repoRefresh.hidden = local;
  chooseFolder.hidden = !globalThis.makerspaceDesktop?.chooseFolder;
  if (local) {
    resetRepoSelection(globalThis.makerspaceDesktop?.chooseFolder ? 'Choose a local folder or paste a path.' : 'Paste a local folder path.');
    void loadLastFolder();
  }
}

function renderRepoOptions(repos) {
  repoPicker.innerHTML = ['<option value="">GitHub repos</option>', ...repos.map((repo) => `<option value="${escapeHtml(repo.id)}">${escapeHtml(repo.fullName)}${repo.private ? ' · private' : ''}</option>`)].join('');
  repoHint.textContent = repos.length ? `${repos.length} GitHub repos` : 'No GitHub repos found.';
}

async function loadGitHubRepos() {
  if (providerKind === 'local') return;
  const payload = await fetchJson('/api/github/repos');
  githubRepos = payload.repos || [];
  renderRepoOptions(githubRepos);
}

async function refreshProjectThreads() {
  await loadRecentProjects();
  const payload = await fetchJson('/api/threads');
  renderProvider(payload.provider);
  renderRecentProjects(payload.threads || []);
}

async function loadStatus() {
  getBrowserSessionId();
  renderRecentProjects();
  if (globalThis.makerspaceDesktop?.chooseFolder) {
    chooseFolder.hidden = false;
    repoHint.textContent = 'Choose a local folder or paste a repo.';
    void loadLastFolder();
  }

  try {
    await refreshProjectThreads();
  } catch (error) {
    statusLine.textContent = error.message;
  }

  try {
    const codex = await fetchJson('/api/auth/openai-codex');
    renderAuthPill(codexAuthPill, codexAuthLabel, Boolean(codex.configured), codex.configured ? `Codex: ${codex.source || 'signed in'}` : 'Codex: signed out', 'codex');
    const github = await fetchJson('/api/auth/github');
    const connected = Boolean(github.connected);
    renderAuthPill(githubAuthPill, githubAuthLabel, connected, connected ? `GitHub: ${github.user?.login || 'connected'}` : github.configured ? 'GitHub: signed out' : 'GitHub: not configured', 'github');
    repoPicker.disabled = providerKind === 'local' || !connected;
    repoRefresh.disabled = providerKind === 'local' || !connected;
    if (connected && providerKind !== 'local') await loadGitHubRepos();
    else if (providerKind !== 'local') repoHint.textContent = github.configured ? 'Sign in in Settings, paste a repo, or choose a local folder.' : 'Paste a repo or choose a local folder.';
  } catch (error) {
    renderAuthError(error.message);
  }
}

async function openWorkspace(project) {
  await saveProject(project);
  if (project.kind === 'local') {
    try {
      await globalThis.makerspaceDesktop?.rememberFolder?.(project.value);
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
    const folder = await globalThis.makerspaceDesktop?.chooseFolder?.(repoInput.value.trim());
    if (!folder) return;
    repoInput.value = folder;
    resetRepoSelection('Local folder selected.');
    statusLine.textContent = 'Ready to open the workspace.';
  } catch (error) {
    statusLine.textContent = error.message;
  }
});

repoPicker.addEventListener('change', () => {
  selectedRepo = githubRepos.find((entry) => String(entry.id) === repoPicker.value) || null;
  if (!selectedRepo) {
    resetRepoSelection('Pick a GitHub repo, paste a repo, or choose a local folder.');
    return;
  }
  repoSourceInput.value = 'github';
  repoInput.value = selectedRepo.cloneUrl;
  branchInput.value = selectedRepo.defaultBranch || '';
  repoHint.textContent = `${selectedRepo.fullName}${selectedRepo.private ? ' · private' : ''}`;
});

repoInput.addEventListener('input', () => {
  if (!selectedRepo) return;
  if (repoInput.value.trim() === selectedRepo.cloneUrl) return;
  resetRepoSelection('Manual project.');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const project = projectFromInput();
  if (!project) {
    statusLine.textContent = 'Choose a local folder or enter a repo.';
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

loadStatus();
