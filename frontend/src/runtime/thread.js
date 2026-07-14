import 'diff2html/bundles/css/diff2html.min.css';
import { captureSpannerEvent } from '../lib/posthog.js';
import { redirectIfAuthRequired } from './auth-redirect.js';
import './appearance.js?v=palette-2';
import { htmlPreviewDocument } from './html-preview.js';
import { renderInteractiveArtifacts, stripInteractiveArtifactBlocks } from './interactive-artifacts.js';
import { extractOpenUIArtifacts, stripOpenUIArtifactBlocks } from './openui-artifacts.js';
import { submitOnEnter } from './submit-on-enter.js';
import { bindImageDropZone, clearImageInput, filesToImageAttachments, imageAttachmentSrc, imageAttachmentText, imageInputFiles, updateImageStatus } from './image-attachments.js';
import { implementationNoteFromToolEvent, implementationNotesFromToolEvent } from './implementation-notes.js';
import { diagramImageArtifactPaths, excalidrawArtifactPaths, htmlArtifactPaths, htmlImageArtifactPaths, normalizeDiagramImageArtifactPath, normalizeHtmlArtifactPath } from './excalidraw-artifacts.js';

const BROWSER_SESSION_KEY = 'spannerBrowserSession';
const MODEL_REF_KEY = 'spannerModelRef';
const THINKING_LEVEL_KEY = 'spannerThinkingLevel';
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const ARCHIVEABLE_THREAD_STATUSES = ['completed', 'ready', 'failed'];
const COPY_FEEDBACK_MS = 1200;
const STREAM_RECONNECT_NOTICE_MS = 2500;
const STREAM_FALLBACK_POLL_MS = 2500;
const STREAM_FALLBACK_INITIAL_POLL_MS = 800;
const PHOSPHOR_COPY_ICON = '<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path d="M216,34H88a6,6,0,0,0-6,6V82H40a6,6,0,0,0-6,6V216a6,6,0,0,0,6,6H168a6,6,0,0,0,6-6V174h42a6,6,0,0,0,6-6V40A6,6,0,0,0,216,34ZM162,210H46V94H162Zm48-48H174V88a6,6,0,0,0-6-6H94V46H210Z" /></svg><span class="sr-only">copy</span>';
const MAX_INLINE_EXCALIDRAW_ARTIFACTS = 3;
const MAX_INLINE_DIAGRAM_IMAGE_ARTIFACTS = 4;
const MAX_INLINE_HTML_ARTIFACTS = 2;

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
migrateStorageKey('workbenchModelRef', MODEL_REF_KEY);
migrateStorageKey('workbenchThinkingLevel', THINKING_LEVEL_KEY);

const params = new URLSearchParams(location.search);
const name = params.get('name');

const projectLabel = document.querySelector('#project-label');
const title = document.querySelector('#thread-title');
const meta = document.querySelector('#thread-meta');
const statusNode = document.querySelector('#thread-status');
const stopButton = document.querySelector('#stop-thread');
const resumeButton = document.querySelector('#resume-thread');
const deleteButton = document.querySelector('#delete-thread');
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
const nextStepsSection = document.querySelector('#suggested-next-steps');
const nextStepsList = document.querySelector('#suggested-next-steps-list');
const promptForm = document.querySelector('#prompt-form');
const promptInput = document.querySelector('#prompt');
const composerHint = document.querySelector('#composer-hint');
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
const diffDialog = document.querySelector('#diff-dialog');
const diffDialogTitle = document.querySelector('#diff-dialog-title');
const diffDialogFiles = document.querySelector('#diff-dialog-files');
const diffDialogBody = document.querySelector('#diff-dialog-body');
const diffDialogClose = document.querySelector('#diff-dialog-close');

function syncComposerClearance() {
  if (!promptForm) return;
  const bottom = Number.parseFloat(getComputedStyle(promptForm).bottom) || 0;
  const clearance = Math.ceil(promptForm.getBoundingClientRect().height + bottom + 18);
  document.documentElement.style.setProperty('--thread-composer-clearance', `${Math.max(126, clearance)}px`);
}

function observeComposerClearance() {
  if (!promptForm) return;
  const sync = () => requestAnimationFrame(syncComposerClearance);
  syncComposerClearance();
  if (globalThis.ResizeObserver) new ResizeObserver(sync).observe(promptForm);
  window.addEventListener('resize', sync);
}

observeComposerClearance();

let activeStream = null;
let streamConnected = false;
let streamReconnectNoticeTimer = 0;
let streamFallbackPollTimer = 0;
let currentThread = null;
let activeAssistantBody = null;
let defaultThinkingLevel = 'xhigh';
let currentProjectName = '';
let runControlsLoaded = false;
let lastEventId = 0;
let fallbackEventId = 0;
const seenEvents = new Set();
const graphTools = new Map();
const workflowRuns = new Map();
const toolCards = new Map();
const thinkingCards = new Map();
const notesByPath = new Map();
const messageText = new WeakMap();
const runSummaryMarkers = new Map();
const renderedMessageKeys = new Set();
const renderedAssistantRunIds = new Set();
const capturedFinishedRuns = new Set();
let activeRunSummaryMarker = null;
let runStartedAtMs = 0;
let runEndedAtMs = 0;
let runSummaryStatus = '';
let runSummaryTimer = null;
let initialPromptRendered = false;
let historyRendered = false;
let graphStatus = 'waiting';
let diffDialogPath = '__all__';
let lastDiffPayload = null;
let diffRefreshTimer = null;
let assistantChunkBuffer = '';
let assistantChunkFrame = 0;
let assistantChunkShouldFollow = false;
let submitInFlight = false;
let nextSubmitDelivery = 'auto';
let queuedSteeringCount = 0;
let queuedFollowUpCount = 0;
let initialResumeScrollDone = false;
let workflowPollTimer = 0;
let timelineEntriesCanAnimate = false;
const excalidrawRenderTokens = new WeakMap();
const openUIRenderTokens = new WeakMap();

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

function fallbackCopyText(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();
  const ok = document.execCommand?.('copy');
  textarea.remove();
  if (!ok) throw new Error('copy failed');
}

async function copyText(text) {
  const value = String(text || '');
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through for desktop/webviews that expose clipboard but reject it.
    }
  }
  fallbackCopyText(value);
  return true;
}

function makeCopyButton(getText, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-button';
  button.innerHTML = PHOSPHOR_COPY_ICON;
  button.title = `copy ${label}`;
  button.setAttribute('aria-label', `copy ${label}`);
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    try {
      button.textContent = await copyText(getText()) ? 'copied' : 'empty';
    } catch {
      button.textContent = 'failed';
    }
    setTimeout(() => {
      button.disabled = false;
      button.innerHTML = PHOSPHOR_COPY_ICON;
    }, COPY_FEEDBACK_MS);
  });
  return button;
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

function markTimelineEnter(article) {
  if (timelineEntriesCanAnimate) article.classList.add('is-entering');
}

function getApiBase() {
  return API_BASE;
}

