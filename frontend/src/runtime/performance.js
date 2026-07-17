import './appearance.js?v=palette-2';

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

const isLocalTelemetry = location.pathname.includes('local-telemetry') || new URLSearchParams(location.search).get('source') === 'local';

const statusNode = document.querySelector('#performance-status');
const statsNode = document.querySelector('#performance-stats');
const insightsNode = document.querySelector('#performance-insights');
const rowsNode = document.querySelector('#performance-rows');
const countNode = document.querySelector('#performance-count');
const sourcesNode = document.querySelector('#telemetry-sources');
const refreshButton = document.querySelector('#refresh-performance');

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

async function fetchJson(path) {
  const response = await fetch(apiUrl(path), { credentials: 'include', headers: authHeaders() });
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
  const url = new URL('/thread.html', location.origin);
  url.searchParams.set('name', name);
  return `${url.pathname}${url.search}`;
}

function formatMs(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value / 60_000)}m`;
}

function stat(label, value) {
  return `<div class="performance-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function formatCount(value) {
  return Number.isFinite(value) ? String(value) : '—';
}

function formatTokens(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
}

function formatCost(value) {
  return Number.isFinite(value) && value > 0 ? `$${value.toFixed(3)}` : '';
}

function formatPct(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : '—';
}

function formatPairs(pairs = []) {
  return pairs.length ? pairs.map(([label, count]) => `${label}×${count}`).join(', ') : '—';
}

function metricsLabel(source) {
  if (source === 'trace') return 'trace metrics';
  if (source === 'live') return 'live metrics';
  if (source === 'stored') return 'stored metrics';
  return 'latency only';
}

function renderStats(summary = {}) {
  statsNode.innerHTML = [
    stat('main agents', summary.totalThreads ?? 0),
    stat('last 24h', summary.recent24hThreads ?? 0),
    stat('last 7d', summary.recent7dThreads ?? 0),
    stat('running', summary.runningThreads ?? 0),
    stat('done', summary.completedThreads ?? 0),
    stat('failed', summary.failedThreads ?? 0),
    stat('success', formatPct(summary.successRatePct)),
    stat('measured', formatPct(summary.detailedMetricPct)),
    stat('traces', `${summary.traceAnalyzedThreads ?? 0} / ${formatPct(summary.traceCoveragePct)}`),
    stat('review score', formatCount(summary.totalReviewScore)),
    stat('median first llm', formatMs(summary.medianFirstLlmMs)),
    stat('p95 first llm', formatMs(summary.p95FirstLlmMs)),
    stat('median duration', formatMs(summary.medianDurationMs)),
    stat('tool calls', formatCount(summary.totalToolCalls)),
    stat('tool errors', formatCount(summary.totalToolErrors)),
    stat('tokens', formatTokens(summary.totalTokens)),
    stat('cache read', formatTokens(summary.totalCacheReadTokens)),
    stat('cache bust', formatTokens(summary.totalCacheWriteTokens)),
  ].join('');
}

function renderInsights(insights = []) {
  insightsNode.innerHTML = insights.length
    ? insights.map((insight) => `<li>${escapeHtml(insight)}</li>`).join('')
    : '<li>No obvious hotspots yet.</li>';
}

