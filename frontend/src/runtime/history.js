import './appearance.js?v=palette-2';

const BROWSER_SESSION_KEY = 'spannerBrowserSession';
const PROJECT_KEY = 'spannerSelectedProject';
const ACTIVE_STATUSES = new Set(['launching', 'queued', 'starting', 'running', 'reconnecting']);
const API_BASE = String(import.meta.env?.VITE_SPANNER_API_BASE || '').trim().replace(/\/+$/, '');
const doc = globalThis.document;
const storage = globalThis.localStorage && typeof globalThis.localStorage.getItem === 'function' ? globalThis.localStorage : null;

function migrateStorageKey(legacyKey, nextKey) {
  try {
    if (storage?.getItem(nextKey) === null) {
      const value = storage.getItem(legacyKey);
      if (value !== null) storage.setItem(nextKey, value);
    }
    storage?.removeItem(legacyKey);
  } catch {}
}

migrateStorageKey('workbenchBrowserSession', BROWSER_SESSION_KEY);
migrateStorageKey('workbenchSelectedProject', PROJECT_KEY);

const projectLabel = doc?.querySelector('#project-label');
const workspaceLabel = doc?.querySelector('#workspace-label');
const historyStatus = doc?.querySelector('#history-status');
const historyStatsNode = doc?.querySelector('#history-stats');
const historyList = doc?.querySelector('#history-list');
const historySearch = doc?.querySelector('#history-search');
let allRows = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getBrowserSessionId() {
  let sessionId = storage?.getItem(BROWSER_SESSION_KEY) || '';
  if (!sessionId) {
    sessionId = globalThis.crypto?.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('-');
    storage?.setItem(BROWSER_SESSION_KEY, sessionId);
  }
  return sessionId;
}

function getApiBase() {
  return API_BASE;
}

function getApiToken() {
  return '';
}

function readSelectedProject() {
  try {
    const project = JSON.parse(storage?.getItem(PROJECT_KEY) || 'null');
    return project?.value ? project : null;
  } catch {
    return null;
  }
}

function cleanProjectValue(value) {
  return String(value || '').trim().replace(/[\\/]+$/, '');
}

function looksLikeLocalPath(value) {
  return /^(~|\/|[A-Za-z]:[\\/]|\\\\)/.test(String(value || '').trim());
}

function compactProjectLabel(value) {
  const text = cleanProjectValue(value)
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '');
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join('/') || text || 'workspace';
}

