import { applyAppearance, getAppearance, saveAppearance } from './appearance.js?v=palette-2';

const BROWSER_SESSION_KEY = 'makerspaceBrowserSession';
const API_BASE = '';
const connectionSummary = document.querySelector('#connection-summary');
const codexLogin = document.querySelector('#codex-login');
const codexStatus = document.querySelector('#codex-status');
const codexDevice = document.querySelector('#codex-device');
const githubLogin = document.querySelector('#github-login');
const githubLogout = document.querySelector('#github-logout');
const githubStatus = document.querySelector('#github-status');
const settingsForm = document.querySelector('#settings-form');
const piProfileForm = document.querySelector('#pi-profile-form');
const piAgentsInput = document.querySelector('#pi-agents');
const piAgentsPath = document.querySelector('#pi-agents-path');
const piSyncRemoteInput = document.querySelector('#pi-sync-remote');
const piSkillsList = document.querySelector('#pi-skills');
const piExtensionsList = document.querySelector('#pi-extensions');
const piPromptsList = document.querySelector('#pi-prompts');
const piProfileSubmit = document.querySelector('#pi-profile-submit');
const piProfileStatus = document.querySelector('#pi-profile-status');
const darkModeInput = document.querySelector('#dark-mode');
const darkPaletteInput = document.querySelector('#dark-palette');
const monoFontInput = document.querySelector('#mono-font');
const imageRefInput = document.querySelector('#image-ref');
const registryUsernameInput = document.querySelector('#registry-username');
const registryPasswordInput = document.querySelector('#registry-password');
const anthropicApiKeyInput = document.querySelector('#anthropic-api-key');
const settingsSubmit = document.querySelector('#settings-submit');
const settingsStatus = document.querySelector('#settings-status');
let currentSettings = null;
let currentPiProfile = null;

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
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function updateConnectionSummary() {
  connectionSummary.textContent = `${getApiBase() || 'same-origin'} · deployment config`;
}

async function persistConnectionInputs(reload = false) {
  updateConnectionSummary();
  if (reload) await reloadSettingsData();
}

function settingsSummary(settings) {
  const registryStatus = settings.hasRegistryAuth ? `registry: ${settings.registryUsername || 'yes'}` : 'registry: no';
  const keyStatus = settings.hasAnthropicApiKey ? 'anthropic: yes' : 'anthropic: no';
  return `image: ${settings.imageRef || 'default'} · ${registryStatus} · ${keyStatus}`;
}

function loadAppearanceControls() {
  const appearance = getAppearance();
  darkModeInput.checked = appearance.theme === 'dark';
  darkPaletteInput.value = appearance.palette;
  monoFontInput.checked = appearance.font === 'mono';
  applyAppearance(appearance);
}

function saveAppearanceControls() {
  saveAppearance({
    theme: darkModeInput.checked ? 'dark' : 'light',
    palette: darkPaletteInput.value,
    font: monoFontInput.checked ? 'mono' : 'sans',
  });
}

function codexStatusText(status) {
  if (status.disabled === 'sign-in-required') return 'Sign in with GitHub first';
  if (!status.configured) return 'Signed out';
  const source = status.source === 'user' ? 'your Codex' : status.source;
  const expires = Number(status.expiresAt || 0);
  const suffix = Number.isFinite(expires) && expires > 0 ? ` · expires ${new Date(expires).toLocaleDateString()}` : '';
  return `Signed in${source ? ` · ${source}` : ''}${suffix}`;
}

async function loadCodexAuth() {
  const status = await fetchJson('/api/auth/openai-codex');
  codexLogin.disabled = status.disabled === 'sign-in-required';
  codexStatus.textContent = codexStatusText(status);
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

function renderProfileResources(container, resources) {
  if (!resources.length) {
    container.classList.add('muted');
    container.textContent = 'None found.';
    return;
  }

  container.classList.remove('muted');
  container.innerHTML = resources.map((resource) => `
    <label class="resource-item">
      <input type="checkbox" data-resource-id="${escapeHtml(resource.id)}" ${resource.enabled ? 'checked' : ''}>
      <span>${escapeHtml(resource.name)}<small>${escapeHtml(resource.description || resource.path)}</small></span>
    </label>
  `).join('');
}

function checkedResourceIds(container) {
  return [...container.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.dataset.resourceId || '');
}

function profileSummary(profile) {
  const count = (name) => (profile.resources?.[name] || []).filter((resource) => resource.enabled).length;
  return `${count('skills')} skills · ${count('extensions')} extensions · ${count('prompts')} prompts`;
}

async function loadPiProfile() {
  currentPiProfile = await fetchJson('/api/pi-profile');
  piAgentsInput.value = currentPiProfile.agentsText || '';
  piAgentsPath.textContent = currentPiProfile.agentsPath || 'AGENTS.md';
  piSyncRemoteInput.checked = currentPiProfile.syncToRemote !== false;
  renderProfileResources(piSkillsList, currentPiProfile.resources?.skills || []);
  renderProfileResources(piExtensionsList, currentPiProfile.resources?.extensions || []);
  renderProfileResources(piPromptsList, currentPiProfile.resources?.prompts || []);
  piProfileStatus.textContent = profileSummary(currentPiProfile);
  return currentPiProfile;
}

async function reloadSettingsData() {
  await loadGitHubAuth().catch((error) => { githubStatus.textContent = error.message; });
  await loadCodexAuth().catch((error) => { codexStatus.textContent = error.message; });
  await loadSettings().catch((error) => { settingsStatus.textContent = error.message; });
  await loadPiProfile().catch((error) => { piProfileStatus.textContent = error.message; });
}

getBrowserSessionId();
loadAppearanceControls();
updateConnectionSummary();
darkModeInput.addEventListener('change', saveAppearanceControls);
darkPaletteInput.addEventListener('change', saveAppearanceControls);
monoFontInput.addEventListener('change', saveAppearanceControls);
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
  githubStatus.textContent = 'Signing out…';
  try {
    await fetchJson('/api/auth/github/logout', { method: 'POST' });
    await reloadSettingsData();
  } catch (error) {
    githubStatus.textContent = error.message;
  } finally {
    githubLogout.disabled = false;
  }
});

piProfileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await persistConnectionInputs();
  piProfileSubmit.disabled = true;
  piProfileStatus.textContent = 'Saving…';
  try {
    currentPiProfile = await fetchJson('/api/pi-profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentsText: piAgentsInput.value,
        syncToRemote: piSyncRemoteInput.checked,
        enabledSkills: checkedResourceIds(piSkillsList),
        enabledExtensions: checkedResourceIds(piExtensionsList),
        enabledPrompts: checkedResourceIds(piPromptsList),
      }),
    });
    await loadPiProfile();
  } catch (error) {
    piProfileStatus.textContent = error.message;
  } finally {
    piProfileSubmit.disabled = false;
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