function getApiToken() {
  return '';
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
  const headers = { 'x-spanner-session': getBrowserSessionId() };
  const token = getApiToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function apiUrl(path) {
  return `${getApiBase()}${path}`;
}

function streamUrl(path, after = 0) {
  const url = new URL(apiUrl(path), location.origin);
  url.searchParams.set('browserSession', getBrowserSessionId());
  if (after) url.searchParams.set('after', String(after));
  return url.toString();
}

function excalidrawViewerUrl(artifactPath, mode = 'full') {
  const url = new URL('/excalidraw-viewer.html', location.origin);
  url.searchParams.set('thread', name || '');
  url.searchParams.set('path', artifactPath);
  url.searchParams.set('theme', currentPreviewTheme());
  if (mode === 'preview') url.searchParams.set('mode', 'preview');
  return url.toString();
}

function excalidrawEditorUrl(artifactPath) {
  const url = new URL('/excalidraw-editor.html', location.origin);
  url.searchParams.set('thread', name || '');
  url.searchParams.set('path', artifactPath);
  url.searchParams.set('theme', currentPreviewTheme());
  return url.toString();
}

function diagramImageArtifactUrl(artifactPath) {
  const url = new URL(apiUrl(`/api/threads/${encodeURIComponent(name)}/artifacts/file`), location.origin);
  url.searchParams.set('path', artifactPath);
  url.searchParams.set('browserSession', getBrowserSessionId());
  return url.toString();
}

function htmlArtifactUrl(artifactPath) {
  const url = new URL(apiUrl(`/api/threads/${encodeURIComponent(name)}/artifacts/html`), location.origin);
  url.searchParams.set('path', artifactPath);
  url.searchParams.set('browserSession', getBrowserSessionId());
  return url.toString();
}

function htmlArtifactStateUrl(artifactPath, stateKey = 'default') {
  const url = new URL(`/api/threads/${encodeURIComponent(name)}/artifacts/state`, location.origin);
  url.searchParams.set('path', artifactPath);
  url.searchParams.set('key', stateKey || 'default');
  url.searchParams.set('browserSession', getBrowserSessionId());
  return `${url.pathname}${url.search}`;
}

function resolveHtmlPreviewImageSrc(src) {
  const artifactPath = normalizeDiagramImageArtifactPath(src);
  return name && artifactPath ? diagramImageArtifactUrl(artifactPath) : '';
}

function artifactStem(artifactPath) {
  return String(artifactPath || '').replace(/\.(?:excalidraw|gif|jpe?g|png|svg|webp|html)$/i, '');
}

function encodedPublicUrl(pathname) {
  const encoded = pathname.split('/').map((part, index) => index ? encodeURIComponent(part) : part).join('/');
  return new URL(encoded, location.origin).toString();
}

function publicExcalidrawArtifactUrls(artifactPath) {
  const leaf = artifactPath.split('/').at(-1) || artifactPath;
  return [...new Set([
    `/artifacts/${artifactPath}`,
    `/artifacts/${leaf}`,
    `/${artifactPath}`,
  ])].map(encodedPublicUrl);
}

function hasExcalidrawScene(payload) {
  const scene = payload?.data || payload;
  return scene?.type === 'excalidraw' && Array.isArray(scene.elements);
}

async function fetchPublicExcalidrawArtifact(url) {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function canLoadExcalidrawArtifact(artifactPath) {
  if (name) {
    try {
      const payload = await fetchJson(`/api/threads/${encodeURIComponent(name)}/artifacts?path=${encodeURIComponent(artifactPath)}`);
      return hasExcalidrawScene(payload);
    } catch {
      return false;
    }
  }

  for (const url of publicExcalidrawArtifactUrls(artifactPath)) {
    try {
      if (hasExcalidrawScene(await fetchPublicExcalidrawArtifact(url))) return true;
    } catch {
      // Missing public fallback; keep looking.
    }
  }
  return false;
}

async function viewableExcalidrawArtifactPaths(paths) {
  const checks = await Promise.all(paths.map(async (artifactPath) => (
    await canLoadExcalidrawArtifact(artifactPath) ? artifactPath : ''
  )));
  return checks.filter(Boolean);
}

async function fetchDiagramImageArtifact(artifactPath) {
  try {
    const response = await fetch(diagramImageArtifactUrl(artifactPath), {
      credentials: 'include',
      cache: 'no-store',
      headers: authHeaders(),
    });
    if (!response.ok || !String(response.headers.get('content-type') || '').startsWith('image/')) return null;
    return { path: artifactPath, src: URL.createObjectURL(await response.blob()) };
  } catch {
    return null;
  }
}

async function viewableDiagramImageArtifacts(paths) {
  const artifacts = await Promise.all(paths.map(fetchDiagramImageArtifact));
  return artifacts.filter(Boolean);
}

function appendExcalidrawArtifactCard(section, artifactPath) {
  const card = document.createElement('article');
  card.className = 'excalidraw-card';

  const head = document.createElement('div');
  head.className = 'excalidraw-card-head';
  const title = document.createElement('strong');
  title.textContent = artifactPath.split('/').at(-1) || artifactPath;
  title.title = artifactPath;
  card.title = artifactPath;
  const links = document.createElement('span');
  links.className = 'excalidraw-card-links';
  const link = document.createElement('a');
  link.href = excalidrawViewerUrl(artifactPath);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'open';
  link.setAttribute('aria-label', `Open ${artifactPath} full size`);
  const editLink = document.createElement('a');
  editLink.href = excalidrawEditorUrl(artifactPath);
  editLink.target = '_blank';
  editLink.rel = 'noopener noreferrer';
  editLink.textContent = 'edit';
  editLink.setAttribute('aria-label', `Edit ${artifactPath}`);
  links.append(link, editLink);
  head.append(title, links);

  const frame = document.createElement('iframe');
  frame.className = 'excalidraw-inline-viewer';
  frame.title = `Excalidraw preview: ${artifactPath}`;
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.setAttribute('scrolling', 'no');
  frame.src = excalidrawViewerUrl(artifactPath, 'preview');

  const actions = document.createElement('div');
  actions.className = 'excalidraw-card-actions';
  [
    ['Simplify', 'Simplify this diagram, reduce clutter, and create a new .excalidraw artifact.'],
    ['Relayout', 'Re-layout this diagram for clearer left-to-right flow and create a new .excalidraw artifact.'],
    ['Mockup', 'Turn this diagram into a UI mockup direction and create a new .excalidraw artifact.'],
  ].forEach(([label, instruction]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => fillComposerFromInteractiveAction({
      delivery: 'followUp',
      prompt: `[Diagram action: ${label}]\nFor ${artifactPath}: ${instruction}\nMention the new artifact path as plain text so Spanner renders it inline.`,
    }));
    actions.append(button);
  });

  card.append(head, frame, actions);
  section.append(card);
}

function appendDiagramImageArtifactCard(section, artifact) {
  const card = document.createElement('article');
  card.className = 'excalidraw-card diagram-image-card';
  card.title = artifact.path;

  const head = document.createElement('div');
  head.className = 'excalidraw-card-head';
  const title = document.createElement('strong');
  title.textContent = artifact.path.split('/').at(-1) || artifact.path;
  title.title = artifact.path;
  const link = document.createElement('a');
  link.href = diagramImageArtifactUrl(artifact.path);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'open';
  head.append(title, link);

  const image = document.createElement('img');
  image.className = 'diagram-inline-image';
  image.src = artifact.src;
  image.alt = `Diagram preview: ${artifact.path}`;
  image.loading = 'lazy';

  card.append(head, image);
  section.append(card);
}

function appendHtmlArtifactCard(section, artifactPath) {
  const card = document.createElement('article');
  card.className = 'excalidraw-card html-artifact-card';
  card.title = artifactPath;

  const head = document.createElement('div');
  head.className = 'excalidraw-card-head';
  const title = document.createElement('strong');
  title.textContent = artifactPath.split('/').at(-1) || artifactPath;
  title.title = artifactPath;
  const link = document.createElement('a');
  link.href = htmlArtifactUrl(artifactPath);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'open';
  head.append(title, link);

  const frame = document.createElement('iframe');
  frame.className = 'html-artifact-frame';
  frame.title = `HTML artifact preview: ${artifactPath}`;
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer';
  frame.dataset.artifactPath = artifactPath;
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.src = htmlArtifactUrl(artifactPath);

  card.append(head, frame);
  section.append(card);
}

function renderHtmlArtifacts(node, text) {
  node.querySelector('.html-artifacts')?.remove();
  if (!name || !node.closest('.message-item.assistant')) return;
  const paths = htmlArtifactPaths(text).slice(0, MAX_INLINE_HTML_ARTIFACTS);
  if (!paths.length) return;

  const section = document.createElement('section');
  section.className = 'excalidraw-artifacts html-artifacts';
  section.setAttribute('aria-label', 'HTML artifacts');
  paths.forEach((artifactPath) => appendHtmlArtifactCard(section, artifactPath));
  node.append(section);
}

function htmlArtifactFrameForSource(source) {
  return [...document.querySelectorAll('.html-artifact-frame')].find((frame) => frame.contentWindow === source) || null;
}

function postHtmlArtifactStateMessage(frame, payload) {
  try {
    frame.contentWindow?.postMessage(payload, '*');
  } catch {}
}

async function handleHtmlArtifactStateMessage(event) {
  const message = event.data;
  if (!message || typeof message !== 'object' || !String(message.type || '').startsWith('spanner:artifact-state:')) return;
  const frame = htmlArtifactFrameForSource(event.source);
  if (!frame || !name) return;

  const artifactPath = frame.dataset.artifactPath || '';
  const key = String(message.key || message.stateKey || 'default');
  const requestId = message.requestId || '';
  try {
    if (message.type === 'spanner:artifact-state:load') {
      const payload = await fetchJson(htmlArtifactStateUrl(artifactPath, key));
      postHtmlArtifactStateMessage(frame, { type: 'spanner:artifact-state:loaded', requestId, path: artifactPath, key, ...payload });
      return;
    }
    if (message.type === 'spanner:artifact-state:save') {
      const payload = await fetchJson(htmlArtifactStateUrl(artifactPath, key), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, data: message.data ?? null }),
      });
      postHtmlArtifactStateMessage(frame, { type: 'spanner:artifact-state:saved', requestId, path: artifactPath, key, ...payload });
    }
  } catch (error) {
    postHtmlArtifactStateMessage(frame, { type: 'spanner:artifact-state:error', requestId, path: artifactPath, key, error: error.message || 'Artifact state failed.' });
  }
}

