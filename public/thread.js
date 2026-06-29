import './appearance.js?v=palette-2';
import { htmlPreviewDocument } from './html-preview.js';
import { submitOnEnter } from './submit-on-enter.js';
import { bindImageDropZone, clearImageInput, filesToImageAttachments, imageAttachmentText, imageInputFiles, updateImageStatus } from './image-attachments.js';
import { implementationNoteFromToolEvent, implementationNotesFromToolEvent } from './implementation-notes.js';
import { excalidrawArtifactPaths } from './excalidraw-artifacts.js';

const BROWSER_SESSION_KEY = 'makerspaceBrowserSession';
const MODEL_REF_KEY = 'makerspaceModelRef';
const THINKING_LEVEL_KEY = 'makerspaceThinkingLevel';
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const ARCHIVEABLE_THREAD_STATUSES = ['completed', 'ready', 'failed'];

const params = new URLSearchParams(location.search);
const name = params.get('name');
const apiFromUrl = params.get('api');
const tokenFromUrl = params.get('token');
if (tokenFromUrl) {
  localStorage.setItem('makerspaceApiToken', tokenFromUrl);
  params.delete('token');
  const nextSearch = params.toString();
  history.replaceState(null, '', `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}${location.hash}`);
}

const projectLabel = document.querySelector('#project-label');
const title = document.querySelector('#thread-title');
const meta = document.querySelector('#thread-meta');
const statusNode = document.querySelector('#thread-status');
const archiveButton = document.querySelector('#archive-thread');
const timeline = document.querySelector('#timeline');
const traceTimeline = document.querySelector('#trace-timeline');
const agentRail = document.querySelector('#agent-rail');
const agentActivity = document.querySelector('#agent-trace');
const agentActivityClose = document.querySelector('#agent-activity-close');
const agentGraph = document.querySelector('#agent-graph');
const agentGraphCount = document.querySelector('#agent-graph-count');
const activityNote = document.querySelector('#activity-note');
const notesList = document.querySelector('#notes-list');
const notesCount = document.querySelector('#notes-count');
const promptForm = document.querySelector('#prompt-form');
const promptInput = document.querySelector('#prompt');
const modelRefInput = document.querySelector('#model-ref');
const thinkingLevelInput = document.querySelector('#thinking-level');
const thinkingLevelOutput = document.querySelector('#thinking-level-value');
const imageInput = document.querySelector('#prompt-images');
const imageStatus = document.querySelector('#image-status');
const sendButton = document.querySelector('#send');
const thinkingTitle = document.querySelector('#thinking-title');
const thinkingDetail = document.querySelector('#thinking-detail');
const diffBox = document.querySelector('#diff-box');
const diffCount = document.querySelector('#diff-count');
const diffFiles = document.querySelector('#diff-files');
const diffEditor = document.querySelector('#diff-editor');

let activeStream = null;
let currentThread = null;
let activeAssistantBody = null;
let defaultThinkingLevel = 'xhigh';
let currentProjectName = '';
let runControlsLoaded = false;
let lastEventId = 0;
let fallbackEventId = 0;
const seenEvents = new Set();
const graphTools = new Map();
const toolCards = new Map();
const thinkingCards = new Map();
const notesByPath = new Map();
const messageText = new WeakMap();
const runSummaryMarkers = new Map();
const renderedMessageKeys = new Set();
const renderedAssistantRunIds = new Set();
let activeRunSummaryMarker = null;
let runStartedAtMs = 0;
let runEndedAtMs = 0;
let runSummaryStatus = '';
let runSummaryTimer = null;
let initialPromptRendered = false;
let historyRendered = false;
let graphStatus = 'waiting';
let selectedDiffPath = '';
let diffRefreshTimer = null;
let diffBoxOpenedOnce = false;
let assistantChunkBuffer = '';
let assistantChunkFrame = 0;
let assistantChunkShouldFollow = false;

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

function isAgentActivityOpen() {
  return Boolean(agentActivity?.classList.contains('is-open'));
}

function placeAgentActivityInline(anchor = null) {
  if (!agentActivity || !timeline) return;
  const fallback = activeRunSummaryMarker?.button?.closest?.('.run-summary-item');
  const target = anchor || fallback;
  if (target?.parentNode === timeline) target.after(agentActivity);
}

function setAgentActivityOpen(open = true, anchor = null) {
  if (!agentActivity || !agentRail) return;
  if (open) placeAgentActivityInline(anchor);
  agentActivity.hidden = !open;
  agentActivity.classList.toggle('is-open', open);
  agentActivity.setAttribute('aria-hidden', String(!open));
  agentActivity.inert = !open;
  agentRail.classList.toggle('is-open', open);
  agentRail.setAttribute('aria-expanded', String(open));
  syncRunSummaryExpanded(open);
  if (open) followTraceLatest(true);
}

function toggleAgentActivity(anchor = null) {
  setAgentActivityOpen(!isAgentActivityOpen(), anchor);
}

function syncRunSummaryExpanded(open) {
  document.querySelectorAll('.run-summary').forEach((button) => button.setAttribute('aria-expanded', String(open)));
}

function getApiBase() {
  if (apiFromUrl) localStorage.setItem('makerspaceApiBase', apiFromUrl.replace(/\/+$/, ''));
  return (localStorage.getItem('makerspaceApiBase') || '').replace(/\/+$/, '');
}

function getApiToken() {
  return localStorage.getItem('makerspaceApiToken') || '';
}

function thinkingLevelValue() {
  return THINKING_LEVELS[Number(thinkingLevelInput.value)] || '';
}

function renderThinkingLevel() {
  const level = thinkingLevelValue();
  const label = level || defaultThinkingLevel || 'xhigh';
  const title = `Thinking: ${label}`;
  thinkingLevelOutput.textContent = label;
  thinkingLevelOutput.title = title;
  thinkingLevelInput.title = title;
  thinkingLevelInput.setAttribute('aria-valuetext', label);
}

function setThinkingLevel(value) {
  const level = String(value || 'xhigh').trim().toLowerCase();
  thinkingLevelInput.value = String(Math.max(0, THINKING_LEVELS.indexOf(level)));
  renderThinkingLevel();
}

function ensureModelOption(value) {
  const text = String(value || '').trim();
  if (!text || Array.from(modelRefInput.options).some((option) => option.value === text)) return;
  const option = document.createElement('option');
  option.value = text;
  option.textContent = text;
  modelRefInput.append(option);
}

function setModelRef(value) {
  const text = String(value || '').trim();
  ensureModelOption(text);
  modelRefInput.value = text;
}

