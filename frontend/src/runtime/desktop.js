const API_BASE = String(import.meta.env?.VITE_SPANNER_API_BASE || '').trim().replace(/\/+$/, '');
const SESSION_KEY = 'spannerBrowserSession';

try {
  if (localStorage.getItem(SESSION_KEY) === null) {
    const value = localStorage.getItem('workbenchBrowserSession');
    if (value !== null) localStorage.setItem(SESSION_KEY, value);
  }
  localStorage.removeItem('workbenchBrowserSession');
} catch {}

const openButtons = document.querySelectorAll('[data-open-signin]');
const signInButton = document.querySelector('#signin-open');
const signInCard = document.querySelector('#github-signin-card');
const githubButton = document.querySelector('#github-signin-main');
const statusLine = document.querySelector('#github-signin-status');
const agentLoop = document.querySelector('[data-landing-agent-loop]');
const agentComposer = document.querySelector('[data-landing-agent-composer]');
const agentPrompt = document.querySelector('[data-landing-agent-prompt]');
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

function createAgent({ title, status }, slot, entering = false) {
  const agent = document.createElement('article');
  agent.className = `landing-agent${entering ? ' is-entering' : ''}`;
  agent.style.setProperty('--slot', slot);
  agent.innerHTML = `<span class="landing-agent-dot"></span><span><strong>${title}</strong><small>${status}</small></span><span class="landing-agent-time">running</span>`;
  return agent;
}

function startPromptComposer(target = agentPrompt, composer = agentComposer) {
  if (!target) return;
  const prompts = [
    'review the settings page',
    'fix the mobile walkthrough',
    'straighten the layout borders',
    'load every GitHub repo',
  ];
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    target.textContent = prompts[0];
    return;
  }
  let promptIndex = 0;
  let charIndex = 0;
  function typeNext() {
    const prompt = prompts[promptIndex % prompts.length];
    charIndex += 1;
    target.textContent = prompt.slice(0, charIndex);
    if (charIndex < prompt.length) {
      setTimeout(typeNext, 42);
      return;
    }
    composer?.classList.add('is-submitting');
    setTimeout(() => {
      composer?.classList.remove('is-submitting');
      target.textContent = '';
      charIndex = 0;
      promptIndex += 1;
      setTimeout(typeNext, 620);
    }, 760);
  }
  setTimeout(typeNext, 500);
}

function startAgentLoop(stack = agentLoop) {
  if (!stack || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const agents = [
    { title: 'Settings Page Review', status: 'answering' },
    { title: 'Mobile UI Walkthrough', status: 'running command' },
    { title: 'Separation Borders', status: 'editing CSS' },
    { title: 'Main Screen Layout', status: 'thinking' },
    { title: 'GitHub Repo Loader', status: 'running tests' },
    { title: 'Auth Callback Race', status: 'reading files' },
    { title: 'Trace Card Polish', status: 'editing React' },
    { title: 'Remote Loading Audit', status: 'checking timings' },
  ];
  let next = 4;

  function tick() {
    const first = stack.firstElementChild;
    if (!first) return;
    first.classList.add('is-done');
    first.querySelector('small').textContent = 'finished · evidence ready';
    first.querySelector('.landing-agent-time').textContent = 'done';
    setTimeout(() => {
      Array.from(stack.children).slice(1).forEach((agent, index) => agent.style.setProperty('--slot', index));
      first.classList.add('is-leaving');
      setTimeout(() => {
        first.remove();
        const incoming = createAgent(agents[next++ % agents.length], stack.children.length, true);
        stack.appendChild(incoming);
        requestAnimationFrame(() => incoming.classList.remove('is-entering'));
      }, 460);
    }, 850);
  }

  setTimeout(tick, 900);
  setInterval(tick, 2600);
}

function setSignInOpen(open) {
  if (!signInCard) return;
  signInCard.hidden = !open;
  if (open) githubButton?.focus({ preventScroll: true });
}

async function refreshAuth() {
  try {
    const status = await fetchJson('/api/auth/github');
    connected = Boolean(status.connected);
    const login = status.user && status.user.login ? `@${status.user.login}` : 'GitHub';
    if (signInButton) signInButton.textContent = connected ? `Signed in ${login}` : 'Sign in';
    if (githubButton) githubButton.disabled = !connected && !status.configured;
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

startAgentLoop();
startPromptComposer();

openButtons.forEach((button) => button.addEventListener('click', () => { setSignInOpen(true); void refreshAuth(); }));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setSignInOpen(false); });
document.addEventListener('click', (event) => {
  if (signInCard?.hidden || signInCard?.contains(event.target) || event.target.closest?.('[data-open-signin]')) return;
  setSignInOpen(false);
});
githubButton?.addEventListener('click', () => { void startGitHubSignIn(); });
