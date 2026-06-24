const BROWSER_SESSION_KEY = 'makerspaceBrowserSession';

const params = new URLSearchParams(location.search);
const name = params.get('name');
const apiFromUrl = params.get('api');

const modeToggle = document.querySelector('#mode-toggle');
const modeLabel = document.querySelector('#mode-label');
const title = document.querySelector('#thread-title');
const meta = document.querySelector('#thread-meta');
const statusNode = document.querySelector('#thread-status');
const debugGrid = document.querySelector('#thread-debug-grid');
const detailsPanel = document.querySelector('#thread-details');
const timeline = document.querySelector('#timeline');
const promptForm = document.querySelector('#prompt-form');
const promptInput = document.querySelector('#prompt');
const sendButton = document.querySelector('#send');
const thinkingTitle = document.querySelector('#thinking-title');
const thinkingDetail = document.querySelector('#thinking-detail');

let activeStream = null;
let currentThread = null;
let activeAssistantBody = null;
let lastEventId = 0;
let fallbackEventId = 0;
const seenEvents = new Set();
const toolNodes = new Map();

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function clamp(value, max = 1200) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

function getBrowserSessionId() {
  let sessionId = localStorage.getItem(BROWSER_SESSION_KEY) || '';
  if (!sessionId) {
    sessionId = globalThis.crypto?.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('-');
    localStorage.setItem(BROWSER_SESSION_KEY, sessionId);
  }
  return sessionId;
}

function detailsMode() {
  return localStorage.getItem('makerspaceThreadDetails') === 'open';
}

function setDetailsMode(enabled) {
  localStorage.setItem('makerspaceThreadDetails', enabled ? 'open' : 'collapsed');
  detailsPanel.hidden = !enabled;
  modeLabel.textContent = enabled ? 'hide details' : 'details';
  modeToggle.setAttribute('aria-pressed', String(enabled));
}

function getApiBase() {
  if (apiFromUrl) localStorage.setItem('makerspaceApiBase', apiFromUrl.replace(/\/+$/, ''));
  return (localStorage.getItem('makerspaceApiBase') || '').replace(/\/+$/, '');
}

