import './appearance.js?v=palette-2';

import { redirectIfAuthRequired } from './auth-redirect.js';

const BROWSER_SESSION_KEY = 'spannerBrowserSession';
const API_BASE = String(import.meta.env?.VITE_SPANNER_API_BASE || '').trim().replace(/\/+$/, '');
const REFRESH_MS = 10_000;

const statusNode = document.querySelector('#control-board-status');
const statsNode = document.querySelector('#control-board-stats');
const signalsNode = document.querySelector('#control-board-signals');
const rowsNode = document.querySelector('#control-board-rows');
const countNode = document.querySelector('#control-board-count');
const activeNode = document.querySelector('#control-board-active-runs');
const activeCountNode = document.querySelector('#control-board-active-count');
const systemNode = document.querySelector('#control-board-system');
const configNode = document.querySelector('#control-board-config');
const refreshButton = document.querySelector('#refresh-control-board');

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

function authHeaders() {
  return { 'x-spanner-session': getBrowserSessionId() };
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function fetchJson(path) {
  const response = await fetch(apiUrl(path), { credentials: 'include', headers: authHeaders() });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text.trim() || `Request failed: ${response.status}`);
  }
  if (!response.ok) {
    if (redirectIfAuthRequired(payload, response)) return new Promise(() => {});
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0b';
  if (bytes < 1024) return `${Math.round(bytes)}b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)}kb`;
  return `${(bytes / 1024 / 1024).toFixed(1)}mb`;
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${Math.round(value / 1000)}s`;
  if (value < 60 * 60_000) return `${Math.round(value / 60_000)}m`;
  return `${Math.round(value / 60 / 60_000)}h`;
}

function relativeTime(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '—';
  const delta = Date.now() - timestamp;
  if (delta < 0) return 'now';
  if (delta < 60_000) return `${Math.max(1, Math.round(delta / 1000))}s ago`;
  if (delta < 60 * 60_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 24 * 60 * 60_000) return `${Math.round(delta / 60 / 60_000)}h ago`;
  return `${Math.round(delta / 24 / 60 / 60_000)}d ago`;
}

function statusBadge(status) {
  const normalized = String(status || 'unknown').toLowerCase();
  return `<span class="badge ${escapeHtml(normalized)}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(normalized)}</span>`;
}

