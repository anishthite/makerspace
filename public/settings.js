const BROWSER_SESSION_KEY = 'makerspaceBrowserSession';

const apiBaseInput = document.querySelector('#api-base');
const apiTokenInput = document.querySelector('#api-token');
const connectionSummary = document.querySelector('#connection-summary');
const codexLogin = document.querySelector('#codex-login');
const codexStatus = document.querySelector('#codex-status');
const codexDevice = document.querySelector('#codex-device');
const githubLogin = document.querySelector('#github-login');
const githubLogout = document.querySelector('#github-logout');
const githubStatus = document.querySelector('#github-status');
const settingsForm = document.querySelector('#settings-form');
const imageRefInput = document.querySelector('#image-ref');
const registryUsernameInput = document.querySelector('#registry-username');
const registryPasswordInput = document.querySelector('#registry-password');
const anthropicApiKeyInput = document.querySelector('#anthropic-api-key');
const settingsSubmit = document.querySelector('#settings-submit');
const settingsStatus = document.querySelector('#settings-status');
let currentSettings = null;

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
    if (globalThis.crypto?.randomUUID) {
      sessionId = globalThis.crypto.randomUUID();
    } else {
      const bytes = new Uint32Array(4);
      globalThis.crypto.getRandomValues(bytes);
      sessionId = Array.from(bytes, (value) => value.toString(16).padStart(8, '0')).join('-');
    }
    localStorage.setItem(BROWSER_SESSION_KEY, sessionId);
  }

  return sessionId;
}

function getApiBase() {
  return (localStorage.getItem('makerspaceApiBase') || '').replace(/\/+$/, '');
}

function setApiBase(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (normalized) localStorage.setItem('makerspaceApiBase', normalized);
  else localStorage.removeItem('makerspaceApiBase');
  apiBaseInput.value = normalized;
}

function getApiToken() {
  return localStorage.getItem('makerspaceApiToken') || '';
}

