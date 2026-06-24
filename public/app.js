const BROWSER_SESSION_KEY = 'makerspaceBrowserSession';

const providerBanner = document.querySelector('#provider-banner');
const modeToggle = document.querySelector('#mode-toggle');
const modeLabel = document.querySelector('#mode-label');
const codexAuthPill = document.querySelector('#codex-auth-pill');
const codexAuthLabel = document.querySelector('#codex-auth-label');
const githubAuthPill = document.querySelector('#github-auth-pill');
const githubAuthLabel = document.querySelector('#github-auth-label');
const repoUrlInput = document.querySelector('input[name="repoUrl"]');
const promptInput = document.querySelector('textarea[name="prompt"]');
const branchInput = document.querySelector('input[name="branch"]');
const repoSourceInput = document.querySelector('input[name="repoSource"]');
const repoPicker = document.querySelector('#repo-picker');
const repoRefresh = document.querySelector('#repo-refresh');
const repoHint = document.querySelector('#repo-hint');
const threadForm = document.querySelector('#thread-form');
const threadSubmit = document.querySelector('#thread-submit');
const threadStatus = document.querySelector('#thread-status');
const threadsList = document.querySelector('#threads-list');
const refreshThreads = document.querySelector('#refresh-threads');

let githubRepos = [];
let selectedRepo = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getBrowserSessionId() {
  let sessionId = localStorage.getItem(BROWSER_SESSION_KEY) || '';
  if (!sessionId) {
    sessionId = globalThis.crypto?.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('-');
    localStorage.setItem(BROWSER_SESSION_KEY, sessionId);
  }
  return sessionId;
}

function advancedMode() {
  return localStorage.getItem('makerspaceUiMode') === 'debug';
}

function setAdvancedMode(enabled) {
  const next = enabled ? 'debug' : 'office';
  localStorage.setItem('makerspaceUiMode', next);
  document.body.dataset.mode = next;
  modeLabel.textContent = enabled ? 'hide details' : 'details';
  modeToggle.setAttribute('aria-pressed', String(enabled));
}

function getApiBase() {
  return (localStorage.getItem('makerspaceApiBase') || '').replace(/\/+$/, '');
}

function getApiToken() {
  return localStorage.getItem('makerspaceApiToken') || '';
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

function threadUrl(name) {
  const params = new URLSearchParams({ name });
  const apiBase = getApiBase();
  if (apiBase) params.set('api', apiBase);
  return `/thread.html?${params}`;
}

function normalizeRepoUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^[\w.-]+\/[\w.-]+(?:\.git)?$/i.test(text)) return `https://github.com/${text.replace(/\.git$/i, '')}.git`;
  if (/^github\.com\//i.test(text)) return `https://${text.replace(/\.git$/i, '')}.git`;
  return text;
}

function daytonaEnvSummary(provider) {
  if (provider?.kind !== 'daytona') return '';
  const env = provider.env || {};
  const auth = env.apiKey ? 'api key' : 'no api key';
  const snapshot = env.snapshot ? 'snapshot' : 'default image';
  return `${auth}; ${snapshot}; stop ${env.autostopMinutes}m; delete ${env.autodeleteMinutes}m`;
}

function renderProvider(provider) {
  const target = getApiBase() ? 'remote' : 'local';
  providerBanner.dataset.tone = provider?.ready === false ? 'error' : 'success';
  providerBanner.textContent = provider
    ? `${target} · ${provider.kind} · ${daytonaEnvSummary(provider)}`
    : target;
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
  renderAuthPill(githubAuthPill, githubAuthLabel, connected, connected ? `GitHub: ${status.user?.login || 'connected'}` : status.configured ? 'GitHub: signed out' : 'GitHub: not configured', 'github');
  repoPicker.disabled = !connected;
  repoRefresh.disabled = !connected;
  if (!connected) {
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

function statusCopy(thread) {
  const status = String(thread.runStatus || thread.status || 'unknown');
  if (status === 'ready') return 'ready';
  if (status === 'running') return 'running';
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (['launching', 'queued', 'starting'].includes(status)) return 'starting';
  return status;
}

function repoLabel(url) {
  const text = String(url || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/i, '');
  return text || 'repo';
}

function formatUpdated(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderThreads(threads) {
  if (!threads.length) {
    threadsList.innerHTML = '<p class="empty-state">No threads.</p>';
    return;
  }

  threadsList.innerHTML = threads.slice(0, 8).map((thread) => {
    const rawStatus = thread.runStatus || thread.status || 'unknown';
    const badgeClass = statusClass(rawStatus);
    const repo = repoLabel(thread.repoUrl);
    const branch = thread.branch ? ` · ${thread.branch}` : '';
    const updated = formatUpdated(thread.updatedAt || thread.createdAt);
    return `
      <a class="inbox-item ${badgeClass}" href="${escapeHtml(threadUrl(thread.name))}">
        <span class="status-dot" aria-hidden="true"></span>
        <span class="inbox-main">
          <strong>${escapeHtml(thread.name)}</strong>
          <small>${escapeHtml(repo)}${escapeHtml(branch)}</small>
        </span>
        <span class="inbox-side">
          ${updated ? `<time>${escapeHtml(updated)}</time>` : ''}
          <span class="badge ${badgeClass}">${escapeHtml(statusCopy(thread))}</span>
        </span>
      </a>
    `;
  }).join('');
}

async function loadThreads() {
  const payload = await fetchJson('/api/threads');
  renderProvider(payload.provider);
  renderThreads(payload.threads || []);
  return payload;
}

async function reloadControlData() {
  try {
    const github = await loadGitHubAuth();
    await Promise.all([loadCodexAuth(), loadThreads()]);
    if (github.connected) await loadGitHubRepos();
  } catch (error) {
    renderAuthError(error.message);
    providerBanner.dataset.tone = 'error';
    providerBanner.textContent = error.message;
    threadStatus.textContent = error.message;
    repoHint.textContent = error.message;
  }
}

getBrowserSessionId();
setAdvancedMode(advancedMode());
modeToggle.addEventListener('click', () => setAdvancedMode(!advancedMode()));

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    promptInput.value = button.dataset.prompt || '';
    promptInput.focus();
  });
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
  const body = {
    repoUrl: normalizeRepoUrl(form.get('repoUrl')),
    branch: form.get('branch'),
    name: form.get('name'),
    prompt: form.get('prompt'),
    repoSource: form.get('repoSource'),
  };

  threadSubmit.disabled = true;
  threadStatus.textContent = 'Starting…';
  try {
    const payload = await fetchJson('/api/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
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

reloadControlData();