function saveRunControls() {
  localStorage.setItem(MODEL_REF_KEY, modelRefInput.value.trim());
  localStorage.setItem(THINKING_LEVEL_KEY, thinkingLevelValue());
}

function loadRunControls(thread = {}) {
  if (runControlsLoaded) return;
  setModelRef(localStorage.getItem(MODEL_REF_KEY) ?? thread.modelRef ?? '');
  setThinkingLevel(localStorage.getItem(THINKING_LEVEL_KEY) ?? thread.thinkingLevel ?? '');
  runControlsLoaded = true;
}

function renderModelOptions(model, options = []) {
  const modelLabel = model === 'Pi default model' ? 'main agent model' : model;
  const selected = localStorage.getItem(MODEL_REF_KEY) || modelRefInput.value || '';
  const selectedValue = selected === model || selected === 'Pi default model' ? '' : selected;
  const values = [];
  const seen = new Set();
  for (const value of [...(Array.isArray(options) ? options : []), selectedValue]) {
    const text = String(value || '').trim();
    if (!text || text === model || text === modelLabel || text === 'Pi default model' || seen.has(text)) continue;
    seen.add(text);
    values.push(text);
  }

  modelRefInput.innerHTML = `<option value="">${escapeHtml(modelLabel)}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  setModelRef(selectedValue);
  modelRefInput.title = values.length
    ? `Model: ${modelLabel}\nOptions: ${values.join(', ')}`
    : `Model: ${modelLabel}`;
}

function renderPiDefaults(defaults = {}) {
  const model = String(defaults.model || defaults.agent || 'main agent model').trim();
  defaultThinkingLevel = String(defaults.thinking || 'xhigh').trim();
  renderModelOptions(model, defaults.models);
  renderThinkingLevel();
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

function excalidrawViewerUrl(artifactPath) {
  const url = new URL('/excalidraw-viewer.html', location.origin);
  url.searchParams.set('thread', name || '');
  url.searchParams.set('path', artifactPath);
  url.searchParams.set('theme', currentPreviewTheme());
  const apiBase = getApiBase();
  if (apiBase) url.searchParams.set('api', apiBase);
  return url.toString();
}

function renderExcalidrawArtifacts(node, text) {
  node.querySelector('.excalidraw-artifacts')?.remove();
  if (!name || !node.closest('.message-item.assistant')) return;

  const paths = excalidrawArtifactPaths(text);
  if (!paths.length) return;

  const section = document.createElement('section');
  section.className = 'excalidraw-artifacts';
  section.setAttribute('aria-label', 'Excalidraw drawings');

  for (const artifactPath of paths) {
    const card = document.createElement('article');
    card.className = 'excalidraw-card';

    const head = document.createElement('div');
    head.className = 'excalidraw-card-head';
    const title = document.createElement('strong');
    title.textContent = artifactPath.split('/').at(-1) || artifactPath;
    const link = document.createElement('a');
    link.href = excalidrawViewerUrl(artifactPath);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'open';
    head.append(title, link);

    const frame = document.createElement('iframe');
    frame.className = 'excalidraw-inline-viewer';
    frame.title = `Excalidraw preview: ${artifactPath}`;
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.src = excalidrawViewerUrl(artifactPath);

    card.append(head, frame);
    section.append(card);
  }

  node.append(section);
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

function isActiveStatus(status) {
  return ['launching', 'running', 'queued', 'starting', 'reconnecting'].includes(String(status || '').toLowerCase());
}

function statusTone(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'failed' || value === 'error') return 'error';
  if (value === 'completed' || value === 'ready') return 'success';
  if (isActiveStatus(value)) return 'warning';
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

function canArchiveThread(thread) {
  const status = String(effectiveStatus(thread) || '').toLowerCase();
  return ARCHIVEABLE_THREAD_STATUSES.includes(status) && !thread?.archivedAt;
}

function syncHeaderStatusVisibility() {
  statusNode.hidden = statusNode.textContent === 'done' && Boolean(archiveButton && !archiveButton.hidden);
}

function renderArchiveButton(thread = currentThread) {
  if (!archiveButton) return;
  archiveButton.hidden = !canArchiveThread(thread);
  archiveButton.disabled = false;
  archiveButton.textContent = 'mark as done';
  syncHeaderStatusVisibility();
}

function threadDisplayTitle(thread = currentThread) {
  return thread?.title || thread?.name || name || 'main agent';
}

function setStatus(text, tone = 'info', active = false) {
  statusNode.textContent = text;
  statusNode.dataset.tone = tone;
  statusNode.dataset.active = String(active);
  syncHeaderStatusVisibility();
}

function renderProject(provider) {
  const project = provider?.project || {};
  const name = String(project.name || '').trim();
  const visible = name && name !== 'makerspace';
  currentProjectName = visible ? name : '';
  if (!projectLabel) return;
  projectLabel.hidden = !visible;
  projectLabel.textContent = visible ? name : '';
  projectLabel.title = project.home ? `Project state: ${project.home}` : `Project: ${name}`;
}

function renderThread(thread) {
  currentThread = thread;
  syncRunTiming(thread);
  const displayTitle = threadDisplayTitle(thread);
  title.textContent = displayTitle;
  thinkingTitle.textContent = displayTitle;
  document.title = currentProjectName ? `${displayTitle} · ${currentProjectName} · Makerspace` : `${displayTitle} · Makerspace`;
  meta.textContent = '';
  const rawStatus = effectiveStatus(thread) || 'unknown';
  graphStatus = lifecycleCopy(thread);
  if (!thinkingDetail.textContent) thinkingDetail.textContent = graphStatus;
  setStatus(graphStatus, statusTone(rawStatus), isActiveStatus(rawStatus));
  renderArchiveButton(thread);
  renderAgentGraph();
  sendButton.disabled = Boolean(thread.bridgeClaimed && rawStatus !== 'ready');
}

function timestampMs(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatElapsedMinutes(ms) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (seconds < 60) return '<1 min';
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function runSummaryCopy(startMs, endMs = 0, status = '') {
  if (!startMs) return 'working';
  const active = isActiveStatus(status) && !endMs;
  return `${active ? 'working' : 'worked'} for ${formatElapsedMinutes((endMs || Date.now()) - startMs)}`;
}

function updateRunSummaryMarker(marker) {
  if (!marker?.button) return;
  marker.button.textContent = runSummaryCopy(marker.startMs, marker.endMs, marker.status);
}

function appendRunSummaryMarker({ startMs = 0, endMs = 0, status = '', runId = '' } = {}) {
  if (!timeline || !startMs) return null;
  const follow = shouldFollowLatest();
  const article = document.createElement('article');
  article.className = 'timeline-item run-summary-item';
  article.innerHTML = `
    <div class="timeline-dot" aria-hidden="true"></div>
    <div class="run-summary-card">
      <button class="run-summary muted" type="button" aria-controls="agent-trace" aria-expanded="${isAgentActivityOpen()}" title="show full trace"></button>
    </div>
  `;
  const button = article.querySelector('.run-summary');
  const marker = { button, startMs, endMs, status, runId: String(runId || '') };
  button.addEventListener('click', () => toggleAgentActivity(article));
  updateRunSummaryMarker(marker);
  timeline.append(article);
  if (marker.runId) runSummaryMarkers.set(marker.runId, marker);
  followLatest(follow);
  return marker;
}

function renderRunSummary() {
  updateRunSummaryMarker(activeRunSummaryMarker);
}

function syncRunTiming(source = {}) {
  const status = String(source.runStatus || effectiveStatus(currentThread) || '').toLowerCase();
  const runId = currentRunId(source) || currentRunId(currentThread);
  if (status) runSummaryStatus = status;
  const start = timestampMs(source.submittedAtMs) || timestampMs(currentThread?.submittedAtMs);
  if (start && start !== runStartedAtMs) {
    runStartedAtMs = start;
    runEndedAtMs = 0;
    activeRunSummaryMarker = runSummaryMarkers.get(runId) || activeRunSummaryMarker;
  }
  const storedEnd = timestampMs(source.runEndedAtMs) || timestampMs(currentThread?.runEndedAtMs) || timestampMs(currentThread?.endedAt) || timestampMs(currentThread?.completedAt);
  if (storedEnd && (!runStartedAtMs || storedEnd >= runStartedAtMs)) runEndedAtMs = storedEnd;
  if (!runStartedAtMs && (isActiveStatus(status) || status === 'completed' || status === 'failed' || source.done)) {
    runStartedAtMs = timestampMs(source.timestamp) || Date.now();
  }
  if (status === 'completed' || status === 'failed' || source.done) {
    runEndedAtMs = storedEnd || timestampMs(source.timestamp) || runEndedAtMs || Date.now();
  }
  if (!activeRunSummaryMarker && runId) activeRunSummaryMarker = runSummaryMarkers.get(runId) || null;
  if (activeRunSummaryMarker) {
    activeRunSummaryMarker.startMs = runStartedAtMs || activeRunSummaryMarker.startMs || start;
    activeRunSummaryMarker.endMs = runEndedAtMs;
    activeRunSummaryMarker.status = status || runSummaryStatus;
    if (runId) {
      activeRunSummaryMarker.runId = runId;
      runSummaryMarkers.set(runId, activeRunSummaryMarker);
    }
  }
  renderRunSummary();
  clearInterval(runSummaryTimer);
  runSummaryTimer = activeRunSummaryMarker && runStartedAtMs && !runEndedAtMs && isActiveStatus(status) ? setInterval(renderRunSummary, 1000) : null;
}

function shouldFollowLatest() {
  const page = document.documentElement;
  return window.scrollY + window.innerHeight >= page.scrollHeight - 180;
}

function followLatest(enabled = true) {
  if (!enabled) return;
  requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' }));
}

function shouldFollowTrace() {
  if (!isAgentActivityOpen() || !agentActivity) return false;
  return agentActivity.getBoundingClientRect().bottom <= window.innerHeight + 180;
}

function followTraceLatest(enabled = true) {
  if (!enabled || !agentActivity) return;
  requestAnimationFrame(() => (traceTimeline.lastElementChild || agentActivity).scrollIntoView({ block: 'nearest', behavior: 'auto' }));
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

function compactToolTarget(value) {
  if (Array.isArray(value)) {
    const parts = value.map(compactToolTarget).filter(Boolean);
    if (!parts.length) return '';
    return `${parts.slice(0, 2).join(', ')}${parts.length > 2 ? ` +${parts.length - 2}` : ''}`;
  }
  if (value && typeof value === 'object') return '';
  return clamp(String(value || '').replace(/\s+/g, ' ').trim(), 180);
}

function firstToolTarget(args, keys) {
  for (const key of keys) {
    const target = compactToolTarget(args[key]);
    if (target) return target;
  }
  return '';
}

function toolTarget(event = {}) {
  const args = event.args && typeof event.args === 'object' ? event.args : {};
  const toolName = String(event.toolName || '').toLowerCase().split('.').pop();
  const fileTarget = firstToolTarget(args, ['path', 'file_path', 'file', 'filename']);
  if (fileTarget) return fileTarget;
  if (toolName.includes('grep')) return firstToolTarget(args, ['constraints', 'glob']) || 'workspace';
  if (toolName === 'fetch_content') return firstToolTarget(args, ['url', 'urls']);
  if (['find_files', 'web_search', 'code_search'].includes(toolName)) return firstToolTarget(args, ['query']);
  return firstToolTarget(args, ['url', 'urls']);
}

function toolAction(event = {}, target = toolTarget(event)) {
  const hasArgs = event.args && typeof event.args === 'object';
  const args = hasArgs ? event.args : {};
  const toolName = String(event.toolName || '').toLowerCase().split('.').pop();
  const firstLine = (value) => compactToolTarget(String(value || '').split(/\r?\n/)[0]);
  const withTarget = (verb, fallback) => (target ? `${verb} ${target}` : hasArgs ? fallback : '');

  if (toolName === 'bash') return args.command ? `running ${firstLine(args.command)}` : '';
  if (toolName === 'read') return withTarget('reading', 'reading file');
  if (toolName === 'edit') return withTarget('editing', 'editing file');
  if (toolName === 'write') return withTarget('writing', 'writing file');
  if (toolName?.includes('grep')) return withTarget('searching', 'searching workspace');
  if (toolName === 'find_files') return withTarget('finding files for', 'finding files');
  if (toolName === 'web_search') return withTarget('searching web for', 'searching web');
  if (toolName === 'code_search') return withTarget('searching code for', 'searching code');
  if (toolName === 'fetch_content') return withTarget('fetching', 'fetching content');
  if (toolName === 'todo') return 'updating tasks';
  if (toolName === 'workflow') return 'running workflow';
  if (toolName === 'ask_user_question') return 'asking a question';
  return target ? `using ${target}` : '';
}

function toolDisplay(event = {}) {
  const args = event.args && typeof event.args === 'object' ? event.args : {};
  const rawLabel = event.label || event.toolName || 'tool';
  const kind = /workflow/i.test(`${event.toolName || ''} ${rawLabel}`) ? 'workflow' : /agent/i.test(rawLabel) ? 'subagent' : 'tool';
  const scriptName = String(args.script || '').match(/\bname:\s*['"`]([^'"`]+)['"`]/)?.[1];
  const runId = String([event.output, event.delta, rawLabel].filter(Boolean).join(' ')).match(/\brun-[a-z0-9-]+\b/i)?.[0] || '';
  const target = toolTarget(event);
  return {
    kind,
    label: kind === 'workflow' ? String(scriptName || args.name || 'workflow') : String(rawLabel),
    runId,
    target,
    action: toolAction(event, target),
  };
}

function activityCopy(event) {
  if (event.type === 'log') return ['Working', ''];

  if (event.type === 'metric' && event.metric === 'first_llm_call_start') return ['Working', 'thinking'];

  if (event.type === 'thinking') return ['Working', 'thinking'];

  if (event.type === 'workflow_status') {
    const detail = event.message || (event.phase === 'waiting' ? 'waiting for workflow result' : 'workflow update');
    return ['Workflow', detail];
  }

  if (event.type === 'workflow_result') return ['Workflow complete', 'continuation picked up'];

  if (event.type === 'tool') {
    const note = implementationNoteFromToolEvent(event);
    if (note) return ['Working', 'writing notes'];
    if (event.isError) return ['Working', 'step failed'];
    const action = toolAction(event);
    return ['Working', action];
  }

  if (event.type === 'status') {
    const status = event.runStatus || 'status';
    const detail = event.warning || event.message || '';
    if (status === 'queued') return ['Queued', detail || 'waiting for main agent'];
    if (status === 'starting') return ['Starting', detail || 'starting main agent session'];
    if (status === 'running') return ['Working', detail || 'streaming updates'];
    if (status === 'reconnecting') return ['Reconnecting', detail || 'stream lost; retrying'];
    if (status === 'completed') return ['Done', detail];
    if (status === 'failed') return ['Failed', detail];
    return [status, detail];
  }

  if (event.warning) return ['Warning', event.warning];
  if (event.chunk) return ['Answering', clamp(String(event.chunk).replace(/\s+/g, ' ').trim() || 'streaming response', 180)];
  return [event.type || 'Event', ''];
}

function isActiveEvent(event) {
  const status = String(event?.runStatus || '').toLowerCase();
  if (event?.type === 'tool') return event.phase !== 'end' && !event.isError;
  if (event?.type === 'thinking') return true;
  if (event?.chunk && event.type !== 'log') return true;
  return isActiveStatus(status);
}

function setNow(event) {
  syncRunTiming(event);
  const [headline, detail] = activityCopy(event);
  thinkingTitle.textContent = threadDisplayTitle();
  thinkingTitle.classList.toggle('is-active', isActiveEvent(event));
  thinkingDetail.textContent = detail ? `${headline} · ${detail}` : headline;
  if (activityNote) activityNote.textContent = detail ? `${headline} · ${detail}` : headline;
  if (event?.runStatus) {
    graphStatus = lifecycleCopy({ runStatus: event.runStatus });
    setStatus(graphStatus, statusTone(event.runStatus), isActiveEvent(event));
    renderAgentGraph();
  }
}

function renderAgentGraph() {
  const graphItems = [...graphTools.values()];
  const workflowItems = graphItems.filter((item) => item.kind === 'workflow' || item.kind === 'subagent');
  const hiddenCopy = workflowItems.length ? 'workflow trace · click to expand' : '';
  const workflowHtml = workflowItems.map((item) => {
    const state = item.state === 'error' ? 'error' : item.state === 'done' ? 'done' : 'running';
    const meta = [state, item.runId].filter(Boolean).join(' · ');
    return `<div class="agent-node workflow ${state}"><span>${escapeHtml(item.label)}</span><small>${escapeHtml(meta)}</small></div>`;
  }).join('');
  agentGraphCount.textContent = graphStatus;
  agentGraph.innerHTML = `
    <div class="agent-node pi ${escapeHtml(graphStatus)}"><span>main agent</span><small>${escapeHtml(graphStatus)}</small></div>
    ${workflowHtml ? `<div class="agent-edge"></div><div class="subagent-stack workflow-stack">${workflowHtml}</div>` : ''}
    ${hiddenCopy ? `<p class="rail-empty hidden-tool-hint">${escapeHtml(hiddenCopy)}</p>` : ''}
  `;
}

function diffSections(diffText) {
  const sections = new Map();
  let path = '';
  let lines = [];
  const flush = () => {
    if (path) sections.set(path, lines.join('\n').trimEnd());
  };

  for (const line of String(diffText || '').split('\n')) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (match) {
      flush();
      path = match[2] || match[1];
      lines = [line];
    } else if (path) {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

function diffFileRows(payload = {}) {
  const sections = diffSections(payload.diff);
  const rows = new Map();
  for (const file of Array.isArray(payload.files) ? payload.files : []) {
    rows.set(file.path, { ...file, diff: sections.get(file.path) || file.diff || '' });
  }
  for (const [path, diff] of sections) {
    if (!rows.has(path)) rows.set(path, { path, code: 'M', label: 'modified', diff });
  }
  return [...rows.values()];
}

function fallbackDiffText(file) {
  const label = file?.label || 'changed';
  const path = file?.path || 'file';
  return `${label} ${path}\n\nNo captured preview for this file.`;
}

function renderDiffBox(payload = {}) {
  if (!diffBox || !diffCount || !diffFiles || !diffEditor) return;
  const files = diffFileRows(payload);
  diffBox.hidden = !files.length;
  diffCount.textContent = String(files.length);
  diffFiles.replaceChildren();

  if (!files.length) {
    diffEditor.value = '';
    return;
  }

  if (!files.some((file) => file.path === selectedDiffPath)) selectedDiffPath = files[0].path;
  for (const file of files) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `diff-file${file.path === selectedDiffPath ? ' is-active' : ''}`;
    button.textContent = `${file.label || file.code || 'changed'} · ${file.path}`;
    button.addEventListener('click', () => {
      selectedDiffPath = file.path;
      renderDiffBox(payload);
    });
    diffFiles.append(button);
  }

  const selected = files.find((file) => file.path === selectedDiffPath) || files[0];
  diffEditor.value = `${selected.diff || fallbackDiffText(selected)}${payload.truncated ? '\n\n… changes truncated' : ''}`;
  if (!diffBoxOpenedOnce) {
    diffBox.open = true;
    diffBoxOpenedOnce = true;
  }
}

async function refreshDiffBox() {
  if (!name || !diffBox) return;
  try {
    renderDiffBox(await fetchJson(`/api/threads/${encodeURIComponent(name)}/diff`));
  } catch (error) {
    diffBox.hidden = false;
    diffCount.textContent = '!';
    diffFiles?.replaceChildren();
    if (diffEditor) diffEditor.value = error.message;
  }
}

function scheduleDiffRefresh(delay = 700) {
  clearTimeout(diffRefreshTimer);
  diffRefreshTimer = setTimeout(() => void refreshDiffBox(), delay);
}

function rememberNote(note) {
  const previous = notesByPath.get(note.path) || {};
  if (notesByPath.has(note.path)) notesByPath.delete(note.path);
  const files = Array.isArray(note.files) ? note.files : [];
  notesByPath.set(note.path, {
    ...previous,
    ...note,
    summary: note.summary || previous.summary || '',
    files: files.length ? files : previous.files || [],
    html: note.html || previous.html || '',
    timestamp: note.timestamp || previous.timestamp || '',
  });
  renderNotesRail();
}

function renderNotesRail() {
  const notes = [...notesByPath.values()].reverse();
  notesCount.textContent = String(notes.length);
  notesList.replaceChildren();
  // ponytail: temporary kill switch; remove this line when the notes pane comes back.
  notesList.closest('.notes-main')?.setAttribute('hidden', '');

  if (!notes.length) return;

  for (const note of notes) {
    const article = document.createElement('article');
    article.className = `rail-note${note.html ? ' has-preview' : ''}`;
    article.innerHTML = `
      <div class="rail-note-head">
        <strong>${escapeHtml(note.title)}</strong>
        <code>${escapeHtml(note.path)}</code>
      </div>
      ${note.summary ? `<p class="rail-note-summary">${escapeHtml(note.summary)}</p>` : ''}
    `;

    const preview = htmlPreviewDocument(note.html || '', currentPreviewTheme());
    if (preview) {
      const iframe = document.createElement('iframe');
      iframe.className = 'html-preview note-html-preview';
      iframe.title = `${note.title} preview`;
      iframe.setAttribute('sandbox', 'allow-same-origin');
      iframe.setAttribute('scrolling', 'no');
      iframe.referrerPolicy = 'no-referrer';
      iframe.addEventListener('load', () => resizeHtmlPreview(iframe));
      iframe.srcdoc = preview;
      article.append(iframe);
    }

    notesList.append(article);
  }
}

function appendTimelineItem(kind, titleText, detailText) {
  const follow = shouldFollowLatest();
  const article = document.createElement('article');
  article.className = `timeline-item ${kind}`;
  article.innerHTML = `
    <div class="timeline-dot" aria-hidden="true"></div>
    <div class="timeline-card">
      <strong>${escapeHtml(titleText)}</strong>
      ${detailText ? `<p>${escapeHtml(detailText)}</p>` : ''}
    </div>
  `;
  timeline.append(article);
  followLatest(follow);
  return article;
}

function renderImplementationNoteEvent(event) {
  for (const note of implementationNotesFromToolEvent(event)) {
    rememberNote({ ...note, timestamp: event.timestamp });
  }
}

function resizeHtmlPreview(iframe) {
  try {
    const doc = iframe.contentDocument;
    const root = doc?.documentElement;
    const body = doc?.body;
    const height = Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0, root?.offsetHeight || 0, body?.offsetHeight || 0, 1);
    iframe.style.height = `${Math.ceil(height) + 2}px`;
  } catch {
    iframe.style.height = '1px';
  }
}

function currentPreviewTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function renderMessageBody(node, text, allowHtml = false) {
  const raw = String(text || '');
  const preview = allowHtml ? htmlPreviewDocument(raw, currentPreviewTheme()) : '';
  const card = node.closest('.message-card');
  messageText.set(node, raw);

  if (!preview) {
    node.dataset.renderMode = 'text';
    card?.classList.remove('html-rendered');
    node.textContent = raw;
    renderExcalidrawArtifacts(node, raw);
    return;
  }

  node.dataset.renderMode = 'html';
  card?.classList.add('html-rendered');
  let iframe = node.querySelector('.html-preview');
  if (!iframe) {
    node.textContent = '';
    iframe = document.createElement('iframe');
    iframe.className = 'html-preview';
    iframe.title = 'HTML preview';
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.setAttribute('scrolling', 'no');
    iframe.referrerPolicy = 'no-referrer';
    iframe.addEventListener('load', () => {
      resizeHtmlPreview(iframe);
      setTimeout(() => resizeHtmlPreview(iframe), 60);
    });
    node.append(iframe);
  }
  iframe.style.height = '1px';
  iframe.srcdoc = preview;
  renderExcalidrawArtifacts(node, raw);
}

function appendMessageText(node, text, allowHtml = false) {
  renderMessageBody(node, `${messageText.get(node) || ''}${text}`, allowHtml);
}

function appendStreamingMessageText(node, text) {
  if (!node || !text) return;
  const raw = `${messageText.get(node) || ''}${text}`;
  const card = node.closest('.message-card');
  messageText.set(node, raw);
  if (node.dataset.renderMode !== 'text') {
    node.textContent = '';
    node.dataset.renderMode = 'text';
    card?.classList.remove('html-rendered');
  }
  node.append(document.createTextNode(text));
}

function flushAssistantChunks() {
  if (assistantChunkFrame) {
    cancelAnimationFrame(assistantChunkFrame);
    assistantChunkFrame = 0;
  }
  const text = assistantChunkBuffer;
  const follow = assistantChunkShouldFollow;
  assistantChunkBuffer = '';
  assistantChunkShouldFollow = false;
  if (!text) return;
  appendStreamingMessageText(ensureAssistantBody(), text);
  followLatest(follow);
}

function queueAssistantChunk(text) {
  assistantChunkBuffer += text;
  assistantChunkShouldFollow = assistantChunkShouldFollow || shouldFollowLatest();
  if (assistantChunkFrame) return;
  assistantChunkFrame = requestAnimationFrame(flushAssistantChunks);
}

function finalizeAssistantBody() {
  flushAssistantChunks();
  const body = activeAssistantBody;
  const raw = messageText.get(body) || '';
  if (body && raw) renderMessageBody(body, raw, true);
}

function threadMessageKey(message = {}) {
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  const timestamp = String(message.timestamp || '');
  const runId = String(message.runId || '');
  const text = String(message.text || '');
  return role === 'user' ? `${role}:${timestamp || runId}` : `${role}:${runId || timestamp}:${timestamp}:${text.length}`;
}

function rememberRenderedThreadMessage(message = {}) {
  renderedMessageKeys.add(threadMessageKey(message));
  if (message.role === 'assistant') {
    const runId = String(message.runId || currentRunId(currentThread) || '');
    if (runId) renderedAssistantRunIds.add(runId);
  }
}

function appendMessage(role, label, text = '') {
  const follow = shouldFollowLatest();
  const article = document.createElement('article');
  article.className = `timeline-item message-item ${role}`;
  article.innerHTML = `
    <div class="timeline-dot" aria-hidden="true"></div>
    <div class="message-card">
      <div class="message-body" data-render-mode="text"></div>
    </div>
  `;
  const body = article.querySelector('.message-body');
  renderMessageBody(body, text, role === 'assistant');
  timeline.append(article);
  followLatest(follow);
  return body;
}

function renderThreadHistory(thread) {
  const messages = Array.isArray(thread?.threadMessages) ? thread.threadMessages : [];
  if (!messages.length) return;

  const latestRunId = currentRunId(thread);
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const runId = String(message.runId || '');
    const key = threadMessageKey(message);
    if (renderedMessageKeys.has(key)) continue;

    if (message.role === 'user') {
      appendMessage('user', 'you', message.text);
      rememberRenderedThreadMessage(message);
      const assistant = runId ? messages.slice(index + 1).find((item) => item.role === 'assistant' && item.runId === runId) : null;
      const isLatestRun = runId && runId === latestRunId;
      const endMs = timestampMs(assistant?.timestamp) || (isLatestRun ? timestampMs(thread?.runEndedAtMs) || timestampMs(thread?.completedAt) || timestampMs(thread?.endedAt) : 0);
      const marker = runSummaryMarkers.get(runId);
      if ((assistant || isLatestRun) && !marker) {
        const nextMarker = appendRunSummaryMarker({ startMs: timestampMs(message.timestamp), endMs, status: assistant || endMs ? 'completed' : effectiveStatus(thread), runId });
        if (nextMarker && isLatestRun) activeRunSummaryMarker = nextMarker;
      } else if (marker && isLatestRun) {
        activeRunSummaryMarker = marker;
      }
      continue;
    }

    const isLatestAssistant = !runId || runId === latestRunId;
    if (activeAssistantBody && isLatestAssistant) {
      flushAssistantChunks();
      const follow = shouldFollowLatest();
      renderMessageBody(activeAssistantBody, message.text, true);
      activeAssistantBody = null;
      rememberRenderedThreadMessage(message);
      followLatest(follow);
      continue;
    }

    if (runId && renderedAssistantRunIds.has(runId)) {
      rememberRenderedThreadMessage(message);
      continue;
    }

    appendMessage('assistant', 'main agent', message.text);
    rememberRenderedThreadMessage(message);
  }
  renderRunSummary();
  historyRendered = true;
  initialPromptRendered = true;
}