function normalizeRepoUrl(value) {
  const text = cleanProjectValue(value);
  if (!text) return '';
  if (/^[\w.-]+\/[\w.-]+(?:\.git)?$/i.test(text)) return `https://github.com/${text.replace(/\.git$/i, '')}.git`;
  if (/^github\.com\//i.test(text)) return `https://${text.replace(/\.git$/i, '')}.git`;
  return text;
}

function canonicalRepo(value) {
  return normalizeRepoUrl(value).replace(/\.git$/i, '').toLowerCase();
}

export function historyMatchesProject(session = {}, project = {}) {
  const value = cleanProjectValue(project?.value);
  if (!value) return true;
  if (project?.kind === 'local' || looksLikeLocalPath(value)) return cleanProjectValue(session.repoPath) === value;
  return canonicalRepo(session.repoUrl || session.repoPath) === canonicalRepo(value);
}

export function filterSessionsByProject(sessions = [], project = null) {
  if (!project?.value) return sessions;
  return sessions.filter((session) => historyMatchesProject(session, project));
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
  const response = await fetch(apiUrl(path), { credentials: 'include', ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function threadUrl(name) {
  return `/thread.html?${new URLSearchParams({ name })}`;
}

function statusValue(session = {}) {
  return String(session.runStatus || session.status || 'unknown').trim().toLowerCase() || 'unknown';
}

function repoLabel(session = {}) {
  return String(session.repoPath || session.repoUrl || session.cloudflareSandboxName || session.sandboxId || 'no repo').trim();
}

function promptText(session = {}) {
  return String(session.initialPrompt || session.taskPrompt || '').trim();
}

function firstLine(value, fallback = '') {
  const text = String(value || '').trim();
  return (text.split(/\r?\n/).find(Boolean) || fallback).trim();
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function historyKind(session = {}) {
  if (session.threadBridge) return 'thread agent';
  if (session.hostDispatchMode) return 'host agent';
  if (session.localMode) return 'local session';
  if (session.bridgeMode) return 'bridge session';
  return 'session';
}

export function normalizeHistoryRow(session = {}) {
  const status = statusValue(session);
  const prompt = promptText(session);
  const name = String(session.name || '').trim();
  const title = String(session.title || firstLine(prompt, name) || name || 'untitled').trim();
  const kind = historyKind(session);
  const repo = repoLabel(session);
  const archived = Boolean(session.archivedAt);
  const active = ACTIVE_STATUSES.has(status);
  return {
    name,
    title,
    kind,
    status,
    active,
    archived,
    repo,
    branch: String(session.branch || '').trim(),
    prompt,
    createdAt: session.createdAt || '',
    updatedAt: session.updatedAt || '',
    archivedAt: session.archivedAt || '',
    failed: status === 'failed' || status === 'error',
    href: session.threadBridge && name ? threadUrl(name) : '',
  };
}

export function historyStats(sessions = []) {
  const rows = sessions.map(normalizeHistoryRow);
  return {
    total: rows.length,
    threads: rows.filter((row) => row.kind === 'thread agent').length,
    sessions: rows.filter((row) => row.kind !== 'thread agent').length,
    active: rows.filter((row) => row.active).length,
    archived: rows.filter((row) => row.archived).length,
    failed: rows.filter((row) => row.failed).length,
  };
}

export function historySearchText(row = {}) {
  return [row.title, row.name, row.kind, row.repo, row.branch, row.status, row.prompt]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function canUnarchiveHistoryRow(row = {}) {
  return Boolean(row.archived && row.href);
}

export function filterHistoryRows(rows = [], query = '') {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => historySearchText(row).includes(needle));
}

function renderProject(provider) {
  const project = provider?.project || {};
  const name = String(project.name || '').trim();
  const visible = name && name !== 'spanner';
  if (!projectLabel) return;
  projectLabel.hidden = !visible;
  projectLabel.textContent = visible ? name : '';
  projectLabel.title = project.home ? `Project state: ${project.home}` : `Project: ${name}`;
}

function renderWorkspace(project) {
  if (!workspaceLabel) return;
  workspaceLabel.textContent = project?.label || compactProjectLabel(project?.value);
  workspaceLabel.title = project?.value || '';
}

function renderStats(stats) {
  if (!historyStatsNode) return;
  const items = [
    ['total', stats.total],
    ['threads', stats.threads],
    ['sessions', stats.sessions],
    ['active', stats.active],
    ['archived', stats.archived],
    ['failed', stats.failed],
  ];
  historyStatsNode.innerHTML = items.map(([label, value]) => `
    <article class="history-stat">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </article>
  `).join('');
}

function renderHistoryCard(row) {
  const dateBits = [
    row.createdAt ? `created ${formatDate(row.createdAt)}` : '',
    row.updatedAt ? `updated ${formatDate(row.updatedAt)}` : '',
    row.archivedAt ? `archived ${formatDate(row.archivedAt)}` : '',
  ].filter(Boolean);
  const repo = `${row.repo}${row.branch ? ` · ${row.branch}` : ''}`;
  const restoreButton = canUnarchiveHistoryRow(row)
    ? `<button class="textbtn restore-thread" type="button" data-unarchive-thread="${escapeHtml(row.name)}">restore to workspace</button>`
    : '';
  const title = row.href
    ? `<a href="${escapeHtml(row.href)}">${escapeHtml(row.title)}</a>`
    : escapeHtml(row.title);
  return `
    <article class="history-card ${escapeHtml(row.status)}" data-archived="${row.archived}">
      <span class="status-dot" aria-hidden="true"></span>
      <div class="history-card-main">
        <div class="history-card-title">
          <strong>${title}</strong>
          <span class="history-badges"><span class="badge">${escapeHtml(row.kind)}</span><span class="badge ${escapeHtml(row.status)}">${escapeHtml(row.status)}</span>${row.archived ? '<span class="badge">archived</span>' : ''}${restoreButton}</span>
        </div>
        <p class="history-repo">${escapeHtml(repo)}</p>
        ${row.prompt ? `<p class="history-prompt">${escapeHtml(firstLine(row.prompt).slice(0, 220))}</p>` : ''}
        <p class="history-meta">${escapeHtml(dateBits.join(' · ') || row.name)}</p>
      </div>
    </article>
  `;
}

function renderRows() {
  const filtered = filterHistoryRows(allRows, historySearch?.value || '');
  if (historyStatus) historyStatus.textContent = `${filtered.length} shown · ${allRows.length} saved`;
  if (!historyList) return;
  historyList.innerHTML = filtered.length
    ? filtered.map(renderHistoryCard).join('')
    : '<p class="empty-state">No saved agents match that search.</p>';
}

async function restoreArchivedThread(name, button) {
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = 'restoring…';
  try {
    await fetchJson(`/api/threads/${encodeURIComponent(name)}/unarchive`, { method: 'POST' });
    await initHistory();
  } catch (error) {
    button.disabled = false;
    button.textContent = previousText;
    if (historyStatus) historyStatus.textContent = error.message;
  }
}

async function initHistory() {
  const selectedProject = readSelectedProject();
  if (!selectedProject?.value) {
    if (historyStatus) historyStatus.textContent = 'Pick a project to see its history.';
    globalThis.location?.replace?.('/');
    return;
  }

  try {
    const payload = await fetchJson('/api/sessions');
    const sessions = filterSessionsByProject(Array.isArray(payload.sessions) ? payload.sessions : [], selectedProject);
    renderProject(payload.provider);
    renderWorkspace(selectedProject);
    renderStats(historyStats(sessions));
    allRows = sessions
      .map(normalizeHistoryRow)
      .sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)));
    renderRows();
  } catch (error) {
    if (historyStatus) historyStatus.textContent = error.message;
    if (historyList) historyList.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

historySearch?.addEventListener('input', renderRows);
historyList?.addEventListener('click', (event) => {
  const button = event.target?.closest?.('[data-unarchive-thread]');
  if (!button) return;
  void restoreArchivedThread(button.dataset.unarchiveThread, button);
});
if (doc) void initHistory();