function getApiToken() {
  return localStorage.getItem('makerspaceApiToken') || '';
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

function streamUrl(path, after = 0) {
  const url = new URL(apiUrl(path), location.origin);
  const token = getApiToken();
  if (token) url.searchParams.set('token', token);
  url.searchParams.set('browserSession', getBrowserSessionId());
  if (after) url.searchParams.set('after', String(after));
  return url.toString();
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

function effectiveStatus(thread) {
  const runStatus = String(thread?.runStatus || '').toLowerCase();
  return runStatus && runStatus !== 'unknown' ? thread.runStatus : thread?.status;
}

function statusTone(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'failed' || value === 'error') return 'error';
  if (value === 'completed' || value === 'ready') return 'success';
  if (['launching', 'running', 'queued', 'starting'].includes(value)) return 'warning';
  return 'info';
}

function lifecycleCopy(thread) {
  const status = String(effectiveStatus(thread) || 'unknown');
  if (status === 'ready') return 'ready';
  if (status === 'running') return 'working';
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (['launching', 'queued', 'starting'].includes(status)) return 'waking';
  return status;
}

function setStatus(text, tone = 'info') {
  statusNode.textContent = text;
  statusNode.dataset.tone = tone;
}

function debugCell(label, value) {
  return `<div class="fact"><span>${escapeHtml(label)}</span><code>${escapeHtml(value || '—')}</code></div>`;
}

function renderDebug(thread) {
  const commands = thread.commands || {};
  debugGrid.innerHTML = [
    debugCell('run', thread.runStatus),
    debugCell('provider', thread.provider),
    debugCell('repo', thread.repoUrl),
    debugCell('branch', thread.branch),
    debugCell('bridge', thread.bridgeUrl || thread.httpsUrl),
    debugCell('sandbox', thread.daytonaSandboxId || thread.daytonaSandboxName || thread.sandboxId),
    debugCell('connect', commands.connect),
    debugCell('tail', commands.tailLog),
  ].join('');
}

function renderThread(thread) {
  currentThread = thread;
  title.textContent = thread.name || name || 'thread';
  meta.textContent = `${thread.repoUrl || 'no repo'}${thread.branch ? ` · ${thread.branch}` : ''}`;
  const rawStatus = effectiveStatus(thread) || 'unknown';
  setStatus(lifecycleCopy(thread), statusTone(rawStatus));
  renderDebug(thread);
  sendButton.disabled = Boolean(thread.bridgeClaimed && rawStatus !== 'ready');
}

function formatTime(value) {
  if (!value) return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function eventKey(event) {
  if (event.id) return `id:${event.id}`;
  fallbackEventId += 1;
  return `fallback:${fallbackEventId}`;
}

function updateLastEventId(event) {
  const id = Number(event?.id);
  if (Number.isFinite(id) && id > lastEventId) lastEventId = id;
}

function activityCopy(event) {
  if (event.type === 'metric' && event.metric === 'first_llm_call_start') {
    const latency = Number.isFinite(Number(event.latencyMs)) ? ` ${Math.round(Number(event.latencyMs))}ms` : '';
    return ['Thinking', `LLM${latency}`];
  }

  if (event.type === 'tool') {
    const label = event.label || event.toolName || 'tool';
    if (event.phase === 'start') return [label, 'running'];
    if (event.phase === 'end') return [event.isError ? `${label} failed` : `${label} done`, event.isError ? 'error' : 'done'];
    return [label, 'output'];
  }

  if (event.type === 'status') {
    const status = event.runStatus || 'status';
    if (status === 'queued') return ['Queued', ''];
    if (status === 'starting') return ['Starting', ''];
    if (status === 'running') return ['Working', ''];
    if (status === 'completed') return ['Done', ''];
    if (status === 'failed') return ['Failed', event.warning || ''];
    return [status, event.warning || ''];
  }

  if (event.warning) return ['Warning', event.warning];
  if (event.chunk) return ['Answering', ''];
  return [event.type || 'Event', ''];
}

function setNow(event) {
  const [headline, detail] = activityCopy(event);
  thinkingTitle.textContent = headline;
  thinkingDetail.textContent = detail;
}

function appendTimelineItem(kind, titleText, detailText, timestamp) {
  const article = document.createElement('article');
  article.className = `timeline-item ${kind}`;
  article.innerHTML = `
    <div class="timeline-dot" aria-hidden="true"></div>
    <div class="timeline-card">
      <div class="timeline-meta"><span>${escapeHtml(formatTime(timestamp))}</span></div>
      <strong>${escapeHtml(titleText)}</strong>
      ${detailText ? `<p>${escapeHtml(detailText)}</p>` : ''}
    </div>
  `;
  timeline.append(article);
  timeline.scrollTop = timeline.scrollHeight;
  return article;
}

function appendMessage(role, label, text = '') {
  const article = document.createElement('article');
  article.className = `timeline-item message-item ${role}`;
  article.innerHTML = `
    <div class="timeline-dot" aria-hidden="true"></div>
    <div class="message-card">
      <div class="message-head"><strong>${escapeHtml(label)}</strong><span class="muted">${escapeHtml(formatTime())}</span></div>
      <pre class="message-body"></pre>
    </div>
  `;
  article.querySelector('.message-body').textContent = text;
  timeline.append(article);
  timeline.scrollTop = timeline.scrollHeight;
  return article.querySelector('.message-body');
}

function ensureAssistantBody() {
  if (!activeAssistantBody) activeAssistantBody = appendMessage('assistant', 'pi');
  return activeAssistantBody;
}

function looksLikeLegacySystemDump(text) {
  return text.length > 1000 && /\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s+\[system\]/.test(text);
}

function systemLines(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const messages = lines
    .filter((line) => /(?:^|\])\s*\[system\]/.test(line))
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').replace(/^\[system\]\s*/, ''));
  return messages.length === lines.length ? messages : [];
}

function appendSystemChunk(text, timestamp) {
  const messages = systemLines(text);
  if (!messages.length) return false;
  appendTimelineItem('status system-line', 'System', messages.join(' '), timestamp);
  return true;
}

function appendLegacyLog(text, timestamp) {
  const article = document.createElement('article');
  article.className = 'timeline-item tool-item legacy-log';
  article.innerHTML = `
    <div class="timeline-dot" aria-hidden="true"></div>
    <details class="tool-card">
      <summary>
        <span>log</span>
        <span class="badge">collapsed</span>
      </summary>
      <pre></pre>
    </details>
  `;
  article.querySelector('pre').textContent = clamp(text, 12000);
  timeline.append(article);
  timeline.scrollTop = timeline.scrollHeight;
  setNow({ type: 'status', runStatus: 'completed', timestamp });
}

function appendAssistantChunk(text, timestamp) {
  if (!text) return;
  if (looksLikeLegacySystemDump(text)) {
    appendLegacyLog(text, timestamp);
    return;
  }
  if (appendSystemChunk(text, timestamp)) return;
  const target = ensureAssistantBody();
  target.textContent += text;
  timeline.scrollTop = timeline.scrollHeight;
}

function toolKey(event) {
  return event.toolCallId || `${event.label || event.toolName || 'tool'}-${event.id || event.timestamp || toolNodes.size}`;
}

function renderToolEvent(event) {
  const key = toolKey(event);
  let node = toolNodes.get(key);

  if (!node) {
    const article = document.createElement('article');
    article.className = 'timeline-item tool-item';
    article.innerHTML = `
      <div class="timeline-dot" aria-hidden="true"></div>
      <details class="tool-card">
        <summary>
          <span>${escapeHtml(event.label || event.toolName || 'tool')}</span>
          <span class="badge">running</span>
        </summary>
        <pre></pre>
      </details>
    `;
    timeline.append(article);
    node = article.querySelector('.tool-card');
    toolNodes.set(key, node);
  }

  const badge = node.querySelector('.badge');
  badge.textContent = event.isError ? 'error' : event.phase === 'end' ? 'done' : 'running';
  node.dataset.phase = event.phase || '';
  node.open = event.phase !== 'end' && Boolean(event.delta || event.output);

  const output = event.delta || event.output || '';
  if (output) {
    const pre = node.querySelector('pre');
    pre.textContent = clamp(`${pre.textContent}${output}`, 8000);
  }

  timeline.scrollTop = timeline.scrollHeight;
}

function renderEvent(event, { appendTranscript = false } = {}) {
  if (!event) return;
  updateLastEventId(event);

  if (event.chunk) {
    setNow(event);
    if (appendTranscript) appendAssistantChunk(event.chunk, event.timestamp);
    if (event.session) renderThread(event.session);
    if (event.warning) setStatus(event.warning, 'error');
    return;
  }

  const key = eventKey(event);
  if (seenEvents.has(key)) return;
  seenEvents.add(key);
  setNow(event);

  if (event.type === 'tool') {
    renderToolEvent(event);
  } else {
    const [headline, detail] = activityCopy(event);
    appendTimelineItem(event.type || 'event', headline, detail, event.timestamp);
  }

  if (event.session) renderThread(event.session);
  if (event.warning) setStatus(event.warning, 'error');
}

async function loadThread() {
  if (!name) throw new Error('Missing thread name.');
  const payload = await fetchJson(`/api/threads/${encodeURIComponent(name)}`);
  renderThread(payload.thread);
  return payload.thread;
}

async function loadOutput() {
  const payload = await fetchJson(`/api/sessions/${encodeURIComponent(name)}/output`);
  if (Array.isArray(payload.events) && payload.events.length) {
    for (const event of payload.events) renderEvent(event, { appendTranscript: true });
  } else if (payload.chunk) {
    appendAssistantChunk(payload.chunk);
  }
  if (payload.session) renderThread(payload.session);
  return payload;
}

function streamRun() {
  if (activeStream) activeStream.close();
  activeStream = new EventSource(streamUrl(`/api/sessions/${encodeURIComponent(name)}/stream`, lastEventId));

  activeStream.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    renderEvent(payload, { appendTranscript: true });

    if (payload.done || payload.runStatus === 'completed' || payload.runStatus === 'failed') {
      activeStream.close();
      activeStream = null;
      const doneStatus = payload.runStatus === 'completed' ? 'completed' : 'failed';
      setStatus(doneStatus === 'completed' ? 'done' : 'failed', statusTone(doneStatus));
      sendButton.disabled = false;
      activeAssistantBody = null;
    }
  };

  activeStream.onerror = () => {
    activeStream.close();
    activeStream = null;
    sendButton.disabled = false;
    setStatus('disconnected', 'error');
    renderEvent({ type: 'status', runStatus: 'failed', warning: 'Disconnected', timestamp: new Date().toISOString() });
  };
}

