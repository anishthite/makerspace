import './appearance.js?v=palette-2';

import { captureSpannerEvent } from '../lib/posthog.js';
import { redirectIfAuthRequired } from './auth-redirect.js';

const BROWSER_SESSION_KEY = 'spannerBrowserSession';
const PROJECT_KEY = 'spannerSelectedProject';
const RECENT_PROJECTS_KEY = 'spannerRecentProjects';
const ONBOARDING_DISMISSED_KEY = 'spannerOnboardingDismissed';
const INITIAL_REPO_SUGGESTIONS = 12;
const REPO_SUGGESTION_PAGE_SIZE = 24;
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
migrateStorageKey('workbenchSelectedProject', PROJECT_KEY);
migrateStorageKey('workbenchRecentProjects', RECENT_PROJECTS_KEY);

const codexAuthPill = document.querySelector('#codex-auth-pill');
const codexAuthLabel = document.querySelector('#codex-auth-label');
const githubAuthPill = document.querySelector('#github-auth-pill');
const githubAuthLabel = document.querySelector('#github-auth-label');
const githubSigninCard = document.querySelector('#github-signin-card');
const githubSigninButtons = Array.from(document.querySelectorAll('[data-github-signin]'));
const githubSigninCopy = document.querySelector('#github-signin-copy');
const githubSigninStatus = document.querySelector('#github-signin-status');
const projectHero = document.querySelector('#project-hero');
const projectGrid = document.querySelector('#project-grid');
const form = document.querySelector('#project-form');
const repoInput = document.querySelector('#project-repo-url');
const repoSourceInput = document.querySelector('#project-repo-source');
const branchInput = document.querySelector('#project-branch');
const repoOptions = document.querySelector('#project-repo-options');
const repoTray = document.querySelector('#project-repo-tray');
const repoRefresh = document.querySelector('#project-repo-refresh');
const chooseFolder = document.querySelector('#project-choose-folder');
const repoHint = document.querySelector('#project-repo-hint');
const statusLine = document.querySelector('#project-status');
const recentList = document.querySelector('#project-recent-list');
const projectWelcome = document.querySelector('#project-welcome');
const projectSubtitle = document.querySelector('#project-subtitle');
const onboardingDialog = document.querySelector('#onboarding-dialog');
const onboardingClose = document.querySelector('#onboarding-close');
const onboardingActionButtons = Array.from(document.querySelectorAll('[data-onboarding-action]'));
const onboardingPickRepo = document.querySelector('#onboarding-pick-repo');

let providerKind = '';
let githubRepos = [];
let selectedRepo = null;
let repoMatches = [];
let activeRepoMatchIndex = -1;
let repoSuggestionLimit = INITIAL_REPO_SUGGESTIONS;
let githubConnected = false;
let codexConfigured = false;
let claudeCodeConfigured = false;
let projectThreadCount = 0;
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

function repoFullName(repo) {
  return String(repo?.fullName || [repo?.owner, repo?.name].filter(Boolean).join('/') || repo?.name || '').trim();
}

function repoShortName(repo) {
  return String(repo?.name || repoFullName(repo).split('/').pop() || '').trim();
}

function repoVisibility(repo) {
  return repo?.private ? 'private' : 'public';
}

function repoSelectionLabel(repo) {
  return `${repoFullName(repo)} · ${repoVisibility(repo)}`;
}

function normalizeSearch(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/^github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/i, '');
}

function compactSearch(value) {
  return normalizeSearch(value).replace(/[^a-z0-9]+/g, '');
}