function currentRunId(thread) {
  return String(thread?.bridgeRunId || thread?.submittedAtMs || '');
}

function historyHasAssistantForCurrentRun(thread) {
  const runId = currentRunId(thread);
  return Boolean(runId && thread?.threadMessages?.some((message) => message.role === 'assistant' && message.runId === runId));
}

function renderInitialPrompt(thread) {
  if (initialPromptRendered) return;
  const prompt = String(thread?.initialPrompt || thread?.taskPrompt || '').trim();
  if (!prompt) return;
  const startMs = timestampMs(thread?.submittedAtMs) || timestampMs(thread?.createdAt);
  const endMs = timestampMs(thread?.runEndedAtMs) || timestampMs(thread?.completedAt) || timestampMs(thread?.endedAt);
  const timestamp = startMs ? new Date(startMs).toISOString() : null;
  appendMessage('user', 'you', prompt);
  rememberRenderedThreadMessage({ role: 'user', text: prompt, timestamp, runId: currentRunId(thread) });
  const marker = appendRunSummaryMarker({ startMs, endMs, status: effectiveStatus(thread), runId: currentRunId(thread) });
  if (marker) activeRunSummaryMarker = marker;
  renderRunSummary();
  initialPromptRendered = true;
}

function ensureAssistantBody() {
  if (!activeAssistantBody) activeAssistantBody = appendMessage('assistant', 'main agent');
  return activeAssistantBody;
}