window.addEventListener('message', handleHtmlArtifactStateMessage);

function renderExcalidrawArtifacts(node, text, options = {}) {
  const renderToken = {};
  excalidrawRenderTokens.set(node, renderToken);
  node.querySelector('.excalidraw-artifacts')?.remove();
  if (!name || !node.closest('.message-item.assistant')) return;

  const skippedImagePaths = new Set((options.skipImagePaths || []).map(normalizeDiagramImageArtifactPath).filter(Boolean));
  const imagePaths = options.includeImages === false ? [] : diagramImageArtifactPaths(text)
    .filter((artifactPath) => !skippedImagePaths.has(artifactPath))
    .slice(0, MAX_INLINE_DIAGRAM_IMAGE_ARTIFACTS);
  const imageStems = new Set(imagePaths.map(artifactStem));
  const excalidrawPaths = excalidrawArtifactPaths(text)
    .filter((artifactPath) => !imageStems.has(artifactStem(artifactPath)))
    .slice(0, MAX_INLINE_EXCALIDRAW_ARTIFACTS);
  if (!imagePaths.length && !excalidrawPaths.length) return;

  void Promise.all([
    viewableDiagramImageArtifacts(imagePaths),
    viewableExcalidrawArtifactPaths(excalidrawPaths),
  ]).then(([imageArtifacts, viewableExcalidrawPaths]) => {
    if (excalidrawRenderTokens.get(node) !== renderToken || (!imageArtifacts.length && !viewableExcalidrawPaths.length)) return;
    const section = document.createElement('section');
    section.className = 'excalidraw-artifacts diagram-artifacts';
    section.setAttribute('aria-label', 'Diagram artifacts');
    imageArtifacts.forEach((artifact) => appendDiagramImageArtifactCard(section, artifact));
    viewableExcalidrawPaths.forEach((artifactPath) => appendExcalidrawArtifactCard(section, artifactPath));
    node.append(section);
  });
}