function renderSources(summary = {}, source = {}) {
  if (!sourcesNode) return;
  sourcesNode.innerHTML = [
    source.label ? `Reading: ${source.path ? `${source.label} at ${source.path}` : source.label}.` : '',
    `Runs, repos, status, archive state, and recency from stored sessions.`,
    `Latency, duration, tool calls/errors, output bytes, warnings, and top tools from run rollups when measured.`,
    `Tokens, cache reads/writes, model calls, and cost only when the provider emits usage.`,
    `Trace coverage: ${summary.traceAnalyzedThreads || 0} analyzed, ${formatTokens(summary.totalTraceEntries)} entries.`,
    `Signal mix: ${formatPairs(summary.topSignalKinds)}.`,
    `Review queue: ${(summary.reviewQueue || []).map((item) => `${item.title} (${item.score})`).join(', ') || '—'}.`,
    `Top repos: ${formatPairs(summary.topRepos)}.`,
    `Top tools: ${formatPairs(summary.topTools)}.`,
    `Models: ${formatPairs(summary.topModels)}.`,
    `Not in the DB: page views, clicks, abandoned prompts, and exact historical token costs before usage rollups existed.`,
  ].filter(Boolean).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function renderRows(threads = []) {
  countNode.textContent = `${threads.length} main agents shown`;
  rowsNode.innerHTML = threads.map((thread) => {
    const flags = [...(thread.flags || []), metricsLabel(thread.metricsSource)];
    const topTools = (thread.topTools || []).map(([name, count]) => `${name}×${count}`).join(', ');
    const tools = Number.isFinite(thread.toolCalls)
      ? `${thread.toolCalls}${thread.toolErrors ? ` / ${thread.toolErrors} errors` : ''}`
      : '—';
    const tokenBits = [
      Number.isFinite(thread.inputTokens) ? `↑${formatTokens(thread.inputTokens)}` : '',
      Number.isFinite(thread.outputTokens) ? `↓${formatTokens(thread.outputTokens)}` : '',
      Number.isFinite(thread.modelCalls) ? `${thread.modelCalls} calls` : '',
      formatCost(thread.costUsd),
    ].filter(Boolean).join(' · ');
    const cache = Number.isFinite(thread.cacheReadTokens) || Number.isFinite(thread.cacheWriteTokens)
      ? `read ${formatTokens(thread.cacheReadTokens || 0)} / bust ${formatTokens(thread.cacheWriteTokens || 0)}`
      : '—';
    const signalText = (thread.analysisSignals || []).slice(0, 3).join(', ');
    const analysis = Number.isFinite(thread.analysisScore)
      ? `score ${thread.analysisScore}${Number.isFinite(thread.traceEntryCount) ? ` · ${formatTokens(thread.traceEntryCount)} entries` : ''}`
      : '—';
    return `
      <tr>
        <td><a href="${escapeHtml(threadUrl(thread.name))}"><strong>${escapeHtml(thread.title || thread.name)}</strong><small>${escapeHtml(thread.repo)}${thread.branch ? ` · ${escapeHtml(thread.branch)}` : ''}</small></a></td>
        <td><span class="badge ${escapeHtml(thread.status)}">${escapeHtml(thread.status)}</span></td>
        <td>${escapeHtml(formatMs(thread.firstLlmLatencyMs))}</td>
        <td>${escapeHtml(formatMs(thread.durationMs))}</td>
        <td>${escapeHtml(tools)}${topTools ? `<small>${escapeHtml(topTools)}</small>` : ''}</td>
        <td>${escapeHtml(formatTokens(thread.totalTokens))}${tokenBits ? `<small>${escapeHtml(tokenBits)}</small>` : ''}</td>
        <td>${escapeHtml(cache)}</td>
        <td>${escapeHtml(analysis)}${signalText ? `<small>${escapeHtml(signalText)}</small>` : ''}</td>
        <td>${escapeHtml(flags.join(', '))}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="9">No main agents yet.</td></tr>';
}

async function loadPerformance() {
  statusNode.textContent = `Loading ${isLocalTelemetry ? 'local session' : 'DB-derived'} telemetry…`;
  const payload = await fetchJson(`/api/threads/performance${isLocalTelemetry ? '?source=local' : ''}`);
  const performance = payload.performance || {};
  renderStats(performance.summary);
  renderInsights(performance.insights);
  renderSources(performance.summary, performance.source);
  renderRows(performance.threads);
  statusNode.textContent = `Updated ${new Date(payload.generatedAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  try {
    await loadPerformance();
  } catch (error) {
    statusNode.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
});

try {
  await loadPerformance();
} catch (error) {
  statusNode.textContent = error.message;
}