function looksLikeLegacySystemDump(text) {
  return text.length > 1000 && /\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s+\[system\]/.test(text);
}

function parsedLogLines(text) {
  const entries = [];
  const leftovers = [];

  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(?:\[([^\]]+)\]\s+)?\[system\]\s*(.*)$/);
    if (match) {
      entries.push({ timestamp: match[1] || null, message: match[2] || '' });
    } else {
      leftovers.push(rawLine);
    }
  }

  return { entries, leftovers };
}

function appendParsedLogDump(text, { allowLeftovers = false } = {}) {
  const { entries, leftovers } = parsedLogLines(text);
  if (!entries.length || (leftovers.length && !allowLeftovers)) return false;

  if (leftovers.length) {
    const follow = shouldFollowLatest();
    appendMessageText(ensureAssistantBody(), leftovers.join('\n'), true);
    const runId = currentRunId(currentThread);
    if (runId) renderedAssistantRunIds.add(runId);
    followLatest(follow);
  }
  return true;
}

function appendAssistantChunk(text) {
  if (!text) return;
  if (looksLikeLegacySystemDump(text) && appendParsedLogDump(text, { allowLeftovers: true })) return;
  if (appendParsedLogDump(text)) return;
  queueAssistantChunk(text);
  const runId = currentRunId(currentThread);
  if (runId) renderedAssistantRunIds.add(runId);
}