getBrowserSessionId();
modeToggle.addEventListener('click', () => setDetailsMode(!detailsMode()));
setDetailsMode(detailsMode());

promptForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  appendMessage('user', 'you', prompt);
  activeAssistantBody = appendMessage('assistant', 'pi');
  promptInput.value = '';
  sendButton.disabled = true;
  renderEvent({ type: 'status', runStatus: 'queued', timestamp: new Date().toISOString() });

  try {
    const payload = await fetchJson(`/api/threads/${encodeURIComponent(name)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, submittedAtMs: Date.now(), clientId: getBrowserSessionId() }),
    });
    if (payload.session) renderThread(payload.session);
    streamRun();
  } catch (error) {
    renderEvent({ type: 'status', runStatus: 'failed', warning: error.message, timestamp: new Date().toISOString() });
    setStatus(error.message, 'error');
    sendButton.disabled = false;
  }
});

try {
  const thread = await loadThread();
  const output = await loadOutput();
  const status = output.runStatus || thread.runStatus;
  if (['launching', 'running', 'starting', 'queued'].includes(status)) streamRun();
  if (!timeline.children.length) appendTimelineItem('status', 'Ready', '', new Date().toISOString());
} catch (error) {
  renderEvent({ type: 'status', runStatus: 'failed', warning: error.message, timestamp: new Date().toISOString() });
  setStatus(error.message, 'error');
}