function searchTokens(value) {
  return normalizeSearch(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function fuzzyScore(haystack, needle) {
  if (!needle) return 0;
  let cursor = -1;
  let gaps = 0;
  for (const character of needle) {
    const next = haystack.indexOf(character, cursor + 1);
    if (next === -1) return 0;
    gaps += next - cursor - 1;
    cursor = next;
  }
  return Math.max(1, 260 - gaps);
}

function scoreRepo(repo, query) {
  const rawQuery = normalizeSearch(query);
  if (!rawQuery) return 1;

  const fullName = repoFullName(repo).toLowerCase();
  const shortName = repoShortName(repo).toLowerCase();
  const owner = String(repo?.owner || fullName.split('/')[0] || '').toLowerCase();
  const cloneUrl = String(repo?.cloneUrl || '').toLowerCase();
  const normalizedCloneUrl = normalizeSearch(cloneUrl);
  const compactQuery = compactSearch(rawQuery);
  const compactFullName = compactSearch(fullName);
  const compactShortName = compactSearch(shortName);

  if ([fullName, shortName, cloneUrl, normalizedCloneUrl].includes(rawQuery)) return 1000;
  if (shortName.startsWith(rawQuery)) return 930;
  if (fullName.startsWith(rawQuery)) return 900;
  if (compactQuery && compactShortName.startsWith(compactQuery)) return 860;
  if (compactQuery && compactFullName.startsWith(compactQuery)) return 830;

  const tokens = searchTokens(rawQuery);
  if (tokens.length && tokens.every((token) => fullName.includes(token) || shortName.includes(token) || owner.includes(token))) {
    return 760 - Math.min(120, Math.max(0, fullName.indexOf(tokens[0])));
  }

  if (shortName.includes(rawQuery)) return 720;
  if (fullName.includes(rawQuery)) return 700;
  if (compactQuery && compactShortName.includes(compactQuery)) return 660;
  if (compactQuery && compactFullName.includes(compactQuery)) return 630;

  const fuzzy = fuzzyScore(compactFullName, compactQuery);
  return fuzzy ? 420 + fuzzy : -1;
}

function filterRepos(query, limit = repoSuggestionLimit) {
  return githubRepos
    .map((repo) => ({ repo, score: scoreRepo(repo, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || repoFullName(left.repo).localeCompare(repoFullName(right.repo)))
    .slice(0, limit)
    .map((entry) => entry.repo);
}

function repoMatchesInput(repo, value) {
  const text = cleanProjectValue(value);
  if (!repo || !text) return false;
  const normalized = normalizeSearch(text);
  return [repoFullName(repo), repoShortName(repo), repo.cloneUrl].some((candidate) => normalizeSearch(candidate) === normalized);
}

function matchingRepoFromInput(value) {
  const text = cleanProjectValue(value);
  if (!text || looksLikeLocalPath(text) || !githubRepos.length) return null;
  const exactMatches = githubRepos.filter((repo) => repoMatchesInput(repo, text));
  if (exactMatches.length === 1) return exactMatches[0];

  const smartMatches = filterRepos(text, 2);
  if (smartMatches.length === 1 && scoreRepo(smartMatches[0], text) >= 700) return smartMatches[0];
  return null;
}

function looksLikeBareRepoName(value) {
  return /^[\w.-]+$/i.test(String(value || '').trim());
}

function acceptsLocalFolders() {
  return providerKind === 'local' || Boolean(globalThis.spannerDesktop?.chooseFolder);
}

function projectFromInput() {
  const rawValue = cleanProjectValue(repoInput.value);
  if (!rawValue) return null;

  if (looksLikeLocalPath(rawValue) && !acceptsLocalFolders()) return null;

  const local = acceptsLocalFolders() && (providerKind === 'local' || looksLikeLocalPath(rawValue));
  if (local) {
    return {
      kind: 'local',
      value: rawValue,
      label: projectLabel(rawValue),
      repoSource: '',
      branch: '',
    };
  }

  const matchedRepo = repoMatchesInput(selectedRepo, rawValue) ? selectedRepo : matchingRepoFromInput(rawValue);
  if (matchedRepo) {
    selectedRepo = matchedRepo;
    repoSourceInput.value = 'github';
    branchInput.value = matchedRepo.defaultBranch || '';
    return {
      kind: 'git',
      value: matchedRepo.cloneUrl || normalizeRepoUrl(repoFullName(matchedRepo)),
      label: repoFullName(matchedRepo),
      repoSource: 'github',
      branch: matchedRepo.defaultBranch || '',
    };
  }

  if (githubConnected && looksLikeBareRepoName(rawValue)) return null;

  const value = normalizeRepoUrl(rawValue);
  return {
    kind: 'git',
    value,
    label: projectLabel(value),
    repoSource: repoSourceInput.value,
    branch: branchInput.value,
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
  projectThreadCount = Array.isArray(threads) ? threads.length : 0;
  const projects = readRecentProjects()
    .map((project, index) => ({ project, index }))
    .filter(({ project }) => acceptsLocalFolders() || project.kind !== 'local');
  if (!projects.length) {
    recentList.innerHTML = '<p class="empty-state">No recent projects yet.</p>';
    return;
  }
  recentList.innerHTML = projects.map(({ project, index }) => {
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

function renderWelcome(user) {
  if (!projectWelcome) return;
  const name = String(user?.name || user?.login || '').trim().replace(/\s+/g, ' ');
  projectWelcome.textContent = name ? `Welcome back, ${name}.` : 'Welcome back.';
}

function onboardingDismissed() {
  try { return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1'; }
  catch { return false; }
}

function dismissOnboarding() {
  try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1'); }
  catch {}
  onboardingDialog?.close?.();
}

function showOnboardingAfterGitHubSignIn(connected) {
  if (!connected || new URLSearchParams(location.search).get('github') !== 'connected') return;
  try { localStorage.removeItem(ONBOARDING_DISMISSED_KEY); }
  catch {}
  history.replaceState({}, '', location.pathname);
}

function setOnboardingStep(key, state) {
  const step = onboardingDialog?.querySelector(`[data-onboarding-step="${key}"]`);
  if (!step) return;
  step.dataset.state = state;
  const marker = step.querySelector('.onboarding-step-num');
  if (!marker) return;
  const number = step.dataset.stepNumber || marker.textContent;
  marker.textContent = state === 'done' ? '✓' : number;
  marker.setAttribute('aria-label', state === 'done' ? 'completed' : `step ${number}`);
}

function renderOnboarding() {
  if (!onboardingDialog) return;
  const remoteProvider = providerKind === 'cloudflare';
  if (!remoteProvider || globalThis.spannerDesktop) {
    onboardingDialog.close?.();
    return;
  }
  if (githubSigninCard && !githubSigninCard.hidden) {
    onboardingDialog.close?.();
    return;
  }
  const steps = [
    ['github', githubConnected],
    ['llm', codexConfigured || claudeCodeConfigured],
    ['project', Boolean(cleanProjectValue(repoInput.value)) || readRecentProjects().length > 0],
    ['agent', projectThreadCount > 0],
  ];
  const currentIndex = steps.findIndex(([, done]) => !done);
  for (const [index, [key, done]] of steps.entries()) {
    setOnboardingStep(key, done ? 'done' : index === currentIndex ? 'current' : 'todo');
  }
  const currentStep = steps[currentIndex]?.[0] || '';
  for (const button of onboardingActionButtons) button.hidden = button.dataset.onboardingAction !== currentStep;
  const complete = currentIndex < 0;
  if (complete) dismissOnboarding();
  if (!complete && !onboardingDismissed() && !onboardingDialog.open) {
    try { onboardingDialog.showModal ? onboardingDialog.showModal() : onboardingDialog.setAttribute('open', ''); }
    catch {}
  }
}

function focusProjectPicker() {
  onboardingDialog?.close?.();
  projectGrid.hidden = false;
  projectHero.hidden = false;
  repoInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
  repoInput.focus();
  renderRepoSuggestions();
}

function renderAuthError(message) {
  for (const pill of [codexAuthPill, githubAuthPill]) {
    pill.dataset.status = 'error';
    pill.title = message;
  }
  githubConnected = false;
  repoRefresh.disabled = true;
  hideRepoSuggestions();
  if (githubSigninCard) githubSigninCard.hidden = true;
  if (projectHero) projectHero.hidden = false;
  if (projectGrid) projectGrid.hidden = false;
}

function hideRepoSuggestions() {
  repoOptions.hidden = true;
  repoInput.setAttribute('aria-expanded', 'false');
  repoInput.removeAttribute('aria-activedescendant');
  activeRepoMatchIndex = -1;
}

function resetRepoSelection(message) {
  selectedRepo = null;
  repoSourceInput.value = '';
  branchInput.value = '';
  if (message !== undefined) repoHint.textContent = message;
}

function selectRepo(repo) {
  if (!repo) return;
  selectedRepo = repo;
  repoSourceInput.value = 'github';
  branchInput.value = repo.defaultBranch || '';
  repoInput.value = repoFullName(repo);
  repoHint.textContent = repoSelectionLabel(repo);
  hideRepoSuggestions();
  renderOnboarding();
}

function setActiveRepoMatch(index) {
  if (!repoMatches.length) {
    activeRepoMatchIndex = -1;
    repoInput.removeAttribute('aria-activedescendant');
    return;
  }
  activeRepoMatchIndex = (index + repoMatches.length) % repoMatches.length;
  renderRepoSuggestions();
}

function resetRepoSuggestionLimit() {
  repoSuggestionLimit = INITIAL_REPO_SUGGESTIONS;
}

function showMoreRepoSuggestions() {
  if (repoOptions.hidden || repoMatches.length < repoSuggestionLimit) return;
  const scrollTop = repoOptions.scrollTop;
  repoSuggestionLimit += REPO_SUGGESTION_PAGE_SIZE;
  renderRepoSuggestions();
  repoOptions.scrollTop = scrollTop;
}

function renderRepoSuggestions() {
  if (providerKind === 'local' || !githubConnected || !githubRepos.length) {
    hideRepoSuggestions();
    return;
  }

  const query = repoInput.value.trim();
  repoMatches = filterRepos(query);
  if (!repoMatches.length) {
    repoOptions.innerHTML = '<div class="repo-suggestion-empty" role="presentation">No matching repos. Paste a full URL to use it anyway.</div>';
    repoInput.setAttribute('aria-expanded', 'true');
    repoInput.removeAttribute('aria-activedescendant');
    repoOptions.hidden = false;
    activeRepoMatchIndex = -1;
    return;
  }

  if (query && activeRepoMatchIndex < 0) activeRepoMatchIndex = 0;
  if (activeRepoMatchIndex >= repoMatches.length) activeRepoMatchIndex = repoMatches.length - 1;

  repoOptions.innerHTML = repoMatches.map((repo, index) => {
    const active = index === activeRepoMatchIndex;
    const branch = repo.defaultBranch ? ` · ${repo.defaultBranch}` : '';
    return `
      <button id="project-repo-option-${index}" class="repo-suggestion${active ? ' is-active' : ''}" type="button" role="option" aria-selected="${active ? 'true' : 'false'}" data-repo-index="${index}">
        <span><strong>${escapeHtml(repoFullName(repo))}</strong><small>${escapeHtml(repo.cloneUrl || '')}</small></span>
        <em>${escapeHtml(repoVisibility(repo) + branch)}</em>
      </button>
    `;
  }).join('');

  repoInput.setAttribute('aria-expanded', 'true');
  if (activeRepoMatchIndex >= 0) repoInput.setAttribute('aria-activedescendant', `project-repo-option-${activeRepoMatchIndex}`);
  else repoInput.removeAttribute('aria-activedescendant');
  repoOptions.hidden = false;
}

async function loadLastFolder() {
  if (!globalThis.spannerDesktop?.getLastFolder || repoInput.value.trim()) return;
  try {
    const folder = await globalThis.spannerDesktop.getLastFolder();
    if (!folder || repoInput.value.trim()) return;
    repoInput.value = folder;
    repoHint.textContent = 'Last local folder loaded.';
  } catch {}
}

function renderProjectModeCopy() {
  const local = acceptsLocalFolders();
  form.dataset.projectMode = local ? 'local' : 'remote';
  if (projectSubtitle) projectSubtitle.textContent = local
    ? 'Choose a local folder or paste its path.'
    : 'Choose a GitHub repo or paste a repo URL.';
  repoInput.placeholder = local ? '/Users/you/project' : 'owner/repo or URL';
}

function renderProvider(provider) {
  providerKind = provider?.kind || '';
  const local = providerKind === 'local';
  const canChooseFolder = Boolean(globalThis.spannerDesktop?.chooseFolder);
  renderProjectModeCopy();
  repoTray.hidden = local && canChooseFolder;
  repoRefresh.hidden = local;
  chooseFolder.hidden = !canChooseFolder;
  if (local) {
    hideRepoSuggestions();
    resetRepoSelection('');
    void loadLastFolder();
  }
}

function renderRepoOptions(repos) {
  resetRepoSuggestionLimit();
  repoHint.textContent = repos.length ? `${repos.length} GitHub repos · type to filter` : 'No GitHub repos found.';
  if (document.activeElement === repoInput) renderRepoSuggestions();
}

async function loadGitHubRepos() {
  if (providerKind === 'local') return;
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
  statusLine.textContent = message;
}

function renderGitHubSignIn(status) {
  const connected = Boolean(status.connected);
  const desktop = Boolean(globalThis.spannerDesktop);
  const showGate = !desktop && providerKind !== 'local' && !connected && status.configured;
  if (githubSigninCard) githubSigninCard.hidden = !showGate;
  if (projectHero) projectHero.hidden = showGate;
  if (projectGrid) projectGrid.hidden = showGate;
  for (const button of githubSigninButtons) {
    button.hidden = desktop || providerKind === 'local' || connected || !status.configured;
    button.disabled = !status.configured;
  }
  if (githubSigninCopy && status.configured) githubSigninCopy.textContent = 'Connect GitHub to launch agents on your repos without sharing credentials with anyone else.';
  if (showGate) setSignInStatus('Sign in with GitHub to continue.');
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

async function refreshProjectThreads() {
  await loadRecentProjects();
  const payload = await fetchJson('/api/threads');
  renderProvider(payload.provider);
  renderRecentProjects(payload.threads || []);
}

function renderProjectAuth(codex = {}, github = {}, claudeCode = {}) {
  codexConfigured = Boolean(codex.configured);
  claudeCodeConfigured = Boolean(claudeCode.configured);
  renderAuthPill(codexAuthPill, codexAuthLabel, codexConfigured || claudeCodeConfigured, codexConfigured ? `Codex: ${codex.source || 'signed in'}` : claudeCodeConfigured ? `Claude: ${claudeCode.source || 'signed in'}` : 'LLM: signed out', 'llm');
  const connected = Boolean(github.connected);
  githubConnected = connected;
  showOnboardingAfterGitHubSignIn(connected);
  renderWelcome(connected ? github.user : null);
  renderAuthPill(githubAuthPill, githubAuthLabel, connected, connected ? `GitHub: ${github.user?.login || 'connected'}` : github.configured ? 'GitHub: signed out' : 'GitHub: not configured', 'github');
  renderGitHubSignIn(github);
  repoRefresh.disabled = providerKind === 'local' || !connected;
  if (connected && providerKind !== 'local') {
    repoHint.textContent = 'Loading GitHub repos…';
    void loadGitHubRepos().catch((error) => {
      repoHint.textContent = error.message;
    });
  } else if (providerKind !== 'local') {
    githubRepos = [];
    hideRepoSuggestions();
    repoHint.textContent = github.configured ? 'Sign in to pick repos.' : 'Paste a GitHub repo URL.';
  }
  renderOnboarding();
}

async function loadProjectAuth() {
  const [codex, github, claudeCode] = await Promise.all([
    fetchJson('/api/auth/openai-codex'),
    fetchJson('/api/auth/github'),
    fetchJson('/api/auth/claude-code'),
  ]);
  renderProjectAuth(codex, github, claudeCode);
}

async function loadProjectBootstrap() {
  const payload = await fetchJson('/api/bootstrap?page=project&fast=1');
  cacheRecentProjects(payload.recentProjects || []);
  renderProvider(payload.provider);
  renderRecentProjects(payload.threads || []);

  if (payload.codex?.deferred || payload.github?.deferred || payload.claudeCode?.deferred) {
    void loadProjectAuth().catch((error) => {
      repoHint.textContent = error.message;
    });
  } else {
    renderProjectAuth(payload.codex || {}, payload.github || {}, payload.claudeCode || {});
  }
}

async function loadStatus() {
  getBrowserSessionId();
  renderRecentProjects();
  renderProjectModeCopy();
  if (globalThis.spannerDesktop?.chooseFolder) {
    chooseFolder.hidden = false;
    repoTray.hidden = true;
    repoHint.textContent = 'Choose a local folder or paste its path.';
    void loadLastFolder();
  }

  try {
    await loadProjectBootstrap();
  } catch (error) {
    renderAuthError(error.message);
  }
}

async function openWorkspace(project) {
  await saveProject(project);
  captureSpannerEvent('workspace_opened', {
    source: project.kind === 'local' ? 'local' : 'github',
    desktop: Boolean(globalThis.spannerDesktop),
    has_branch: Boolean(project.branch),
  });
  if (project.kind === 'local') {
    try {
      await globalThis.spannerDesktop?.rememberFolder?.(project.value);
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
    const folder = await globalThis.spannerDesktop?.chooseFolder?.(repoInput.value.trim());
    if (!folder) return;
    repoInput.value = folder;
    resetRepoSelection('Local folder selected.');
    statusLine.textContent = 'Ready to open the workspace.';
    renderOnboarding();
  } catch (error) {
    statusLine.textContent = error.message;
  }
});

repoInput.addEventListener('focus', () => {
  resetRepoSuggestionLimit();
  renderRepoSuggestions();
});

repoInput.addEventListener('input', () => {
  const value = repoInput.value.trim();
  if (!selectedRepo || !repoMatchesInput(selectedRepo, value)) {
    resetRepoSelection(value ? 'Type to filter GitHub repos, or paste a URL.' : '');
  }
  activeRepoMatchIndex = -1;
  resetRepoSuggestionLimit();
  renderRepoSuggestions();
  renderOnboarding();
});

repoInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (repoOptions.hidden) renderRepoSuggestions();
    setActiveRepoMatch(activeRepoMatchIndex + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (repoOptions.hidden) renderRepoSuggestions();
    setActiveRepoMatch(activeRepoMatchIndex < 0 ? repoMatches.length - 1 : activeRepoMatchIndex - 1);
  } else if (event.key === 'Enter' && !repoOptions.hidden && activeRepoMatchIndex >= 0) {
    event.preventDefault();
    selectRepo(repoMatches[activeRepoMatchIndex]);
  } else if (event.key === 'Escape') {
    hideRepoSuggestions();
  }
});

repoOptions.addEventListener('mousedown', (event) => {
  event.preventDefault();
});

repoOptions.addEventListener('scroll', () => {
  const nearBottom = repoOptions.scrollTop + repoOptions.clientHeight >= repoOptions.scrollHeight - 32;
  if (nearBottom) showMoreRepoSuggestions();
});

repoOptions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-repo-index]');
  if (!button) return;
  selectRepo(repoMatches[Number(button.dataset.repoIndex)]);
});

document.addEventListener('mousedown', (event) => {
  if (event.target === repoInput || repoOptions.contains(event.target)) return;
  hideRepoSuggestions();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const project = projectFromInput();
  if (!project) {
    statusLine.textContent = acceptsLocalFolders()
      ? 'Choose a local folder or paste its path.'
      : 'Pick a GitHub repo or paste a repo URL.';
    renderRepoSuggestions();
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

for (const button of githubSigninButtons) button.addEventListener('click', () => startGitHubSignIn());
onboardingClose?.addEventListener('click', dismissOnboarding);
onboardingDialog?.addEventListener('cancel', () => {
  try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1'); }
  catch {}
});
onboardingPickRepo?.addEventListener('click', focusProjectPicker);

loadStatus();