function workflowRunIdFromEvent(event = {}) {
  return event.workflowRunId || String([event.output, event.delta, event.text, event.label].filter(Boolean).join(' ')).match(/\brun-[a-z0-9-]+\b/i)?.[0] || '';
}

function toolKey(event) {
  const runId = workflowRunIdFromEvent(event);
  if (event.toolCallId) return event.toolCallId;
  if (runId && /workflow/i.test(`${event.toolName || ''} ${event.label || ''}`)) return `workflow:${runId}`;
  return `${event.label || event.toolName || 'tool'}-${event.id || event.timestamp || graphTools.size}`;
}

function updateAgentGraphForTool(event) {
  const state = event.isError ? 'error' : event.phase === 'end' && !event.backgroundWorkflow ? 'done' : 'running';
  const display = toolDisplay(event);
  let key = toolKey(event);
  let previous = graphTools.get(key) || {};
  if (display.kind === 'workflow' && display.runId) {
    const runKey = `workflow:${display.runId}`;
    previous = { ...previous, ...(graphTools.get(runKey) || {}) };
    if (runKey !== key) graphTools.delete(key);
    key = runKey;
  }
  const label = display.label === 'workflow' && previous.label ? previous.label : display.label || previous.label || 'tool';
  graphTools.set(key, {
    ...previous,
    ...display,
    state,
    runId: display.runId || previous.runId || '',
    label,
  });
  renderAgentGraph();
}

