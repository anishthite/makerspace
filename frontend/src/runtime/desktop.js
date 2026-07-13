const API_BASE = String(import.meta.env?.VITE_SPANNER_API_BASE || '').trim().replace(/\/+$/, '');
const SESSION_KEY = 'spannerBrowserSession';

try {
  if (localStorage.getItem(SESSION_KEY) === null) {
    const value = localStorage.getItem('workbenchBrowserSession');
    if (value !== null) localStorage.setItem(SESSION_KEY, value);
  }
  localStorage.removeItem('workbenchBrowserSession');
} catch {}

const openButton = document.querySelector('[data-open-signin]');
const dialog = document.querySelector('#signin-modal');
const closeButton = document.querySelector('#signin-close');
const githubButton = document.querySelector('#github-signin');
const statusLine = document.querySelector('#signin-status');
let connected = false;

function setStatus(message) {
  if (statusLine) statusLine.textContent = message;
}

function randomId() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function sessionId() {
  try {
    let value = localStorage.getItem(SESSION_KEY) || '';
    if (!value) {
      value = randomId();
      localStorage.setItem(SESSION_KEY, value);
    }
    return value;
  } catch {
    return randomId();
  }
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function targetUrl() {
  try {
    const raw = new URLSearchParams(location.search).get('returnTo') || '/';
    const url = new URL(raw, location.href);
    return url.origin === location.origin ? url.toString() : `${location.origin}/`;
  } catch {
    return `${location.origin}/`;
  }
}

async function fetchJson(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: { 'x-spanner-session': sessionId(), ...(options.headers || {}) },
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw new Error('Sign-in API unavailable on this host.'); }
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function openModal() {
  if (!dialog) return;
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute('open', '');
}

async function refreshAuth() {
  try {
    const status = await fetchJson('/api/auth/github');
    connected = Boolean(status.connected);
    const login = status.user && status.user.login ? `@${status.user.login}` : 'GitHub';
    if (openButton) openButton.textContent = connected ? `Signed in ${login}` : 'Sign in';
    if (githubButton) {
      githubButton.textContent = connected ? 'Open web app' : 'Continue with GitHub';
      githubButton.disabled = !connected && !status.configured;
    }
    setStatus(connected ? `Signed in as ${login}.` : status.configured ? 'Sign in with GitHub to continue.' : 'GitHub sign-in is not configured yet.');
  } catch (error) {
    setStatus(error.message);
  }
}

async function startGitHubSignIn() {
  if (connected) {
    location.href = targetUrl();
    return;
  }
  if (githubButton) githubButton.disabled = true;
  setStatus('Opening GitHub sign-in…');
  try {
    const payload = await fetchJson('/api/auth/github/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnTo: targetUrl() }),
    });
    location.href = payload.loginUrl;
  } catch (error) {
    if (githubButton) githubButton.disabled = false;
    setStatus(error.message);
  }
}

openButton?.addEventListener('click', () => { openModal(); void refreshAuth(); });
closeButton?.addEventListener('click', () => dialog?.close());
dialog?.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
githubButton?.addEventListener('click', () => { void startGitHubSignIn(); });