function stat(label, value) {
  return `<div class="performance-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderStats(summary = {}, provider = {}) {
  statsNode.innerHTML = [
    stat('sessions', summary.totalSessions ?? 0),
    stat('running', summary.runningSessions ?? 0),
    stat('active runs', summary.activeRuns ?? 0),
    stat('streams', summary.sseSubscribers ?? 0),
    stat('ready bridges', summary.readyBridges ?? 0),
    stat('warm bridges', summary.warmBridges ?? 0),
    stat('warnings', summary.warningSessions ?? 0),
    stat('provider', provider.kind || 'unknown'),
  ].join('');
}

function renderSignals(signals = []) {
  signalsNode.innerHTML = signals.length
    ? signals.map((signal) => `<li>${escapeHtml(signal)}</li>`).join('')
    : '<li>No signals yet.</li>';
}

function detailBits(session = {}) {
  const bits = [];
  if (session.eventCount) bits.push(`${session.eventCount} events`);
  if (session.outputBytes) bits.push(formatBytes(session.outputBytes));
  if (session.subscriberCount) bits.push(`${session.subscriberCount} stream${session.subscriberCount === 1 ? '' : 's'}`);
  if (session.trackedChangeCount) bits.push(`${session.trackedChangeCount} changed file${session.trackedChangeCount === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

function bridgeBits(session = {}) {
  const bridge = session.bridge || {};
  const bits = [];
  if (bridge.mode) bits.push(bridge.claimed ? 'claimed' : 'idle');
  if (bridge.warm) bits.push('warm');
  if (bridge.intent) bits.push('intent');
  if (bridge.workspace) bits.push('workspace');
  if (bridge.warmClaimed) bits.push('warm-claimed');
  if (bridge.workspaceSessionName) bits.push(`workspace ${bridge.workspaceSessionName}`);
  if (bridge.mode && !bridge.hasUrl) bits.push('no url');
  return bits.join(' · ') || '—';
}

function threadHref(session = {}) {
  if (!session.threadBridge) return '';
  const url = new URL('/thread.html', location.origin);
  url.searchParams.set('name', session.name);
  return `${url.pathname}${url.search}`;
}

function renderRows(sessions = []) {
  const rows = [...sessions].sort((left, right) => {
    const active = Number(Boolean(right.activeRun)) - Number(Boolean(left.activeRun));
    if (active) return active;
    return String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || ''));
  });
  countNode.textContent = `${rows.length} thing${rows.length === 1 ? '' : 's'} shown`;
  rowsNode.innerHTML = rows.map((session) => {
    const href = threadHref(session);
    const title = escapeHtml(session.title || session.name);
    const thing = href
      ? `<a href="${escapeHtml(href)}"><strong>${title}</strong><small>${escapeHtml(session.repo || session.name || '')}</small></a>`
      : `<strong>${title}</strong><small>${escapeHtml(session.repo || session.name || '')}</small>`;
    const activity = [session.warning, session.latestActivity, session.lastEvent?.label, detailBits(session)].filter(Boolean).join(' · ');
    return `
      <tr>
        <td>${thing}</td>
        <td>${statusBadge(session.runStatus || session.status)}</td>
        <td>${escapeHtml(session.kind || 'session')}</td>
        <td>${escapeHtml(activity || '—')}</td>
        <td>${escapeHtml(bridgeBits(session))}</td>
        <td>${escapeHtml(relativeTime(session.updatedAt || session.createdAt))}<small>${escapeHtml(session.ownerUserId ? `owner ${session.ownerUserId}` : session.source || '')}</small></td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6">Nothing running yet.</td></tr>';
}

function renderActiveRuns(activeRuns = []) {
  activeCountNode.textContent = `${activeRuns.length} active run state${activeRuns.length === 1 ? '' : 's'}`;
  activeNode.innerHTML = activeRuns.map((run) => {
    const details = [
      run.latestActivity,
      run.lastEvent?.label,
      `${run.eventCount || 0} events`,
      formatBytes(run.outputBytes),
      run.subscriberCount ? `${run.subscriberCount} streams` : '',
      run.bridgeFollowing ? 'bridge follower on' : '',
      run.warning,
    ].filter(Boolean).join(' · ');
    return `<article class="control-board-run-card"><strong>${escapeHtml(run.name)}</strong><div>${statusBadge(run.runStatus)}</div><p class="muted mb-0 mt-2">${escapeHtml(details || 'No live detail yet.')}</p></article>`;
  }).join('') || '<p class="muted">No in-memory active runs right now.</p>';
}

function kvRow(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderSystem(payload = {}) {
  const processInfo = payload.process || {};
  const provider = payload.provider || {};
  systemNode.innerHTML = [
    kvRow('pid', processInfo.pid || '—'),
    kvRow('uptime', formatDuration(processInfo.uptimeMs)),
    kvRow('node', processInfo.nodeVersion || '—'),
    kvRow('platform', [processInfo.platform, processInfo.arch].filter(Boolean).join(' / ') || '—'),
    kvRow('memory', `${formatBytes(processInfo.memoryRssBytes)} rss · ${formatBytes(processInfo.heapUsedBytes)} heap`),
    kvRow('transport', provider.transport || provider.kind || '—'),
    kvRow('ready', provider.ready === false ? 'no' : 'yes'),
  ].join('');
}

function renderConfig(config = {}) {
  const cloudflare = config.cloudflare || {};
  const storage = config.storage || {};
  configNode.innerHTML = [
    kvRow('project', config.projectName || 'spanner'),
    kvRow('provider', config.provider || '—'),
    kvRow('auth', config.authRequired ? 'required' : 'single-user/local'),
    kvRow('workspace mode', config.workspaceMode ? 'on' : 'off'),
    kvRow('host dispatch', config.hostDispatchEnabled ? 'on' : 'off'),
    kvRow('bridge port', config.bridgePort || '—'),
    kvRow('warm pool', config.warmBridgePoolSize || 0),
    kvRow('idle ttl', formatDuration(config.idleBridgeTtlMs)),
    kvRow('thread idle ttl', formatDuration(config.threadBridgeIdleTtlMs)),
    kvRow('cf broker', cloudflare.brokerConfigured ? 'configured' : 'missing'),
    kvRow('cf machine', cloudflare.machine || '—'),
    kvRow('session store', storage.sessionFile || config.stateStore || '—'),
  ].join('');
}

async function loadControlBoard(options = {}) {
  if (!options.silent) statusNode.textContent = 'Loading everything Spanner is running…';
  const payload = await fetchJson('/api/control-board');
  renderStats(payload.summary, payload.provider);
  renderSignals(payload.signals);
  renderRows(payload.sessions);
  renderActiveRuns(payload.activeRuns);
  renderSystem(payload);
  renderConfig(payload.config);
  statusNode.textContent = `Updated ${new Date(payload.generatedAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  try {
    await loadControlBoard();
  } catch (error) {
    statusNode.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
});

try {
  await loadControlBoard();
} catch (error) {
  statusNode.textContent = error.message;
}

setInterval(() => {
  if (document.visibilityState === 'visible') void loadControlBoard({ silent: true }).catch(() => {});
}, REFRESH_MS);