function updateAgentGraphForWorkflowEvent(event) {
  const runId = workflowRunIdFromEvent(event);
  let key = runId ? `workflow:${runId}` : '';
  if (!key) {
    const match = [...graphTools.entries()].reverse().find(([, item]) => item.kind === 'workflow' && item.state === 'running');
    key = match?.[0] || `workflow:${event.id || event.timestamp || graphTools.size}`;
  }
  const previous = graphTools.get(key) || {};
  const name = String(event.text || '').match(/Background workflow "([^"]+)" finished/)?.[1];
  graphTools.set(key, {
    kind: 'workflow',
    label: name || previous.label || 'workflow',
    runId: runId || previous.runId || '',
    state: event.type === 'workflow_result' ? 'done' : 'running',
  });
  renderAgentGraph();
}

function renderTimelineToolEvent(event) {
  if (!traceTimeline) return;
  const follow = shouldFollowTrace();
  const key = toolKey(event);
  const display = toolDisplay(event);
  const state = event.isError ? 'error' : event.phase === 'end' ? 'done' : 'running';
  let node = toolCards.get(key);

  if (!node) {
    const article = document.createElement('article');
    article.className = `timeline-item tool-item ${display.kind === 'workflow' ? 'workflow-item' : ''}`;
    article.innerHTML = `
      <div class="timeline-dot" aria-hidden="true"></div>
      <details class="tool-card ${display.kind === 'workflow' ? 'workflow-card' : ''}">
        <summary>
          <span data-tool-label></span>
          <span class="tool-target" data-tool-action></span>
          <span class="badge"></span>
        </summary>
        <pre></pre>
      </details>
    `;
    traceTimeline.append(article);
    node = article.querySelector('.tool-card');
    toolCards.set(key, node);
  }

  const action = display.action || node.dataset.toolAction || '';
  if (display.action) node.dataset.toolAction = display.action;
  node.querySelector('[data-tool-label]').textContent = display.label || event.label || event.toolName || 'tool';
  node.querySelector('[data-tool-action]').textContent = action;
  node.querySelector('.badge').textContent = state;
  node.dataset.phase = event.phase || '';
  node.dataset.state = state;
  node.open = state !== 'done' && Boolean(event.delta || event.output);

  const output = event.delta || event.output || '';
  if (output) {
    const pre = node.querySelector('pre');
    pre.textContent = clamp(`${pre.textContent}${output}`, 8000);
  }

  followTraceLatest(follow);
}

