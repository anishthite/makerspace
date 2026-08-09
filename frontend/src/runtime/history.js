import './appearance.js?v=palette-2';

import { redirectIfAuthRequired } from './auth-redirect.js';

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
const historyFilterTabs = doc?.querySelector('#history-filter-tabs');
const historyFilterButtons = Array.from(doc?.querySelectorAll?.('[data-history-filter]') || []);
const historyFilterSummary = doc?.querySelector('#history-filter-summary');
const HISTORY_FILTERS = new Set(['all', 'active', 'threads', 'sessions', 'archived', 'failed']);
let allRows = [];
let activeHistoryFilter = 'all';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function classToken(value) {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
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

function folderLabel(value) {
  const text = cleanProjectValue(value);
  return text.split(/[\\/]+/).filter(Boolean).pop() || text || 'workspace';
}

function compactProjectLabel(value) {
  const text = cleanProjectValue(value)
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '');
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join('/') || text || 'workspace';
}

function selectedProjectLabel(project) {
  return project?.kind === 'local' || looksLikeLocalPath(project?.value)
    ? folderLabel(project?.value)
    : project?.label || compactProjectLabel(project?.value);
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

export function historyRowMatchesFilter(row = {}, filter = 'all') {
  switch (filter) {
    case 'active':
      return Boolean(row.active);
    case 'threads':
      return row.kind === 'thread agent';
    case 'sessions':
      return row.kind !== 'thread agent';
    case 'archived':
      return Boolean(row.archived);
    case 'failed':
      return Boolean(row.failed);
    default:
      return true;
  }
}

export function canUnarchiveHistoryRow(row = {}) {
  return Boolean(row.archived && row.href);
}

export function filterHistoryRows(rows = [], query = '', filter = 'all') {
  const needle = String(query || '').trim().toLowerCase();
  return rows.filter((row) => {
    if (!historyRowMatchesFilter(row, filter)) return false;
    if (!needle) return true;
    return historySearchText(row).includes(needle);
  });
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
  workspaceLabel.textContent = selectedProjectLabel(project);
  workspaceLabel.title = project?.value || '';
}

function renderStats(stats) {
  if (!historyStatsNode) return;
  const items = [
    ['total', 'total', stats.total],
    ['threads', 'threads', stats.threads],
    ['sessions', 'sessions', stats.sessions],
    ['active', 'active', stats.active],
    ['archived', 'archived', stats.archived],
    ['failed', 'failed', stats.failed],
  ];
  historyStatsNode.innerHTML = items.map(([key, label, value]) => `
    <article class="history-stat history-stat-${escapeHtml(key)}">
      <span class="history-stat-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join('');
}

function renderHistoryCard(row) {
  const statusClass = classToken(row.status);
  const kindClass = classToken(row.kind);
  const dateBits = [
    row.createdAt ? `created ${formatDate(row.createdAt)}` : '',
    row.updatedAt ? `updated ${formatDate(row.updatedAt)}` : '',
    row.archivedAt ? `archived ${formatDate(row.archivedAt)}` : '',
  ].filter(Boolean);
  const repo = `${row.repo}${row.branch ? ` · ${row.branch}` : ''}`;
  const restoreButton = canUnarchiveHistoryRow(row)
    ? `<button class="textbtn restore-thread" type="button" data-unarchive-thread="${escapeHtml(row.name)}">restore</button>`
    : '';
  const title = row.href
    ? `<a class="history-title-link" href="${escapeHtml(row.href)}">${escapeHtml(row.title)}</a>`
    : `<span>${escapeHtml(row.title)}</span>`;
  const openAction = row.href
    ? `<a class="textbtn history-open" href="${escapeHtml(row.href)}">open</a>`
    : '';
  const prompt = firstLine(row.prompt).slice(0, 260);
  return `
    <article class="history-card ${statusClass}" data-archived="${row.archived}" data-status="${escapeHtml(row.status)}" data-kind="${escapeHtml(kindClass)}">
      <div class="history-card-main">
        <div class="history-card-head">
          <div class="history-title-block">
            <h3 class="history-card-title"><span class="status-dot" aria-hidden="true"></span>${title}</h3>
            <p class="history-overline"><span>${escapeHtml(row.kind)}</span><span>${escapeHtml(row.status)}</span>${row.archived ? '<span>archived</span>' : ''}</p>
          </div>
          <div class="history-card-actions">${restoreButton}${openAction}</div>
        </div>
        ${prompt ? `<p class="history-prompt">${escapeHtml(prompt)}</p>` : ''}
        <div class="history-details">
          <span class="history-repo" title="${escapeHtml(repo)}">${escapeHtml(repo)}</span>
          <span class="history-meta">${escapeHtml(dateBits.join(' · ') || row.name)}</span>
        </div>
      </div>
    </article>
  `;
}

function renderRows() {
  const filtered = filterHistoryRows(allRows, historySearch?.value || '', activeHistoryFilter);
  const filterLabel = activeHistoryFilter === 'all' ? 'all history' : activeHistoryFilter;
  if (historyStatus) historyStatus.textContent = `${filtered.length} shown · ${allRows.length} saved`;
  if (historyFilterSummary) historyFilterSummary.textContent = `${filterLabel} · ${filtered.length} shown`;
  if (!historyList) return;
  historyList.innerHTML = filtered.length
    ? filtered.map(renderHistoryCard).join('')
    : '<p class="empty-state">No saved agents match that search.</p>';
}

function renderFilterTabs() {
  for (const button of historyFilterButtons) {
    const active = button.dataset.historyFilter === activeHistoryFilter;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
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
historyFilterTabs?.addEventListener('click', (event) => {
  const button = event.target?.closest?.('[data-history-filter]');
  const filter = button?.dataset?.historyFilter || 'all';
  if (!button || !HISTORY_FILTERS.has(filter)) return;
  activeHistoryFilter = filter;
  renderFilterTabs();
  renderRows();
});
historyList?.addEventListener('click', (event) => {
  const button = event.target?.closest?.('[data-unarchive-thread]');
  if (!button) return;
  void restoreArchivedThread(button.dataset.unarchiveThread, button);
});
if (doc) void initHistory();