function setApiToken(value) {
  const token = String(value || '').trim();
  if (token) localStorage.setItem('makerspaceApiToken', token);
  else localStorage.removeItem('makerspaceApiToken');
  apiTokenInput.value = token;
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
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function updateConnectionSummary() {
  const target = apiBaseInput.value.trim().replace(/\/+$/, '') || 'same-origin';
  const token = apiTokenInput.value.trim() ? 'token saved' : 'no token';
  connectionSummary.textContent = `${target} · ${token}`;
}

async function persistConnectionInputs(reload = false) {
  setApiBase(apiBaseInput.value);
  setApiToken(apiTokenInput.value);
  updateConnectionSummary();
  if (reload) await reloadSettingsData();
}

function settingsSummary(settings) {
  const registryStatus = settings.hasRegistryAuth ? `registry: ${settings.registryUsername || 'yes'}` : 'registry: no';
  const keyStatus = settings.hasAnthropicApiKey ? 'anthropic: yes' : 'anthropic: no';
  return `image: ${settings.imageRef || 'default'} · ${registryStatus} · ${keyStatus}`;
}

async function loadCodexAuth() {
  const status = await fetchJson('/api/auth/openai-codex');
  codexStatus.textContent = status.configured
    ? `Signed in${status.source ? ` · ${status.source}` : ''}`
    : 'Signed out';
  return status;
}

function renderCodexDevice(login) {
  const device = login.device;
  if (!device) return;
  codexDevice.classList.remove('hidden');
  codexDevice.innerHTML = `<a href="${escapeHtml(device.verificationUri)}" target="_blank" rel="noreferrer">OpenAI</a>: <code>${escapeHtml(device.userCode)}</code>`;
}

async function pollCodexLogin(id) {
  while (true) {
    const login = await fetchJson(`/api/auth/openai-codex/login/${encodeURIComponent(id)}`);
    if (login.status === 'complete') {
      codexStatus.textContent = 'Signed in';
      codexDevice.classList.add('hidden');
      await loadCodexAuth();
      return;
    }
    if (login.status === 'failed') throw new Error(login.error || 'Codex failed');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function renderGitHubAuth(status) {
  if (!status.configured) {
    githubStatus.textContent = 'Missing GitHub OAuth env';
    githubLogin.disabled = true;
    githubLogout.disabled = true;
    return;
  }

  githubLogin.disabled = false;
  githubLogout.disabled = !status.connected;
  githubStatus.textContent = status.connected
    ? `Signed in · ${status.user?.login || 'GitHub'}`
    : 'Signed out';
}

async function loadGitHubAuth() {
  const status = await fetchJson('/api/auth/github');
  renderGitHubAuth(status);
  return status;
}

async function loadSettings() {
  currentSettings = await fetchJson('/api/settings');
  imageRefInput.value = currentSettings.imageRef || '';
  registryUsernameInput.value = currentSettings.registryUsername || '';
  registryPasswordInput.value = '';
  anthropicApiKeyInput.value = '';
  settingsStatus.textContent = settingsSummary(currentSettings);
  return currentSettings;
}

async function reloadSettingsData() {
  try {
    await Promise.all([loadCodexAuth(), loadGitHubAuth(), loadSettings()]);
  } catch (error) {
    codexStatus.textContent = error.message;
    githubStatus.textContent = error.message;
    settingsStatus.textContent = error.message;
  }
}

apiBaseInput.value = getApiBase();
apiTokenInput.value = getApiToken();
getBrowserSessionId();
updateConnectionSummary();
apiBaseInput.addEventListener('input', updateConnectionSummary);
apiTokenInput.addEventListener('input', updateConnectionSummary);
apiBaseInput.addEventListener('change', async () => {
  await persistConnectionInputs(true);
});
apiTokenInput.addEventListener('change', async () => {
  await persistConnectionInputs(true);
});

codexLogin.addEventListener('click', async () => {
  await persistConnectionInputs();
  codexLogin.disabled = true;
  codexStatus.textContent = 'Starting…';
  codexDevice.classList.add('hidden');
  try {
    const login = await fetchJson('/api/auth/openai-codex/login', { method: 'POST' });
    renderCodexDevice(login);
    codexStatus.textContent = 'Waiting…';
    await pollCodexLogin(login.id);
  } catch (error) {
    codexStatus.textContent = error.message;
  } finally {
    codexLogin.disabled = false;
  }
});

githubLogin.addEventListener('click', async () => {
  await persistConnectionInputs();
  githubLogin.disabled = true;
  githubStatus.textContent = 'Opening…';
  try {
    const payload = await fetchJson('/api/auth/github/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnTo: location.href }),
    });
    location.href = payload.loginUrl;
  } catch (error) {
    githubStatus.textContent = error.message;
    githubLogin.disabled = false;
  }
});

githubLogout.addEventListener('click', async () => {
  githubLogout.disabled = true;
  githubStatus.textContent = 'Disconnecting…';
  try {
    await fetchJson('/api/auth/github/logout', { method: 'POST' });
    await reloadSettingsData();
  } catch (error) {
    githubStatus.textContent = error.message;
  } finally {
    githubLogout.disabled = false;
  }
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await persistConnectionInputs();
  settingsSubmit.disabled = true;
  settingsStatus.textContent = 'Saving…';
  try {
    currentSettings = await fetchJson('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(currentSettings || {}),
        imageRef: imageRefInput.value,
        registryUsername: registryUsernameInput.value,
        registryPassword: registryPasswordInput.value,
        anthropicApiKey: anthropicApiKeyInput.value,
      }),
    });
    imageRefInput.value = currentSettings.imageRef || '';
    registryUsernameInput.value = currentSettings.registryUsername || registryUsernameInput.value;
    registryPasswordInput.value = '';
    anthropicApiKeyInput.value = '';
    settingsStatus.textContent = settingsSummary(currentSettings);
  } catch (error) {
    settingsStatus.textContent = error.message;
  } finally {
    settingsSubmit.disabled = false;
  }
});

const params = new URLSearchParams(location.search);
if (params.get('github') === 'connected') {
  githubStatus.textContent = 'Signed in';
  history.replaceState({}, '', location.pathname);
}
if (params.get('github') === 'error') {
  githubStatus.textContent = params.get('message') || 'GitHub failed';
  history.replaceState({}, '', location.pathname);
}

reloadSettingsData();