function traceRunKey(event = {}) {
  return String(event.runId || event.bridgeRunId || event.submittedAtMs || currentRunId(currentThread) || 'latest');
}

function renderTimelineThinkingEvent(event) {
  if (!traceTimeline || !event.delta) return;
  const follow = shouldFollowTrace();
  const key = traceRunKey(event);
  let node = thinkingCards.get(key);

  if (!node) {
    const article = document.createElement('article');
    article.className = 'timeline-item thinking-item';
    article.innerHTML = `
      <div class="timeline-dot" aria-hidden="true"></div>
      <div class="thinking-card">
        <div class="message-head"><strong>thinking steps</strong></div>
        <div class="thinking-body"></div>
      </div>
    `;
    traceTimeline.append(article);
    node = article.querySelector('.thinking-card');
    thinkingCards.set(key, node);
  }

  const body = node.querySelector('.thinking-body');
  body.textContent = clamp(`${body.textContent}${event.delta}`, 8000);
  followTraceLatest(follow);
}

function renderTimelineSummaryEvent(event) {
  const summary = String(event.summary || event.session?.finalAnswerSummary || '').replace(/\s+/g, ' ').trim();
  if (!traceTimeline || !summary) return;
  const follow = shouldFollowTrace();
  const article = document.createElement('article');
  article.className = 'timeline-item summary-item';
  article.innerHTML = `
    <div class="timeline-dot" aria-hidden="true"></div>
    <div class="timeline-card">
      <strong>summary</strong>
      <p>${escapeHtml(summary)}</p>
    </div>
  `;
  traceTimeline.append(article);
  followTraceLatest(follow);
}

function workflowEventCopy(event = {}) {
  const runId = workflowRunIdFromEvent(event);
  if (event.type === 'workflow_result') {
    const name = String(event.text || '').match(/Background workflow "([^"]+)" finished/)?.[1] || 'workflow';
    return ['workflow finished', [name, runId, 'continuing main agent'].filter(Boolean).join(' · ')];
  }
  return ['workflow', [event.message || event.phase || 'status', runId].filter(Boolean).join(' · ')];
}

function renderWorkflowEvent(event) {
  updateAgentGraphForWorkflowEvent(event);
  const [titleText, detailText] = workflowEventCopy(event);
  appendTimelineItem('workflow-item', titleText, detailText);
  if (!traceTimeline) return;
  const follow = shouldFollowTrace();
  const article = document.createElement('article');
  article.className = 'timeline-item workflow-item';
  const resultText = event.type === 'workflow_result' ? clamp(event.text || '', 8000) : '';
  article.innerHTML = `
    <div class="timeline-dot" aria-hidden="true"></div>
    <div class="timeline-card">
      <strong>${escapeHtml(titleText)}</strong>
      ${detailText ? `<p>${escapeHtml(detailText)}</p>` : ''}
      ${resultText ? `<details><summary>workflow result</summary><pre>${escapeHtml(resultText)}</pre></details>` : ''}
    </div>
  `;
  traceTimeline.append(article);
  followTraceLatest(follow);
}

function renderToolEvent(event) {
  updateAgentGraphForTool(event);
  renderImplementationNoteEvent(event);
  renderTimelineToolEvent(event);
  scheduleDiffRefresh(event.phase === 'end' ? 250 : 900);
}