async function fetchJson(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) {
    if (redirectIfAuthRequired(payload, response)) return new Promise(() => {});
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function effectiveStatus(thread) {
  const runStatus = String(thread?.runStatus || '').toLowerCase();
  return runStatus && runStatus !== 'unknown' ? thread.runStatus : thread?.status;
}

function isActiveStatus(status) {
  return ['launching', 'running', 'queued', 'starting', 'reconnecting'].includes(String(status || '').toLowerCase());
}

function isClosedRunStatus(status) {
  return ['completed', 'failed', 'ready', 'suspended', 'deleted'].includes(String(status || '').toLowerCase());
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

function canStopThread(thread) {
  return isActiveStatus(effectiveStatus(thread));
}

function isRemoteLifecycleThread(thread) {
  return Boolean(thread && !thread.localMode && String(thread.provider || '').toLowerCase() !== 'local');
}

function canResumeThread(thread) {
  return isRemoteLifecycleThread(thread) && String(effectiveStatus(thread) || '').toLowerCase() === 'suspended';
}

function canDeleteThread(thread) {
  const status = String(effectiveStatus(thread) || '').toLowerCase();
  return isRemoteLifecycleThread(thread) && !isActiveStatus(status) && !['deleted', 'backing_up'].includes(status);
}

function canSendActiveDelivery(thread = currentThread) {
  const status = String(effectiveStatus(thread) || '').toLowerCase();
  if (status === 'running') return true;
  return ['queued', 'starting'].includes(status)
    && isRemoteLifecycleThread(thread)
    && Boolean(thread?.bridgeClaimed && thread?.bridgeRunId && thread?.bridgeUrl && thread?.hasBridgeToken);
}

function isStartingThread(thread = currentThread) {
  return ['launching', 'queued', 'starting', 'reconnecting'].includes(String(effectiveStatus(thread) || '').toLowerCase()) && !canSendActiveDelivery(thread);
}

function queueCountCopy() {
  const parts = [];
  if (queuedSteeringCount) parts.push(`${queuedSteeringCount} steer${queuedSteeringCount === 1 ? '' : 's'}`);
  if (queuedFollowUpCount) parts.push(`${queuedFollowUpCount} follow-up${queuedFollowUpCount === 1 ? '' : 's'}`);
  return parts.length ? ` · pending ${parts.join(', ')}` : '';
}

function renderComposerState(thread = currentThread) {
  const activeDelivery = canSendActiveDelivery(thread);
  const starting = isStartingThread(thread);
  const status = String(effectiveStatus(thread) || '').toLowerCase();
  const blocked = ['deleted', 'backing_up'].includes(status);
  if (composerHint) {
    composerHint.textContent = status === 'suspended'
      ? 'Sandbox is suspended · send will resume it'
      : status === 'deleted'
        ? 'Sandbox was deleted after backup'
        : status === 'backing_up'
          ? 'Backing up before delete…'
          : activeDelivery
            ? `Enter steers as soon as live · Alt+Enter queues a follow-up${queueCountCopy()}`
            : starting
              ? 'Agent is starting · steering unlocks once it is live'
              : 'Enter sends · Shift+Enter adds a line';
  }
  if (promptInput) promptInput.placeholder = status === 'suspended' ? 'Send to resume sandbox…' : blocked ? 'Lifecycle action required…' : activeDelivery ? 'Steer the running agent…' : 'Next task…';
  if (sendButton) {
    sendButton.disabled = submitInFlight || starting || blocked;
    sendButton.textContent = activeDelivery ? 'steer' : 'send';
  }
}

function normalizedSuggestedNextSteps(thread = currentThread) {
  const runId = currentRunId(thread);
  if (thread?.suggestedNextStepsRunId && runId && String(thread.suggestedNextStepsRunId) !== runId) return [];
  return (Array.isArray(thread?.suggestedNextSteps) ? thread.suggestedNextSteps : [])
    .map((step) => ({ label: String(step?.label || '').trim(), prompt: String(step?.prompt || '').trim() }))
    .filter((step) => step.label && step.prompt)
    .slice(0, 3);
}

function renderSuggestedNextSteps(thread = currentThread) {
  if (!nextStepsSection || !nextStepsList) return;
  const steps = normalizedSuggestedNextSteps(thread);
  nextStepsSection.hidden = !steps.length;
  nextStepsList.innerHTML = steps.map((step) => `
    <button class="next-step-btn" type="button" data-next-step-prompt="${escapeHtml(step.prompt)}">
      <strong>${escapeHtml(step.label)}</strong>
      <span>${escapeHtml(step.prompt)}</span>
    </button>
  `).join('');
}

function updateQueueState(event = {}) {
  queuedSteeringCount = Array.isArray(event.steering) ? event.steering.length : queuedSteeringCount;
  queuedFollowUpCount = Array.isArray(event.followUp) ? event.followUp.length : queuedFollowUpCount;
  renderComposerState();
}

function finalTurnStatus(thread = currentThread) {
  const status = String(thread?.finalTurnStatus || '').trim();
  const color = String(thread?.finalTurnColor || '').trim();
  if (!status || !color) return null;
  return {
    status,
    color,
    reason: String(thread?.finalTurnReason || '').trim(),
    runId: String(thread?.finalTurnStatusRunId || currentRunId(thread) || ''),
  };
}

function applyAssistantTurnStatus(item, turn) {
  if (!item) return;
  delete item.dataset.turnStatus;
  delete item.dataset.turnColor;
  item.removeAttribute('title');
  if (!turn?.status || !turn?.color) return;
  item.dataset.turnStatus = turn.status;
  item.dataset.turnColor = turn.color;
  if (turn.reason) item.title = turn.reason;
}

function turnStatusForMessage(message, thread = currentThread) {
  const turn = finalTurnStatus(thread);
  if (!turn || message?.role !== 'assistant') return null;
  const runId = String(message.runId || '');
  return !turn.runId || runId === turn.runId ? turn : null;
}

function applyThreadTurnStatus(thread = currentThread) {
  const turn = finalTurnStatus(thread);
  for (const item of timeline?.querySelectorAll('.message-item.assistant') || []) {
    applyAssistantTurnStatus(item, turn && (!turn.runId || item.dataset.runId === turn.runId) ? turn : null);
  }
}

function syncHeaderStatusVisibility() {
  statusNode.hidden = statusNode.textContent === 'done' && Boolean(archiveButton && !archiveButton.hidden);
}

function renderArchiveButton(thread = currentThread) {
  if (!archiveButton) return;
  archiveButton.hidden = !canArchiveThread(thread);
  archiveButton.disabled = false;
  archiveButton.textContent = 'archive';
  syncHeaderStatusVisibility();
}

function renderStopButton(thread = currentThread) {
  if (!stopButton) return;
  stopButton.hidden = !canStopThread(thread);
  stopButton.disabled = false;
  stopButton.textContent = 'stop';
}

function renderLifecycleButtons(thread = currentThread) {
  if (resumeButton) {
    resumeButton.hidden = !canResumeThread(thread);
    resumeButton.disabled = false;
    resumeButton.textContent = 'resume';
  }
  if (deleteButton) {
    deleteButton.hidden = !canDeleteThread(thread);
    deleteButton.disabled = false;
    deleteButton.textContent = 'delete';
  }
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
  const visible = name && name !== 'spanner';
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
  document.title = currentProjectName ? `${displayTitle} · ${currentProjectName} · Spanner` : `${displayTitle} · Spanner`;
  meta.textContent = '';
  const rawStatus = effectiveStatus(thread) || 'unknown';
  if (String(rawStatus).toLowerCase() !== 'running') {
    queuedSteeringCount = 0;
    queuedFollowUpCount = 0;
  }
  graphStatus = lifecycleCopy(thread);
  if (graphStatus === 'done') thinkingDetail.textContent = '';
  else if (!thinkingDetail.textContent) thinkingDetail.textContent = graphStatus;
  setStatus(graphStatus, statusTone(rawStatus), isActiveStatus(rawStatus));
  renderStopButton(thread);
  renderLifecycleButtons(thread);
  renderArchiveButton(thread);
  renderAgentGraph();
  renderSuggestedNextSteps(thread);
  renderComposerState(thread);
}

function timestampMs(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatElapsedMinutes(ms) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (!minutes) return `${remainingSeconds}s`;
  return remainingSeconds ? `${minutes} min ${remainingSeconds}s` : `${minutes} min`;
}

function runSummaryCopy(startMs, endMs = 0, status = '') {
  if (!startMs) return 'working';
  const active = isActiveStatus(status) && !endMs;
  return `${active ? 'working' : 'worked'} for ${formatElapsedMinutes((endMs || Date.now()) - startMs)}`;
}

function runSummaryDetailCopy(marker) {
  return marker?.detail && !marker.endMs && isActiveStatus(marker.status || runSummaryStatus) ? marker.detail : '';
}

function updateRunSummaryMarker(marker) {
  if (!marker?.button) return;
  marker.button.textContent = runSummaryCopy(marker.startMs, marker.endMs, marker.status);
  const detail = marker.button.parentElement?.querySelector('[data-run-summary-detail]');
  if (!detail) return;
  const copy = runSummaryDetailCopy(marker);
  detail.textContent = copy;
  detail.hidden = !copy;
}

function setRunSummaryDetail(text = '') {
  if (!activeRunSummaryMarker) return;
  activeRunSummaryMarker.detail = clamp(String(text || '').replace(/\s+/g, ' ').trim(), 180);
  updateRunSummaryMarker(activeRunSummaryMarker);
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
      <p class="run-summary-detail muted" data-run-summary-detail hidden></p>
    </div>
  `;
  const button = article.querySelector('.run-summary');
  const marker = { button, startMs, endMs, status, runId: String(runId || ''), detail: '' };
  button.addEventListener('click', () => toggleAgentActivity(article));
  updateRunSummaryMarker(marker);
  markTimelineEnter(article);
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

function restoreInitialThreadPosition() {
  if (initialResumeScrollDone || !timeline) return;
  const userMessages = timeline.querySelectorAll('.message-item.user');
  const target = userMessages[userMessages.length - 1];
  if (!target || (!timeline.querySelector('.message-item.assistant') && userMessages.length < 2)) return;
  initialResumeScrollDone = true;
  requestAnimationFrame(() => {
    const topbar = document.querySelector('.thread-main-header');
    const offset = Math.ceil(topbar?.getBoundingClientRect().height || 0) + 18;
    window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset), behavior: 'auto' });
  });
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
  const runId = workflowRunIdFromEvent(event);
  const target = toolTarget(event);
  return {
    kind,
    label: kind === 'workflow' ? String(scriptName || args.name || 'workflow') : String(rawLabel),
    runId,
    target,
    action: toolAction(event, target),
  };
}

function syncRunSummaryToolDetail(event = {}, detail = '') {
  if (event.type !== 'tool') {
    if (event.done || event.runStatus === 'completed' || event.runStatus === 'failed') setRunSummaryDetail('');
    return;
  }
  if (event.phase === 'end' || event.isError) {
    setRunSummaryDetail('');
    return;
  }
  const display = toolDisplay(event);
  setRunSummaryDetail(detail || display.action || display.label || event.toolName || 'tool');
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

  if (event.type === 'queue') return ['Queued messages', queueCountCopy().replace(/^ · /, '') || 'queue updated'];

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
    if (status === 'reconnecting') return ['Reconnecting', detail || 'reconnecting to live updates'];
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

function headerDetailCopy(headline, detail) {
  if (headline === 'Done' && !detail) return '';
  return detail ? `${headline} · ${detail}` : headline;
}

function setNow(event) {
  syncRunTiming(event);
  const [headline, detail] = activityCopy(event);
  syncRunSummaryToolDetail(event, detail);
  thinkingTitle.textContent = threadDisplayTitle();
  thinkingTitle.classList.toggle('is-active', isActiveEvent(event));
  thinkingDetail.textContent = headerDetailCopy(headline, detail);
  if (activityNote) activityNote.textContent = headerDetailCopy(headline, detail);
  if (event?.runStatus) {
    graphStatus = lifecycleCopy({ runStatus: event.runStatus });
    setStatus(graphStatus, statusTone(event.runStatus), isActiveEvent(event));
    renderAgentGraph();
  }
}

function workflowStateClass(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'done' || value === 'completed' || value === 'complete' || value === 'success') return 'done';
  if (value === 'error' || value === 'failed' || value === 'aborted') return 'error';
  if (value === 'skipped' || value === 'paused') return 'done';
  return 'running';
}

function workflowStepDone(agent) {
  return ['done', 'skipped', 'completed', 'complete', 'success'].includes(String(agent?.status || '').toLowerCase());
}

function workflowAgentSummary(agent) {
  return String(agent?.error || agent?.resultPreview || agent?.promptPreview || '').trim();
}

function workflowAgentGroups(run) {
  const agents = Array.isArray(run.agents) ? run.agents : [];
  const phases = Array.isArray(run.phases) && run.phases.length ? run.phases : [...new Set(agents.map((agent) => agent.phase || 'workflow'))];
  return phases.map((phase) => ({
    phase,
    agents: agents.filter((agent) => (agent.phase || 'workflow') === phase),
  })).filter((group) => group.agents.length || group.phase === run.currentPhase);
}

function workflowAgentNode(agent) {
  const agentState = workflowStateClass(agent.status);
  const summary = workflowAgentSummary(agent);
  return `<article class="workflow-view-node workflow-agent ${agentState}"><div class="workflow-node-top"><span>${escapeHtml(agent.label || 'agent')}</span><b>${escapeHtml(agent.status || 'queued')}</b></div>${summary ? `<small>${escapeHtml(summary)}</small>` : ''}</article>`;
}

function renderWorkflowRun(run) {
  const agents = Array.isArray(run.agents) ? run.agents : [];
  const state = workflowStateClass(run.status);
  const groups = workflowAgentGroups(run);
  const lanes = groups.map((group, index) => {
    const phaseDone = group.agents.filter(workflowStepDone).length;
    const phaseRunning = group.agents.filter((agent) => String(agent.status || '').toLowerCase() === 'running').length;
    return `<section class="workflow-lane"><div class="workflow-lane-head"><span><i>${index + 1}</i>${escapeHtml(group.phase)}</span><small>${phaseRunning ? `${phaseRunning} running` : `${phaseDone}/${group.agents.length} done`}</small></div><div class="workflow-agent-grid">${group.agents.map(workflowAgentNode).join('')}</div></section>`;
  }).join('');
  const flowHtml = lanes || '<p class="rail-empty">waiting for workflow journal</p>';

  return `<div class="workflow-map"><div class="workflow-map-head workflow-title ${state}"><span>${escapeHtml(run.workflowName || run.label || 'workflow')}</span></div><div class="workflow-flow">${flowHtml}</div></div>`;
}

function renderAgentGraph() {
  const runs = [...workflowRuns.values()];
  const workflowHtml = runs.map(renderWorkflowRun).join('');
  const agentCount = runs.reduce((sum, run) => sum + (Array.isArray(run.agents) ? run.agents.length : 0), 0);
  agentGraphCount.textContent = runs.length ? `${graphStatus} · ${agentCount || runs.length}` : graphStatus;
  agentGraph.innerHTML = `
    <div class="agent-node pi ${escapeHtml(graphStatus)}"><span>main agent</span><small>${escapeHtml(graphStatus)}</small></div>
    ${workflowHtml ? `<div class="agent-edge"></div><div class="subagent-stack workflow-agent-stack">${workflowHtml}</div>` : '<p class="rail-empty">workflow agents appear here when a workflow starts</p>'}
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

function diffTextForFile(file, payload = {}) {
  const text = file?.diff || fallbackDiffText(file);
  return `${text}${payload.truncated || file?.truncated ? '\n\n… changes truncated' : ''}`;
}

function fullDiffText(payload = {}) {
  const files = diffFileRows(payload);
  return payload.diff || files.map((file) => diffTextForFile(file, payload)).join('\n\n');
}

function changedLineCount(payload = {}) {
  const files = diffFileRows(payload);
  const text = files.length ? files.map((file) => diffTextForFile(file, payload)).join('\n') : payload.diff || '';
  return String(text).split('\n').reduce((count, line) => {
    if (!/^[+-]/.test(line) || /^(---\s|\+\+\+\s)/.test(line)) return count;
    return count + 1;
  }, 0);
}

function plural(count, singular) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function formatDiffSummary(payload = {}) {
  const files = diffFileRows(payload).length;
  return `${plural(files, 'file')} edited · ${plural(changedLineCount(payload), 'line')}`;
}

function isUnifiedDiff(text = '') {
  return /(^diff --git |^@@\s+-\d)/m.test(String(text));
}

function renderPlainDiff(node, text = '') {
  const pre = document.createElement('pre');
  pre.className = 'diff-plain-preview';
  pre.textContent = text;
  node.replaceChildren(pre);
}

async function renderFullDiffBody(text = '') {
  if (!diffDialogBody) return;
  diffDialogBody.textContent = 'Loading diff…';
  const truncated = /\n\n… changes truncated\s*$/.test(text);
  const diffText = truncated ? text.replace(/\n\n… changes truncated\s*$/, '') : text;
  if (!isUnifiedDiff(diffText)) {
    renderPlainDiff(diffDialogBody, text);
    return;
  }
  try {
    const Diff2Html = await import('diff2html');
    diffDialogBody.innerHTML = `${truncated ? '<p class="diff-truncated-warning">… changes truncated</p>' : ''}${Diff2Html.html(diffText, {
      colorScheme: 'dark',
      drawFileList: false,
      matching: 'lines',
      outputFormat: 'line-by-line',
    })}`;
  } catch {
    renderPlainDiff(diffDialogBody, text);
  }
}

function renderDiffDialog() {
  if (!diffDialog || !diffDialogTitle || !diffDialogFiles || !diffDialogBody || !lastDiffPayload) return;
  const files = diffFileRows(lastDiffPayload);
  const activeFile = files.find((file) => file.path === diffDialogPath);
  const activeText = diffDialogPath === '__all__' ? fullDiffText(lastDiffPayload) : diffTextForFile(activeFile || files[0], lastDiffPayload);
  diffDialogTitle.textContent = diffDialogPath === '__all__' ? 'Full diff' : activeFile?.path || files[0]?.path || 'Full diff';
  diffDialogFiles.replaceChildren();

  const addButton = (label, pathValue) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `diff-file${diffDialogPath === pathValue ? ' is-active' : ''}`;
    button.textContent = label;
    button.addEventListener('click', () => {
      diffDialogPath = pathValue;
      renderDiffDialog();
    });
    diffDialogFiles.append(button);
  };
  addButton(`all files · ${files.length}`, '__all__');
  files.forEach((file) => addButton(`${file.label || file.code || 'changed'} · ${file.path}`, file.path));
  void renderFullDiffBody(activeText);
}

function openDiffDialog(pathValue = '__all__') {
  if (!diffDialog || !lastDiffPayload) return;
  diffDialogPath = pathValue;
  renderDiffDialog();
  if (!diffDialog.open) diffDialog.showModal();
}

function renderDiffBox(payload = {}) {
  if (!diffBox || !diffCount) return;
  lastDiffPayload = payload;
  const files = diffFileRows(payload);
  diffBox.hidden = !files.length;
  const summary = formatDiffSummary(payload);
  diffCount.textContent = summary;
  diffBox.setAttribute('aria-label', `Open changes: ${summary}`);
}

async function refreshDiffBox() {
  if (!name || !diffBox) return;
  try {
    renderDiffBox(await fetchJson(`/api/threads/${encodeURIComponent(name)}/diff`));
  } catch (error) {
    lastDiffPayload = null;
    diffBox.hidden = false;
    diffCount.textContent = 'could not load';
    diffBox.setAttribute('aria-label', `Changes could not load: ${error.message}`);
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

    const preview = htmlPreviewDocument(note.html || '', currentPreviewTheme(), { resolveImageSrc: resolveHtmlPreviewImageSrc });
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
  markTimelineEnter(article);
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

function renderMessageAttachments(node, images = []) {
  node.querySelector('.message-attachments')?.remove();
  const sources = (Array.isArray(images) ? images : []).map(imageAttachmentSrc).filter(Boolean).slice(0, 4);
  if (!sources.length) return;

  const list = document.createElement('div');
  list.className = 'message-attachments';
  list.setAttribute('aria-label', `${sources.length} image${sources.length === 1 ? '' : 's'} attached`);
  sources.forEach((src, index) => {
    const img = document.createElement('img');
    img.className = 'message-attachment-image';
    img.src = src;
    img.alt = `attached image ${index + 1}`;
    img.loading = 'lazy';
    list.append(img);
  });
  node.append(list);
}

function fillComposerFromInteractiveAction({ prompt = '', delivery = 'followUp' } = {}) {
  if (!promptInput || !prompt) return;
  promptInput.value = prompt;
  nextSubmitDelivery = delivery === 'followUp' && canSendActiveDelivery() ? 'followUp' : 'auto';
  promptInput.focus();
  renderComposerState();
  setStatus('review interactive action, then send', 'info');
}

async function renderOpenUIArtifactsLazy(node, raw, onAction) {
  const hasOpenUI = extractOpenUIArtifacts(raw).length > 0;
  const hasRenderedOpenUI = Boolean(node.querySelector('.openui-artifacts'));
  if (!hasOpenUI && !hasRenderedOpenUI) return;
  const token = {};
  openUIRenderTokens.set(node, token);
  try {
    const { renderOpenUIArtifacts } = await import('./openui-renderer.jsx');
    if (openUIRenderTokens.get(node) === token) renderOpenUIArtifacts(node, raw, onAction);
  } catch (error) {
    console.error('Could not render OpenUI artifact.', error);
  }
}

function renderMessageBody(node, text, allowHtml = false, images = []) {
  const raw = String(text || '');
  const displayText = allowHtml ? stripOpenUIArtifactBlocks(stripInteractiveArtifactBlocks(raw)) : raw;
  const preview = allowHtml ? htmlPreviewDocument(displayText, currentPreviewTheme(), { resolveImageSrc: resolveHtmlPreviewImageSrc }) : '';
  const card = node.closest('.message-card');
  card?.classList.toggle('openui-rendered', allowHtml && extractOpenUIArtifacts(raw).length > 0);
  messageText.set(node, raw);

  if (!preview) {
    node.dataset.renderMode = 'text';
    card?.classList.remove('html-rendered');
    node.textContent = displayText;
    renderMessageAttachments(node, images);
    renderExcalidrawArtifacts(node, raw);
    renderHtmlArtifacts(node, raw);
    if (allowHtml) {
      renderInteractiveArtifacts(node, raw, fillComposerFromInteractiveAction);
      renderOpenUIArtifactsLazy(node, raw, fillComposerFromInteractiveAction);
    }
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
  renderMessageAttachments(node, images);
  renderExcalidrawArtifacts(node, raw, { skipImagePaths: htmlImageArtifactPaths(displayText) });
  renderHtmlArtifacts(node, raw);
  renderInteractiveArtifacts(node, raw, fillComposerFromInteractiveAction);
  renderOpenUIArtifactsLazy(node, raw, fillComposerFromInteractiveAction);
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

function appendMessage(role, label, text = '', images = [], options = {}) {
  const follow = shouldFollowLatest();
  const article = document.createElement('article');
  article.className = `timeline-item message-item ${role}`;
  if (options.runId) article.dataset.runId = String(options.runId);
  article.innerHTML = `
    <div class="timeline-dot" aria-hidden="true"></div>
    <div class="message-card">
      <div class="message-body" data-render-mode="text"></div>
    </div>
  `;
  const body = article.querySelector('.message-body');
  const card = article.querySelector('.message-card');
  if (role === 'assistant') card.append(makeCopyButton(() => messageText.get(body) || body.textContent || '', 'assistant message'));
  renderMessageBody(body, text, role === 'assistant', images);
  if (role === 'assistant') applyAssistantTurnStatus(article, options.turnStatus || null);
  markTimelineEnter(article);
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
      appendMessage('user', 'you', message.text, message.images, { runId });
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
      const item = activeAssistantBody.closest('.message-item.assistant');
      if (item && runId) item.dataset.runId = runId;
      renderMessageBody(activeAssistantBody, message.text, true);
      applyAssistantTurnStatus(item, turnStatusForMessage(message, thread));
      activeAssistantBody = null;
      rememberRenderedThreadMessage(message);
      followLatest(follow);
      continue;
    }

    if (runId && renderedAssistantRunIds.has(runId)) {
      rememberRenderedThreadMessage(message);
      continue;
    }

    appendMessage('assistant', 'main agent', message.text, [], { runId, turnStatus: turnStatusForMessage(message, thread) });
    rememberRenderedThreadMessage(message);
  }
  renderRunSummary();
  applyThreadTurnStatus(thread);
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
  appendMessage('user', 'you', prompt, [], { runId: currentRunId(thread) });
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
  if (!String(text || '').trim()) return;
  if (looksLikeLegacySystemDump(text) && appendParsedLogDump(text, { allowLeftovers: true })) return;
  if (appendParsedLogDump(text)) return;
  queueAssistantChunk(text);
  const runId = currentRunId(currentThread);
  if (runId) renderedAssistantRunIds.add(runId);
}

function workflowRunIdFromEvent(event = {}) {
  const explicit = event.workflowRunId || event.details?.runId;
  if (explicit) return String(explicit);
  const text = String([event.output, event.delta, event.text].filter(Boolean).join(' '));
  return text.match(/\brun-[a-z0-9-]+\b/i)?.[0] || text.match(/\bRun ID:\s*([a-z0-9][a-z0-9-]{2,100})\b/i)?.[1] || '';
}

function upsertWorkflowRun(runId, patch = {}) {
  if (!runId) return;
  const previous = workflowRuns.get(runId) || { runId, workflowName: 'workflow', status: 'running', phases: [], agents: [] };
  workflowRuns.set(runId, { ...previous, ...patch, runId });
  renderAgentGraph();
}

async function fetchWorkflowRun(runId) {
  const payload = await fetchJson(`/api/threads/${encodeURIComponent(name)}/workflows/${encodeURIComponent(runId)}`);
  upsertWorkflowRun(runId, payload);
  return payload;
}

function workflowRunIsActive(run) {
  return ['pending', 'running', 'unknown'].includes(String(run?.status || '').toLowerCase());
}

function scheduleWorkflowPolling() {
  if (workflowPollTimer || !name) return;
  const activeRunIds = [...workflowRuns.values()].filter(workflowRunIsActive).map((run) => run.runId);
  if (!activeRunIds.length) return;
  workflowPollTimer = window.setTimeout(async () => {
    workflowPollTimer = 0;
    await Promise.all(activeRunIds.map((runId) => fetchWorkflowRun(runId).catch(() => null)));
    scheduleWorkflowPolling();
  }, 1200);
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
  if (display.kind === 'workflow' && (display.runId || previous.runId)) {
    const runId = display.runId || previous.runId;
    upsertWorkflowRun(runId, { workflowName: label, status: state === 'error' ? 'failed' : 'running' });
    fetchWorkflowRun(runId).catch(() => null);
    scheduleWorkflowPolling();
  } else {
    renderAgentGraph();
  }
}

function updateAgentGraphForWorkflowEvent(event) {
  const runId = workflowRunIdFromEvent(event);
  const name = String(event.text || '').match(/Background workflow "([^"]+)" finished/)?.[1];
  if (runId) {
    upsertWorkflowRun(runId, {
      workflowName: name || workflowRuns.get(runId)?.workflowName || 'workflow',
      status: event.type === 'workflow_result' ? 'completed' : 'running',
    });
    fetchWorkflowRun(runId).catch(() => null);
    scheduleWorkflowPolling();
  } else {
    renderAgentGraph();
  }
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
    markTimelineEnter(article);
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

function thinkingTraceKey(event = {}) {
  const messageTimestamp = String(event.messageTimestamp || '').trim();
  if (!messageTimestamp) return traceRunKey(event);
  return `${traceRunKey(event)}:message:${messageTimestamp}:content:${event.contentIndex ?? 'thinking'}`;
}

function renderTimelineThinkingEvent(event) {
  if (!traceTimeline || !event.delta) return;
  const follow = shouldFollowTrace();
  const key = thinkingTraceKey(event);
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
    markTimelineEnter(article);
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
  markTimelineEnter(article);
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

function captureRunFinished(event = {}) {
  const runId = traceRunKey(event);
  if (!runId || capturedFinishedRuns.has(runId)) return;
  capturedFinishedRuns.add(runId);
  const status = event.runStatus === 'completed' ? 'completed' : event.runStatus === 'failed' ? 'failed' : 'unknown';
  const durationMs = runStartedAtMs ? Math.max(0, (runEndedAtMs || timestampMs(event.timestamp) || Date.now()) - runStartedAtMs) : null;
  captureSpannerEvent('run_finished', {
    status,
    duration_ms: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
  });
}

function renderEvent(event, { appendTranscript = false } = {}) {
  if (!event) return;
  updateLastEventId(event);
  if (event.type === 'usage') return;

  if (event.type === 'title' || event.type === 'answer_summary' || event.type === 'turn_status' || event.type === 'suggested_next_steps') {
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
    if (event.done || event.runStatus === 'completed' || event.runStatus === 'failed') captureRunFinished(event);
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
  if (event.type === 'queue') updateQueueState(event);
  setNow(event);

  if (event.type === 'thinking') {
    renderTimelineThinkingEvent(event);
  } else if (event.type === 'tool') {
    renderToolEvent(event);
  } else if (event.type === 'workflow_status' || event.type === 'workflow_result') {
    renderWorkflowEvent(event);
  } else if (!['log', 'status', 'metric', 'queue'].includes(event.type)) {
    const [headline, detail] = activityCopy(event);
    appendTimelineItem(event.type || 'event', headline, detail);
  }

  if (event.done || event.runStatus === 'completed' || event.runStatus === 'failed') {
    captureRunFinished(event);
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
  renderPiDefaults(payload.defaults || {});
  loadRunControls(payload.thread);
  renderThread(payload.thread);
  renderThreadHistory(payload.thread);
  renderInitialPrompt(payload.thread);
  return payload.thread;
}

function renderOutputPayload(payload = {}) {
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

async function loadOutput() {
  return renderOutputPayload(await fetchJson(`/api/sessions/${encodeURIComponent(name)}/output`));
}

async function loadThreadBootstrap() {
  if (!name) throw new Error('Missing main agent name.');
  const payload = await fetchJson(`/api/bootstrap?page=thread&fast=1&name=${encodeURIComponent(name)}`);
  renderProject(payload.provider);
  renderPiDefaults(payload.defaults || {});
  loadRunControls(payload.thread);
  renderThread(payload.thread);
  renderThreadHistory(payload.thread);
  renderInitialPrompt(payload.thread);
  return {
    thread: payload.thread,
    output: payload.output?.deferred ? payload.output : renderOutputPayload(payload.output || {}),
  };
}

function clearStreamReconnectNotice() {
  clearTimeout(streamReconnectNoticeTimer);
  streamReconnectNoticeTimer = 0;
}

function clearStreamFallbackPoll() {
  clearTimeout(streamFallbackPollTimer);
  streamFallbackPollTimer = 0;
}

function clearStreamRecoveryTimers() {
  clearStreamReconnectNotice();
  clearStreamFallbackPoll();
}

function closeActiveStream() {
  const stream = activeStream;
  activeStream = null;
  if (stream) {
    stream.onopen = null;
    stream.onmessage = null;
    stream.onerror = null;
    stream.close();
  }
  streamConnected = false;
  clearStreamRecoveryTimers();
}

function markStreamConnected() {
  streamConnected = true;
  clearStreamRecoveryTimers();
}

function finishStreamStatus(runStatus, session = null) {
  const status = String(runStatus || '').toLowerCase();
  closeActiveStream();
  if (session) {
    currentThread = { ...currentThread, ...session };
    renderThread(currentThread);
    renderThreadHistory(currentThread);
  }
  if (status !== 'completed' && status !== 'failed') {
    if (status) {
      currentThread = { ...currentThread, status, runStatus: status };
      renderThread(currentThread);
    } else {
      renderComposerState(currentThread);
    }
    return;
  }
  currentThread = { ...currentThread, status, runStatus: status };
  setStatus(status === 'completed' ? 'done' : 'failed', statusTone(status));
  renderStopButton(currentThread);
  renderLifecycleButtons(currentThread);
  renderArchiveButton(currentThread);
  scheduleDiffRefresh(0);
  submitInFlight = false;
  finalizeAssistantBody();
  activeAssistantBody = null;
  renderComposerState(currentThread);
}

async function pollStreamFallback() {
  streamFallbackPollTimer = 0;
  if (!activeStream || streamConnected) return;
  try {
    const payload = await loadOutput();
    clearStreamReconnectNotice();
    const status = payload.runStatus || payload.session?.runStatus || payload.session?.status;
    if (isClosedRunStatus(status)) {
      finishStreamStatus(status, payload.session);
      return;
    }
  } catch (error) {
    if (activeStream && !streamConnected) setStatus(error.message, 'error');
  }
  if (activeStream && !streamConnected && !streamFallbackPollTimer) {
    streamFallbackPollTimer = setTimeout(() => { void pollStreamFallback(); }, STREAM_FALLBACK_POLL_MS);
  }
}

function scheduleStreamRecovery() {
  if (!activeStream) return;
  if (!streamReconnectNoticeTimer) {
    streamReconnectNoticeTimer = setTimeout(() => {
      streamReconnectNoticeTimer = 0;
      if (activeStream && !streamConnected) {
        setNow({ type: 'status', runStatus: 'reconnecting', warning: 'reconnecting to live updates' });
      }
    }, STREAM_RECONNECT_NOTICE_MS);
  }
  if (!streamFallbackPollTimer) {
    streamFallbackPollTimer = setTimeout(() => { void pollStreamFallback(); }, STREAM_FALLBACK_INITIAL_POLL_MS);
  }
}

function streamRun() {
  closeActiveStream();
  activeStream = new EventSource(streamUrl(`/api/sessions/${encodeURIComponent(name)}/stream`, lastEventId), { withCredentials: true });

  activeStream.onopen = () => {
    markStreamConnected();
    if (String(effectiveStatus(currentThread) || '').toLowerCase() === 'running') {
      setNow({ type: 'status', runStatus: 'running', warning: 'streaming live updates' });
    }
  };

  activeStream.onmessage = (event) => {
    markStreamConnected();
    const payload = JSON.parse(event.data);
    if (payload.reset) {
      void loadOutput();
      updateLastEventId(payload);
      return;
    }
    renderEvent(payload, { appendTranscript: true });

    if (payload.done || isClosedRunStatus(payload.runStatus)) {
      const doneStatus = payload.runStatus || (payload.done ? 'failed' : '');
      finishStreamStatus(doneStatus, payload.session);
    }
  };

  activeStream.onerror = () => {
    if (!activeStream) return;
    streamConnected = false;
    scheduleStreamRecovery();
  };
}

getBrowserSessionId();
agentRail?.addEventListener('click', () => toggleAgentActivity());
agentRail?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleAgentActivity();
});
diffBox?.addEventListener('click', (event) => {
  event.stopPropagation();
  openDiffDialog('__all__');
});
diffDialogClose?.addEventListener('click', () => diffDialog?.close());
diffDialog?.addEventListener('click', (event) => {
  if (event.target === diffDialog) diffDialog.close();
});
agentActivityClose?.addEventListener('click', () => setAgentActivityOpen(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isAgentActivityOpen()) setAgentActivityOpen(false);
});
modelRefInput.addEventListener('change', saveRunControls);
thinkingLevelInput.addEventListener('input', () => {
  renderThinkingLevel();
  saveRunControls();
});
stopButton?.addEventListener('click', async () => {
  stopButton.disabled = true;
  stopButton.textContent = 'stopping…';
  setStatus('stopping', 'warning', true);
  try {
    const payload = await fetchJson(`/api/threads/${encodeURIComponent(name)}/stop`, { method: 'POST' });
    if (payload.thread) renderThread(payload.thread);
  } catch (error) {
    stopButton.disabled = false;
    stopButton.textContent = 'stop';
    setStatus(error.message, 'error');
  }
});

async function postLifecycleAction(button, route, busyCopy, statusCopy) {
  button.disabled = true;
  button.textContent = busyCopy;
  setStatus(statusCopy, 'warning', true);
  try {
    const payload = await fetchJson(`/api/threads/${encodeURIComponent(name)}/${route}`, { method: 'POST' });
    if (payload.thread) renderThread(payload.thread);
  } catch (error) {
    renderLifecycleButtons();
    setStatus(error.message, 'error');
  }
}

resumeButton?.addEventListener('click', () => {
  void postLifecycleAction(resumeButton, 'resume', 'resuming…', 'resuming');
});

deleteButton?.addEventListener('click', () => {
  if (!confirm('Back up, then delete this sandbox?')) return;
  void postLifecycleAction(deleteButton, 'delete', 'backing up…', 'backing_up');
});

archiveButton?.addEventListener('click', async () => {
  archiveButton.disabled = true;
  archiveButton.textContent = 'archiving…';
  try {
    await fetchJson(`/api/threads/${encodeURIComponent(name)}/archive`, { method: 'POST' });
    window.location.assign('/workspace.html');
  } catch (error) {
    archiveButton.disabled = false;
    archiveButton.textContent = 'archive';
    setStatus(error.message, 'error');
  }
});
nextStepsList?.addEventListener('click', (event) => {
  const button = event.target?.closest?.('[data-next-step-prompt]');
  if (!button) return;
  fillComposerFromInteractiveAction({ prompt: button.dataset.nextStepPrompt || '' });
  setStatus('review suggested prompt, then send', 'info');
});
imageInput?.addEventListener('change', () => updateImageStatus(imageInput, imageStatus));
bindImageDropZone(promptForm, imageInput, imageStatus);
promptInput?.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.key !== 'Enter' || !event.altKey || event.shiftKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  if (sendButton?.disabled) return;
  event.preventDefault();
  nextSubmitDelivery = 'followUp';
  promptForm.requestSubmit();
});
submitOnEnter(promptInput, promptForm, sendButton);
setAgentActivityOpen(false);
renderAgentGraph();
renderNotesRail();

promptForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const typedPrompt = promptInput.value.trim();
  const delivery = nextSubmitDelivery === 'followUp' ? 'followUp' : canSendActiveDelivery() ? 'steer' : 'auto';
  nextSubmitDelivery = 'auto';
  submitInFlight = true;
  renderComposerState();

  try {
    const images = await filesToImageAttachments(imageInputFiles(imageInput));
    const prompt = typedPrompt || (images.length ? 'Describe the attached image(s).' : '');
    if (!prompt) {
      submitInFlight = false;
      renderComposerState();
      return;
    }

    const submittedAtMs = Date.now();
    const submittedAt = new Date(submittedAtMs).toISOString();
    const activeDelivery = delivery !== 'auto';
    const runId = activeDelivery ? currentRunId(currentThread) || String(submittedAtMs) : String(submittedAtMs);
    if (activeDelivery) {
      finalizeAssistantBody();
      activeAssistantBody = null;
    }
    captureSpannerEvent('run_started', {
      delivery,
      has_images: images.length > 0,
      model_ref_set: Boolean(modelRefInput.value),
      thinking_level: thinkingLevelValue(),
    });
    appendMessage('user', 'you', imageAttachmentText(prompt, images.length), images);
    rememberRenderedThreadMessage({ role: 'user', text: prompt, images, timestamp: submittedAt, runId });
    if (!activeDelivery) activeRunSummaryMarker = appendRunSummaryMarker({ startMs: submittedAtMs, status: 'queued', runId });
    saveRunControls();
    promptInput.value = '';
    clearImageInput(imageInput);
    updateImageStatus(imageInput, imageStatus);
    if (!activeDelivery) renderSuggestedNextSteps({ ...currentThread, suggestedNextSteps: [] });
    if (!activeDelivery) renderEvent({ type: 'status', runStatus: 'queued', timestamp: new Date(submittedAtMs).toISOString(), submittedAtMs });

    const payload = await fetchJson(`/api/threads/${encodeURIComponent(name)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        delivery,
        submittedAtMs,
        clientId: getBrowserSessionId(),
        modelRef: modelRefInput.value,
        thinkingLevel: thinkingLevelValue(),
        images,
      }),
    });
    const returnedThread = payload.thread || payload.session;
    if (returnedThread) {
      renderThread(returnedThread);
      renderThreadHistory(returnedThread);
    }
    submitInFlight = false;
    renderComposerState(returnedThread || currentThread);
    streamRun();
  } catch (error) {
    renderEvent({ type: 'status', runStatus: 'failed', warning: error.message, timestamp: new Date().toISOString() });
    setStatus(error.message, 'error');
    submitInFlight = false;
    renderComposerState();
  }
});

try {
  const { thread, output } = await loadThreadBootstrap();
  restoreInitialThreadPosition();
  const status = output.runStatus || thread.runStatus;
  timelineEntriesCanAnimate = true;
  if (['launching', 'running', 'starting', 'queued'].includes(status)) streamRun();
  if (output.deferred) void loadOutput().catch((error) => setStatus(error.message, 'error'));
} catch (error) {
  renderEvent({ type: 'status', runStatus: 'failed', warning: error.message, timestamp: new Date().toISOString() });
  setStatus(error.message, 'error');
}
