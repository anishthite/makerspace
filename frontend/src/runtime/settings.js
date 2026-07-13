import { redirectIfAuthRequired } from './auth-redirect.js';

const BROWSER_SESSION_KEY = 'spannerBrowserSession';
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
const codexLogin = document.querySelector('#codex-login');
const codexStatus = document.querySelector('#codex-status');
const codexDevice = document.querySelector('#codex-device');
const codexDeviceDialog = document.querySelector('#codex-device-dialog');
const codexDeviceClose = document.querySelector('#codex-device-close');
const codexDeviceCode = document.querySelector('#codex-device-code');
const codexDeviceCopy = document.querySelector('#codex-device-copy');
const codexDeviceCopyLabel = document.querySelector('#codex-device-copy-label');
const codexDeviceOpen = document.querySelector('#codex-device-open');
const codexDeviceOpenLabel = document.querySelector('#codex-device-open-label');
const codexDeviceDialogStatus = document.querySelector('#codex-device-dialog-status');
const claudeCodeLogin = document.querySelector('#claude-code-login');
const claudeCodeStatus = document.querySelector('#claude-code-status');
const claudeCodeDialog = document.querySelector('#claude-code-dialog');
const claudeCodeClose = document.querySelector('#claude-code-close');
const claudeCodeAuth = document.querySelector('#claude-code-auth');
const claudeCodeOpen = document.querySelector('#claude-code-open');
const claudeCodeCopyLink = document.querySelector('#claude-code-copy-link');
const claudeCodeDialogStatus = document.querySelector('#claude-code-dialog-status');
const claudeCodeCodeForm = document.querySelector('#claude-code-code-form');
const claudeCodeCodeInput = document.querySelector('#claude-code-code');
const claudeCodePaste = document.querySelector('#claude-code-paste');
const claudeCodeCodeSubmit = document.querySelector('#claude-code-code-submit');
const githubLogin = document.querySelector('#github-login');
const githubLogout = document.querySelector('#github-logout');
const githubAppInstall = document.querySelector('#github-app-install');
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
const imageRefInput = document.querySelector('#image-ref');
const registryUsernameInput = document.querySelector('#registry-username');
const registryPasswordInput = document.querySelector('#registry-password');
const anthropicApiKeyInput = document.querySelector('#anthropic-api-key');
const settingsSubmit = document.querySelector('#settings-submit');
const settingsStatus = document.querySelector('#settings-status');
const desktopUpdates = document.querySelector('#desktop-updates');
const desktopCheckUpdates = document.querySelector('#desktop-check-updates');
const desktopUpdateStatus = document.querySelector('#desktop-update-status');
const settingsGlobalStatus = document.querySelector('#settings-global-status');
let currentSettings = null;
let currentPiProfile = null;
let activeClaudeCodeLoginId = '';

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
    throw new Error('Backend unavailable. Set VITE_SPANNER_API_BASE to the backend URL and redeploy.');
  }
  if (!response.ok) {
    if (redirectIfAuthRequired(payload, response)) return new Promise(() => {});
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function backendUnavailableMessage(message = '') {
  return /Backend unavailable|VITE_SPANNER_API_BASE/i.test(String(message || ''));
}

function showGlobalSettingsStatus(message = '') {
  if (!settingsGlobalStatus) return;
  const text = String(message || '').trim();
  settingsGlobalStatus.hidden = !text;
  settingsGlobalStatus.textContent = text;
}

function handleSettingsLoadError(target, error) {
  const message = error?.message || String(error || 'Unable to load settings.');
  if (backendUnavailableMessage(message)) {
    showGlobalSettingsStatus(message);
    if (target) {
      target.textContent = 'Waiting for backend.';
      target.hidden = true;
    }
    return;
  }
  if (target) target.hidden = false;
  if (target) target.textContent = message;
}

async function persistConnectionInputs(reload = false) {
  if (reload) await reloadSettingsData();
}

function settingsSummary(settings) {
  const registryStatus = settings.hasRegistryAuth ? `registry: ${settings.registryUsername || 'yes'}` : 'registry: no';
  const keyStatus = settings.hasAnthropicApiKey ? 'anthropic: yes' : 'anthropic: no';
  return `image: ${settings.imageRef || 'default'} · ${registryStatus} · ${keyStatus}`;
}

function oauthStatusText(status, label) {
  if (status.disabled === 'sign-in-required') return 'Sign in with GitHub first';
  if (!status.configured) return 'Signed out';
  const source = status.source === 'user' ? `your ${label}` : status.label || status.source;
  const expires = Number(status.expiresAt || 0);
  const suffix = Number.isFinite(expires) && expires > 0 ? ` · expires ${new Date(expires).toLocaleDateString()}` : '';
  return `Signed in${source ? ` · ${source}` : ''}${suffix}`;
}

async function loadCodexAuth() {
  const status = await fetchJson('/api/auth/openai-codex');
  codexLogin.disabled = status.disabled === 'sign-in-required';
  codexStatus.textContent = oauthStatusText(status, 'Codex');
  return status;
}

async function loadClaudeCodeAuth() {
  const status = await fetchJson('/api/auth/claude-code');
  claudeCodeLogin.disabled = status.disabled === 'sign-in-required';
  claudeCodeStatus.textContent = oauthStatusText(status, 'Claude Code');
  return status;
}

function setAuthDialogStatus(target, message = '') {
  if (target) target.textContent = message;
}

function openAuthDialog(dialog, statusTarget, message = 'Starting…') {
  setAuthDialogStatus(statusTarget, message);
  if (!dialog || dialog.open) return;
  try {
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
  } catch {
    dialog.setAttribute('open', '');
  }
}

function closeAuthDialog(dialog) {
  if (!dialog) return;
  if (dialog.open) dialog.close?.();
  dialog.removeAttribute('open');
}

function setAuthLink(link, url = '') {
  if (!link) return;
  if (url) {
    link.setAttribute('href', url);
    link.removeAttribute('aria-disabled');
    return;
  }
  link.removeAttribute('href');
  link.setAttribute('aria-disabled', 'true');
}

function setCodexDialogStatus(message = '') {
  setAuthDialogStatus(codexDeviceDialogStatus, message);
}

function openCodexDeviceDialog(message = 'Starting…') {
  openAuthDialog(codexDeviceDialog, codexDeviceDialogStatus, message);
}

function closeCodexDeviceDialog() {
  closeAuthDialog(codexDeviceDialog);
}

function setClaudeCodeDialogStatus(message = '') {
  setAuthDialogStatus(claudeCodeDialogStatus, message);
}

function setClaudeCodeStatus(message = '') {
  claudeCodeStatus.textContent = message;
  setClaudeCodeDialogStatus(message);
}

function openClaudeCodeDialog(message = 'Starting…') {
  openAuthDialog(claudeCodeDialog, claudeCodeDialogStatus, message);
}

function closeClaudeCodeDialog() {
  closeAuthDialog(claudeCodeDialog);
}

function resetCodexDeviceDialog() {
  if (codexDeviceCode) codexDeviceCode.textContent = 'Loading…';
  if (codexDeviceCopy) {
    codexDeviceCopy.disabled = true;
    if (codexDeviceCopyLabel) codexDeviceCopyLabel.textContent = 'copy';
    else codexDeviceCopy.textContent = 'copy';
    delete codexDeviceCopy.dataset.code;
  }
  if (codexDeviceOpenLabel) codexDeviceOpenLabel.textContent = 'Loading link…';
  setAuthLink(codexDeviceOpen);
  openCodexDeviceDialog('Starting Codex sign-in…');
}

function resetClaudeCodeDialog() {
  if (claudeCodeAuth) {
    claudeCodeAuth.classList.add('hidden');
    claudeCodeAuth.textContent = '';
  }
  setAuthLink(claudeCodeOpen);
  if (claudeCodeCopyLink) {
    claudeCodeCopyLink.disabled = true;
    claudeCodeCopyLink.textContent = 'Copy link';
    delete claudeCodeCopyLink.dataset.url;
  }
  if (claudeCodeCodeForm) claudeCodeCodeForm.classList.add('hidden');
  if (claudeCodeCodeInput) claudeCodeCodeInput.value = '';
  openClaudeCodeDialog('Starting Claude sign-in…');
}

async function copyToClipboard(value) {
  const text = String(value || '');
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const ok = Boolean(document.execCommand?.('copy'));
  textarea.remove();
  return ok;
}

function renderCodexDevice(login) {
  const device = login.device;
  if (!device) {
    closeCodexDeviceDialog();
    return;
  }
  const verificationUri = String(device.verificationUri || '');
  const userCode = String(device.userCode || '');
  openCodexDeviceDialog('Copy the code, then open sign-in.');
  if (codexDeviceCode) codexDeviceCode.textContent = userCode || 'Code unavailable';
  if (codexDeviceCopy) {
    codexDeviceCopy.disabled = !userCode;
    if (codexDeviceCopyLabel) codexDeviceCopyLabel.textContent = 'copy';
    else codexDeviceCopy.textContent = 'copy';
    codexDeviceCopy.dataset.code = userCode;
  }
  if (codexDeviceOpenLabel) codexDeviceOpenLabel.textContent = verificationUri || 'sign in with codex';
  else if (codexDeviceOpen) codexDeviceOpen.textContent = 'sign in with codex';
  setAuthLink(codexDeviceOpen, verificationUri);
  const safeUri = escapeHtml(verificationUri);
  const safeCode = escapeHtml(userCode);
  codexDevice.classList.remove('hidden');
  codexDevice.innerHTML = `Copy <code>${safeCode}</code>, then open <a href="${safeUri}" target="_blank" rel="noreferrer">${safeUri}</a>.`;
}

function renderClaudeCodeAuth(login) {
  const auth = login.auth;
  if (!auth?.url) {
    closeClaudeCodeDialog();
    return;
  }
  openClaudeCodeDialog('Open Claude, approve access, then paste the copied code here.');
  setAuthLink(claudeCodeOpen, auth.url);
  if (claudeCodeCopyLink) {
    claudeCodeCopyLink.disabled = false;
    claudeCodeCopyLink.dataset.url = auth.url;
    claudeCodeCopyLink.textContent = 'Copy link';
  }
  claudeCodeCodeForm.classList.remove('hidden');
  claudeCodeCodeInput.value = '';
  claudeCodeOpen?.focus?.();
}

async function pollCodexLogin(id) {
  while (true) {
    const login = await fetchJson(`/api/auth/openai-codex/login/${encodeURIComponent(id)}`);
    if (login.status === 'complete') {
      codexStatus.textContent = 'Signed in';
      codexDevice.classList.add('hidden');
      closeCodexDeviceDialog();
      await loadCodexAuth();
      return;
    }
    if (login.status === 'failed') throw new Error(login.error || 'Codex failed');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function pollClaudeCodeLogin(id) {
  while (true) {
    const login = await fetchJson(`/api/auth/claude-code/login/${encodeURIComponent(id)}`);
    if (login.status === 'complete') {
      claudeCodeStatus.textContent = 'Signed in';
      claudeCodeAuth.classList.add('hidden');
      claudeCodeCodeForm.classList.add('hidden');
      closeClaudeCodeDialog();
      activeClaudeCodeLoginId = '';
      await loadClaudeCodeAuth();
      return;
    }
    if (login.status === 'failed') throw new Error(login.error || 'Claude Code failed');
    if (login.progress) setClaudeCodeStatus(login.progress);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function renderGitHubAuth(status) {
  if (!status.configured) {
    githubStatus.textContent = 'Missing GitHub OAuth env';
    githubLogin.disabled = true;
    githubLogin.hidden = true;
    githubLogout.disabled = true;
    githubLogout.hidden = true;
    githubAppInstall.disabled = true;
    githubAppInstall.hidden = true;
    return;
  }

  const connected = Boolean(status.connected);
  const needsReconnect = Boolean(status.needsReconnect);
  const app = status.app || {};
  const appAccounts = (app.installations || []).map((entry) => entry.accountLogin).filter(Boolean).join(', ');
  const missingScopes = (status.missingScopes || []).join(', ');
  githubLogin.textContent = needsReconnect ? 'Reconnect' : 'Sign in';
  githubLogin.disabled = false;
  githubLogin.hidden = connected && !needsReconnect;
  githubLogout.disabled = !connected;
  githubLogout.hidden = !connected;
  githubAppInstall.disabled = !connected || needsReconnect || !app.installable;
  githubAppInstall.hidden = !app.configured;
  githubStatus.textContent = needsReconnect
    ? `Reconnect GitHub to allow workflow file changes${missingScopes ? ` (${missingScopes} scope)` : ''}.`
    : connected
      ? `Signed in · ${status.user?.login || 'GitHub'}${app.installed ? ` · App installed for ${appAccounts || 'GitHub'}` : app.configured ? ' · Install app for private repo git' : ''}`
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
  showGlobalSettingsStatus('');
  [githubStatus, codexStatus, claudeCodeStatus, settingsStatus, piProfileStatus].forEach((target) => { if (target) target.hidden = false; });
  await loadGitHubAuth().catch((error) => handleSettingsLoadError(githubStatus, error));
  await loadCodexAuth().catch((error) => handleSettingsLoadError(codexStatus, error));
  await loadClaudeCodeAuth().catch((error) => handleSettingsLoadError(claudeCodeStatus, error));
  await loadSettings().catch((error) => handleSettingsLoadError(settingsStatus, error));
  await loadPiProfile().catch((error) => handleSettingsLoadError(piProfileStatus, error));
}

function showDesktopUpdateStatus(info = {}) {
  desktopUpdateStatus.textContent = String(info.message || 'Update status changed.');
}

function initDesktopUpdates() {
  const desktop = globalThis.spannerDesktop;
  if (!desktopUpdates || !desktopCheckUpdates || !desktopUpdateStatus || !desktop?.checkForUpdates) return;
  desktopUpdates.hidden = false;
  desktopUpdateStatus.textContent = 'Ready to check for desktop updates.';
  const unsubscribe = desktop.onUpdateStatus?.(showDesktopUpdateStatus);
  desktopCheckUpdates.addEventListener('click', async () => {
    desktopCheckUpdates.disabled = true;
    desktopUpdateStatus.textContent = 'Checking for updates…';
    try {
      const result = await desktop.checkForUpdates();
      desktopUpdateStatus.textContent = result?.message || 'Checking for updates…';
    } catch (error) {
      desktopUpdateStatus.textContent = error.message;
    } finally {
      desktopCheckUpdates.disabled = false;
    }
  });
  globalThis.addEventListener?.('beforeunload', () => unsubscribe?.(), { once: true });
}

getBrowserSessionId();
initDesktopUpdates();
codexDeviceClose?.addEventListener('click', closeCodexDeviceDialog);
claudeCodeClose?.addEventListener('click', closeClaudeCodeDialog);

codexDeviceCopy?.addEventListener('click', async () => {
  const ok = await copyToClipboard(codexDeviceCopy.dataset.code || codexDeviceCode?.textContent || '');
  if (codexDeviceCopyLabel) codexDeviceCopyLabel.textContent = ok ? 'copied' : 'select code';
  else codexDeviceCopy.textContent = ok ? 'copied' : 'select code';
  setCodexDialogStatus(ok ? 'Copied. Now open sign-in.' : 'Copy failed. Select the code, then open sign-in.');
});

codexDeviceOpen?.addEventListener('click', (event) => {
  if (!codexDeviceOpen.hasAttribute('href')) {
    event.preventDefault();
    return;
  }
  setCodexDialogStatus('OpenAI is open in a new tab. Paste the copied code there.');
});

codexLogin.addEventListener('click', async () => {
  resetCodexDeviceDialog();
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
    setCodexDialogStatus(error.message);
  } finally {
    codexLogin.disabled = false;
  }
});

claudeCodeLogin.addEventListener('click', async () => {
  resetClaudeCodeDialog();
  await persistConnectionInputs();
  claudeCodeLogin.disabled = true;
  setClaudeCodeStatus('Starting…');
  try {
    const login = await fetchJson('/api/auth/claude-code/login', { method: 'POST' });
    activeClaudeCodeLoginId = login.id;
    renderClaudeCodeAuth(login);
    setClaudeCodeStatus('Waiting for Claude…');
    await pollClaudeCodeLogin(login.id);
  } catch (error) {
    setClaudeCodeStatus(error.message);
  } finally {
    claudeCodeLogin.disabled = false;
  }
});

async function submitClaudeCodeInput() {
  if (!activeClaudeCodeLoginId) {
    setClaudeCodeStatus('Start Claude Code sign-in first.');
    return;
  }
  if (!claudeCodeCodeInput.value.trim()) {
    setClaudeCodeStatus('Paste the code Claude showed.');
    claudeCodeCodeInput.focus();
    return;
  }
  if (claudeCodeCodeSubmit.disabled) return;
  claudeCodeCodeSubmit.disabled = true;
  if (claudeCodePaste) claudeCodePaste.disabled = true;
  setClaudeCodeStatus('Exchanging…');
  try {
    await fetchJson(`/api/auth/claude-code/login/${encodeURIComponent(activeClaudeCodeLoginId)}/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: claudeCodeCodeInput.value }),
    });
  } catch (error) {
    setClaudeCodeStatus(error.message);
  } finally {
    claudeCodeCodeSubmit.disabled = false;
    if (claudeCodePaste) claudeCodePaste.disabled = false;
  }
}

claudeCodeCodeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitClaudeCodeInput();
});

claudeCodeCodeInput.addEventListener('paste', () => {
  setTimeout(() => {
    if (claudeCodeCodeInput.value.trim()) claudeCodeCodeForm.requestSubmit();
  }, 0);
});

claudeCodeOpen?.addEventListener('click', (event) => {
  if (!claudeCodeOpen.hasAttribute('href')) {
    event.preventDefault();
    return;
  }
  setClaudeCodeDialogStatus('Claude is open. Copy the code it shows, then paste it here.');
  const desktopOpen = globalThis.spannerDesktop?.openExternal;
  if (desktopOpen) {
    event.preventDefault();
    desktopOpen(claudeCodeOpen.getAttribute('href')).catch(() => {
      setClaudeCodeDialogStatus('Could not open Claude automatically. Copy the link, then open it in your browser.');
    });
  }
});

claudeCodeCopyLink?.addEventListener('click', async () => {
  const ok = await copyToClipboard(claudeCodeCopyLink.dataset.url || claudeCodeOpen?.getAttribute('href') || '');
  claudeCodeCopyLink.textContent = ok ? 'Copied' : 'Select link';
  setClaudeCodeDialogStatus(ok ? 'Copied. Open it in your browser, then paste the code Claude shows.' : 'Copy failed. Use the Open Claude button or copy the link manually.');
});

claudeCodePaste?.addEventListener('click', async () => {
  try {
    claudeCodeCodeInput.value = await navigator.clipboard.readText();
    await submitClaudeCodeInput();
  } catch {
    setClaudeCodeStatus('Click the code box and press paste.');
    claudeCodeCodeInput.focus();
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

githubAppInstall.addEventListener('click', async () => {
  await persistConnectionInputs();
  githubAppInstall.disabled = true;
  githubStatus.textContent = 'Opening app install…';
  try {
    const payload = await fetchJson('/api/auth/github/app/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnTo: location.href }),
    });
    location.href = payload.installUrl;
  } catch (error) {
    githubStatus.textContent = error.message;
    githubAppInstall.disabled = false;
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
if (params.get('githubApp') === 'installed') {
  githubStatus.textContent = 'GitHub App installed';
  history.replaceState({}, '', location.pathname);
}

reloadSettingsData();