function renderEvent(event, { appendTranscript = false } = {}) {
  if (!event) return;
  updateLastEventId(event);
  if (event.type === 'usage') return;

  if (event.type === 'title' || event.type === 'answer_summary') {
    const key = eventKey(event);
    const isNewEvent = !seenEvents.has(key);
    seenEvents.add(key);
    if (event.type === 'answer_summary' && isNewEvent) renderTimelineSummaryEvent(event);
    if (event.session) {
      renderThread(event.session);
      renderThreadHistory(event.session);
    }
    return;
  }

  if (event.chunk && event.type !== 'log') {
    setNow(event);
    if (appendTranscript) appendAssistantChunk(event.chunk);
    if (event.session) {
      renderThread(event.session);
      renderThreadHistory(event.session);
    }
    if (event.warning) setStatus(event.warning, 'error');
    return;
  }

  const key = eventKey(event);
  if (seenEvents.has(key)) return;
  seenEvents.add(key);
  setNow(event);

  if (event.type === 'thinking') {
    renderTimelineThinkingEvent(event);
  } else if (event.type === 'tool') {
    renderToolEvent(event);
  } else if (event.type === 'workflow_status' || event.type === 'workflow_result') {
    renderWorkflowEvent(event);
  } else if (!['log', 'status', 'metric'].includes(event.type)) {
    const [headline, detail] = activityCopy(event);
    appendTimelineItem(event.type || 'event', headline, detail);
  }

  if (event.done || event.runStatus === 'completed' || event.runStatus === 'failed') {
    finalizeAssistantBody();
    scheduleDiffRefresh(150);
  }
  if (event.session) {
    renderThread(event.session);
    renderThreadHistory(event.session);
  }
  if (event.warning) setStatus(event.warning, 'error');
}

async function loadThread() {
  if (!name) throw new Error('Missing main agent name.');
  const payload = await fetchJson(`/api/threads/${encodeURIComponent(name)}`);
  renderProject(payload.provider);
  renderPiDefaults(payload.defaults);
  loadRunControls(payload.thread);
  renderThread(payload.thread);
  renderThreadHistory(payload.thread);
  renderInitialPrompt(payload.thread);
  return payload.thread;
}

async function loadOutput() {
  const payload = await fetchJson(`/api/sessions/${encodeURIComponent(name)}/output`);
  const appendTranscript = !historyHasAssistantForCurrentRun(payload.session || currentThread);
  if (Array.isArray(payload.events) && payload.events.length) {
    for (const event of payload.events) renderEvent(event, { appendTranscript });
  } else if (payload.chunk && appendTranscript) {
    appendAssistantChunk(payload.chunk);
  }
  if (payload.session) {
    renderThread(payload.session);
    renderThreadHistory(payload.session);
  }
  scheduleDiffRefresh(0);
  return payload;
}

function streamRun() {
  if (activeStream) activeStream.close();
  activeStream = new EventSource(streamUrl(`/api/sessions/${encodeURIComponent(name)}/stream`, lastEventId));

  activeStream.onopen = () => {
    setNow({ type: 'status', runStatus: 'running', warning: 'streaming live updates' });
  };

  activeStream.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.reset) {
      void loadOutput();
      updateLastEventId(payload);
      return;
    }
    renderEvent(payload, { appendTranscript: true });

    if (payload.done || payload.runStatus === 'completed' || payload.runStatus === 'failed') {
      activeStream.close();
      activeStream = null;
      const doneStatus = payload.runStatus === 'completed' ? 'completed' : 'failed';
      currentThread = { ...currentThread, status: doneStatus, runStatus: doneStatus };
      setStatus(doneStatus === 'completed' ? 'done' : 'failed', statusTone(doneStatus));
      renderArchiveButton(currentThread);
      scheduleDiffRefresh(0);
      sendButton.disabled = false;
      finalizeAssistantBody();
      activeAssistantBody = null;
    }
  };

  activeStream.onerror = () => {
    if (!activeStream) return;
    setNow({ type: 'status', runStatus: 'reconnecting', warning: 'stream lost; retrying' });
  };
}

getBrowserSessionId();
agentRail?.addEventListener('click', () => toggleAgentActivity());
agentRail?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleAgentActivity();
});
diffBox?.addEventListener('click', (event) => event.stopPropagation());
diffBox?.addEventListener('keydown', (event) => event.stopPropagation());
agentActivityClose?.addEventListener('click', () => setAgentActivityOpen(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isAgentActivityOpen()) setAgentActivityOpen(false);
});
modelRefInput.addEventListener('change', saveRunControls);
thinkingLevelInput.addEventListener('input', () => {
  renderThinkingLevel();
  saveRunControls();
});
archiveButton?.addEventListener('click', async () => {
  archiveButton.disabled = true;
  archiveButton.textContent = 'marking…';
  try {
    await fetchJson(`/api/threads/${encodeURIComponent(name)}/archive`, { method: 'POST' });
    window.location.assign('/workspace.html');
  } catch (error) {
    archiveButton.disabled = false;
    archiveButton.textContent = 'mark as done';
    setStatus(error.message, 'error');
  }
});
imageInput?.addEventListener('change', () => updateImageStatus(imageInput, imageStatus));
bindImageDropZone(promptForm, imageInput, imageStatus);
submitOnEnter(promptInput, promptForm, sendButton);
setAgentActivityOpen(false);
renderAgentGraph();
renderNotesRail();

promptForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const typedPrompt = promptInput.value.trim();
  sendButton.disabled = true;

  try {
    const images = await filesToImageAttachments(imageInputFiles(imageInput));
    const prompt = typedPrompt || (images.length ? 'Describe the attached image(s).' : '');
    if (!prompt) {
      sendButton.disabled = false;
      return;
    }

    const submittedAtMs = Date.now();
    const submittedAt = new Date(submittedAtMs).toISOString();
    appendMessage('user', 'you', imageAttachmentText(prompt, images.length));
    rememberRenderedThreadMessage({ role: 'user', text: prompt, timestamp: submittedAt, runId: String(submittedAtMs) });
    activeRunSummaryMarker = appendRunSummaryMarker({ startMs: submittedAtMs, status: 'queued', runId: String(submittedAtMs) });
    saveRunControls();
    promptInput.value = '';
    clearImageInput(imageInput);
    updateImageStatus(imageInput, imageStatus);
    renderEvent({ type: 'status', runStatus: 'queued', timestamp: new Date(submittedAtMs).toISOString(), submittedAtMs });

    const payload = await fetchJson(`/api/threads/${encodeURIComponent(name)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        submittedAtMs,
        clientId: getBrowserSessionId(),
        modelRef: modelRefInput.value,
        thinkingLevel: thinkingLevelValue(),
        images,
      }),
    });
    if (payload.session) {
      renderThread(payload.session);
      renderThreadHistory(payload.session);
    }
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
} catch (error) {
  renderEvent({ type: 'status', runStatus: 'failed', warning: error.message, timestamp: new Date().toISOString() });
  setStatus(error.message, 'error');
}
