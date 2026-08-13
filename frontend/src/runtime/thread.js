import { captureSpannerEvent } from '../lib/posthog.js';
import { redirectIfAuthRequired } from './auth-redirect.js';
import './appearance.js?v=palette-2';
import { htmlPreviewDocument } from './html-preview.js';
import { renderInteractiveArtifacts, stripInteractiveArtifactBlocks } from './interactive-artifacts.js';
import { openSafeLink, renderLinkedText } from './link-rendering.js';
import { extractOpenUIArtifacts, stripOpenUIArtifactBlocks } from './openui-artifacts.js';
import { submitOnEnter } from './submit-on-enter.js';
import { bindImageDropZone, clearImageInput, filesToImageAttachments, imageAttachmentSrc, imageAttachmentText, imageInputFiles, updateImageStatus } from './image-attachments.js';
import { implementationNoteFromToolEvent, implementationNotesFromToolEvent } from './implementation-notes.js';
import { diagramImageArtifactPaths, excalidrawArtifactPaths, htmlArtifactPaths, htmlImageArtifactPaths, isRenderableHtmlArtifactPath, normalizeDiagramImageArtifactPath, normalizeHtmlArtifactPath } from './excalidraw-artifacts.js';
import { startGlobalSidebar } from './global-sidebar.js';

const BROWSER_SESSION_KEY = 'spannerBrowserSession';
const MODEL_REF_KEY = 'spannerModelRef';
const THINKING_LEVEL_KEY = 'spannerThinkingLevel';
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const ARCHIVEABLE_THREAD_STATUSES = ['completed', 'ready', 'failed'];
const COPY_FEEDBACK_MS = 1200;
const PHOSPHOR_COPY_ICON = '<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path d="M216,34H88a6,6,0,0,0-6,6V82H40a6,6,0,0,0-6,6V216a6,6,0,0,0,6,6H168a6,6,0,0,0,6-6V174h42a6,6,0,0,0,6-6V40A6,6,0,0,0,216,34ZM162,210H46V94H162Zm48-48H174V88a6,6,0,0,0-6-6H94V46H210Z" /></svg><span class="sr-only">copy</span>';
const MAX_INLINE_EXCALIDRAW_ARTIFACTS = 3;
const MAX_INLINE_DIAGRAM_IMAGE_ARTIFACTS = 4;
const MAX_INLINE_HTML_ARTIFACTS = 2;
const THREAD_STATUS_POLL_MS = 5000;

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
const archiveButtonContent = archiveButton?.firstElementChild?.cloneNode(true) || null;
const timeline = document.querySelector('#timeline');
const traceTimeline = document.querySelector('#trace-timeline');
const agentRail = document.querySelector('#agent-rail');
const agentActivity = document.querySelector('#agent-trace');
const agentActivityClose = document.querySelector('#agent-activity-close');
const agentGraph = document.querySelector('#agent-graph');
const agentGraphCount = document.querySelector('#agent-graph-count');
const todoRail = document.querySelector('#todo-rail');
const todoCount = document.querySelector('#todo-count');
const todoList = document.querySelector('#todo-list');
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
const sendButtonIcon = sendButton?.querySelector('svg')?.cloneNode(true) || null;
const thinkingTitle = document.querySelector('#thinking-title');
const thinkingDetail = document.querySelector('#thinking-detail');
const diffBox = document.querySelector('#diff-box');
const diffCount = document.querySelector('#diff-count');
const diffDialog = document.querySelector('#diff-dialog');
const diffDialogTitle = document.querySelector('#diff-dialog-title');
const diffDialogFiles = document.querySelector('#diff-dialog-files');
const diffDialogBody = document.querySelector('#diff-dialog-body');
const diffDialogClose = document.querySelector('#diff-dialog-close');

startGlobalSidebar({ statusNode });

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
const toolEventSnapshots = new Map();
let currentTodoState = null;
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
let diffRenderVersion = 0;
let diffRefreshTimer = null;
let assistantChunkBuffer = '';
let assistantChunkFrame = 0;
let assistantChunkShouldFollow = false;
let submitInFlight = false;
let nextSubmitDelivery = 'auto';
let queuedSteeringCount = 0;
let queuedFollowUpCount = 0;
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

function normalizeThinkingLevel(value, fallback = '') {
  const level = String(value || '').trim().toLowerCase();
  return THINKING_LEVELS.includes(level) ? level : THINKING_LEVELS[Number(level)] || fallback;
}

function thinkingLevelValue() {
  return normalizeThinkingLevel(thinkingLevelInput.value);
}

function renderThinkingLevel() {
  const level = thinkingLevelValue();
  const label = level || defaultThinkingLevel || 'xhigh';
  const title = `Thinking: ${label}`;
  if (thinkingLevelOutput) {
    thinkingLevelOutput.textContent = label;
    thinkingLevelOutput.title = title;
  }
  thinkingLevelInput.title = title;
}

function setThinkingLevel(value) {
  const level = normalizeThinkingLevel(value, 'xhigh');
  thinkingLevelInput.value = level;
  thinkingLevelInput.dispatchEvent(new Event('change', { bubbles: true }));
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
  modelRefInput.dispatchEvent(new Event('change', { bubbles: true }));
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

function htmlArtifactUrl(artifactPath, options = {}) {
  const url = new URL(apiUrl(`/api/threads/${encodeURIComponent(name)}/artifacts/html`), location.origin);
  url.searchParams.set('path', artifactPath);
  url.searchParams.set('browserSession', getBrowserSessionId());
  if (options.interactive) url.searchParams.set('interactive', '1');
  return url.toString();
}

function htmlArtifactStateUrl(artifactPath, stateKey = 'default') {
  const url = new URL(`/api/threads/${encodeURIComponent(name)}/artifacts/state`, location.origin);
  url.searchParams.set('path', artifactPath);
  url.searchParams.set('key', stateKey || 'default');
  url.searchParams.set('browserSession', getBrowserSessionId());
  return `${url.pathname}${url.search}`;
}

function localHtmlArtifactPathFromHref(href) {
  const raw = String(href || '').trim();
  const sameOrigin = raw.startsWith(location.origin) ? raw.slice(location.origin.length) : raw;
  const path = normalizeHtmlArtifactPath(sameOrigin.replace(/^\/+/, ''));
  return path && isRenderableHtmlArtifactPath(path) ? path : '';
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

const HTML_ARTIFACT_PASSIVE_SANDBOX = '';
const HTML_ARTIFACT_INTERACTIVE_SANDBOX = 'allow-scripts allow-forms allow-pointer-lock allow-popups allow-modals';

function focusHtmlArtifactFrame(frame) {
  try {
    frame.focus({ preventScroll: true });
    frame.contentWindow?.focus();
  } catch {}
}

function setHtmlArtifactFrameMode(frame, artifactPath, interactive = false) {
  frame.dataset.interactive = interactive ? 'true' : 'false';
  frame.classList.toggle('is-interactive', interactive);
  frame.tabIndex = interactive ? 0 : -1;
  frame.allow = interactive ? 'fullscreen; pointer-lock' : '';
  frame.setAttribute('sandbox', interactive ? HTML_ARTIFACT_INTERACTIVE_SANDBOX : HTML_ARTIFACT_PASSIVE_SANDBOX);
  frame.src = htmlArtifactUrl(artifactPath, { interactive });
  if (interactive) requestAnimationFrame(() => focusHtmlArtifactFrame(frame));
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
  const controls = document.createElement('span');
  controls.className = 'html-artifact-controls';
  const link = document.createElement('a');
  link.href = htmlArtifactUrl(artifactPath, { interactive: true });
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'open';
  const interact = document.createElement('button');
  interact.type = 'button';
  interact.className = 'html-artifact-interact';
  interact.textContent = 'interact';
  interact.title = 'Trust this artifact for pointer, wheel, keyboard, and networked demo input.';
  controls.append(link, interact);
  head.append(title, controls);

  const frame = document.createElement('iframe');
  frame.className = 'html-artifact-frame';
  frame.title = `HTML artifact preview: ${artifactPath}`;
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer';
  frame.dataset.artifactPath = artifactPath;
  frame.addEventListener('load', () => { if (frame.dataset.interactive === 'true') focusHtmlArtifactFrame(frame); });
  frame.addEventListener('pointerenter', () => { if (frame.dataset.interactive === 'true') focusHtmlArtifactFrame(frame); });
  interact.addEventListener('click', () => {
    card.classList.add('is-interactive');
    interact.disabled = true;
    interact.textContent = 'interactive';
    interact.setAttribute('aria-pressed', 'true');
    setHtmlArtifactFrameMode(frame, artifactPath, true);
  });
  setHtmlArtifactFrameMode(frame, artifactPath);

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

function effectiveStatus(thread) {
  const runStatus = String(thread?.runStatus || '').toLowerCase();
  return runStatus && runStatus !== 'unknown' ? thread.runStatus : thread?.status;
}

function isActiveStatus(status) {
  return ['launching', 'running', 'queued', 'starting', 'reconnecting'].includes(String(status || '').toLowerCase());
}

function isTerminalStatus(status) {
  return ['completed', 'ready', 'failed'].includes(String(status || '').toLowerCase());
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
    const label = activeDelivery ? 'steer agent' : 'send message';
    if (sendButtonIcon) sendButton.replaceChildren(sendButtonIcon.cloneNode(true));
    else sendButton.textContent = activeDelivery ? 'steer' : 'send';
    sendButton.setAttribute('aria-label', label);
    sendButton.title = label;
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

function renderArchiveButtonContent(label = 'Archive thread') {
  if (!archiveButton) return;
  archiveButton.setAttribute('aria-label', label);
  archiveButton.title = label;
  if (archiveButtonContent) archiveButton.replaceChildren(archiveButtonContent.cloneNode(true));
  else archiveButton.textContent = 'archive';
}

function renderArchiveButton(thread = currentThread) {
  if (!archiveButton) return;
  archiveButton.hidden = !canArchiveThread(thread);
  archiveButton.disabled = false;
  renderArchiveButtonContent();
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
  syncTodoStateFromThread(thread);
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
  if (!timeline) return;
  requestAnimationFrame(() => {
    const userMessages = timeline.querySelectorAll('.message-item.user');
    const target = userMessages[userMessages.length - 1];
    const hasAssistantTurn = Boolean(timeline.querySelector('.message-item.assistant'));
    const hasTerminalSinglePrompt = userMessages.length === 1 && isTerminalStatus(effectiveStatus(currentThread));
    if (!target || (!hasAssistantTurn && userMessages.length < 2 && !hasTerminalSinglePrompt)) return;
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
  if (event.historical) {
    return [
      'history',
      event.id || '',
      event.timestamp || '',
      event.type || '',
      event.runId || event.bridgeRunId || '',
      event.toolCallId || '',
      event.phase || '',
    ].join(':');
  }
  if (event.id) return `id:${event.id}`;
  fallbackEventId += 1;
  return `fallback:${fallbackEventId}`;
}

function updateLastEventId(event) {
  if (event?.historical) return;
  const id = Number(event?.id);
  if (Number.isFinite(id) && id > lastEventId) lastEventId = id;
}

function resetThreadStreamState() {
  // ponytail: server run ids restart each run; per-run client cursor is enough.
  lastEventId = 0;
  fallbackEventId = 0;
  seenEvents.clear();
  toolEventSnapshots.clear();
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

function todoToolName(event = {}) {
  return String(event.toolName || '').toLowerCase().split('.').pop();
}

function normalizeTodoStatus(value) {
  const status = String(value || '').toLowerCase();
  return ['pending', 'in_progress', 'completed', 'deleted'].includes(status) ? status : 'pending';
}

function normalizeTodoTask(task = {}) {
  const id = Number(task.id);
  const subject = clamp(String(task.subject || task.text || task.title || '').replace(/\s+/g, ' ').trim(), 220);
  if (!Number.isFinite(id) || id <= 0 || !subject) return null;
  return {
    id,
    subject,
    status: normalizeTodoStatus(task.status || (task.done ? 'completed' : 'pending')),
    description: task.description ? clamp(String(task.description).replace(/\s+/g, ' ').trim(), 400) : '',
    activeForm: task.activeForm ? clamp(String(task.activeForm).replace(/\s+/g, ' ').trim(), 160) : '',
    blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy.map(Number).filter(Number.isFinite) : [],
    owner: task.owner ? clamp(String(task.owner).replace(/\s+/g, ' ').trim(), 120) : '',
  };
}

function normalizeTodoState(value = {}) {
  const rawTasks = Array.isArray(value.tasks) ? value.tasks : Array.isArray(value.todos) ? value.todos : null;
  if (!rawTasks) return null;
  return {
    tasks: rawTasks.map(normalizeTodoTask).filter(Boolean),
    nextId: Number.isFinite(Number(value.nextId)) ? Number(value.nextId) : undefined,
    updatedAt: String(value.updatedAt || ''),
  };
}

function todoStateFromEvent(event = {}) {
  if (event.type !== 'tool' || event.phase !== 'end' || todoToolName(event) !== 'todo') return null;
  return normalizeTodoState(event.details || {});
}

function visibleTodoTasks(state = {}) {
  return (Array.isArray(state.tasks) ? state.tasks : [])
    .filter((task) => task.status !== 'deleted')
    .sort((left, right) => left.id - right.id);
}

function todoTaskHtml(task) {
  const active = task.status === 'in_progress' && task.activeForm ? `<small>${escapeHtml(task.activeForm)}</small>` : '';
  return `<article class="todo-item ${escapeHtml(task.status)}"><span class="todo-dot" aria-hidden="true"></span><div><strong>#${escapeHtml(task.id)} ${escapeHtml(task.subject)}</strong>${active}</div></article>`;
}

function renderTodoRail(state = currentTodoState) {
  if (!todoRail || !todoCount || !todoList) return;
  const tasks = visibleTodoTasks(state || {});
  todoRail.hidden = !tasks.length;
  if (!tasks.length) {
    todoCount.textContent = '0/0';
    todoList.innerHTML = '';
    return;
  }
  const done = tasks.filter((task) => task.status === 'completed').length;
  todoCount.textContent = `${done}/${tasks.length}`;
  const shown = tasks.slice(0, 8).map(todoTaskHtml).join('');
  const remaining = tasks.length > 8 ? `<p class="todo-more">+${tasks.length - 8} more</p>` : '';
  todoList.innerHTML = `${shown}${remaining}`;
}

function setTodoState(state) {
  currentTodoState = normalizeTodoState(state || {}) || null;
  renderTodoRail(currentTodoState);
}

function syncTodoStateFromThread(thread = {}) {
  if (!Object.prototype.hasOwnProperty.call(thread, 'todoState')) return;
  setTodoState(thread.todoState || { tasks: [] });
}

function syncTodoStateFromEvent(event = {}) {
  const state = todoStateFromEvent(event);
  if (state) setTodoState(state);
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

const PIERRE_DIFF_CSS = `
:host {
  --diffs-font-family: var(--mono);
  --diffs-header-font-family: var(--diffs-font-family);
  --diffs-font-size: 13px;
  --diffs-line-height: 22px;
  --diffs-gap-block: 7px;
  --diffs-bg: #0a0a0a;
  --diffs-bg-context-override: #0a0a0a;
  --diffs-bg-context-gutter-override: #0a0a0a;
  --diffs-bg-separator-override: #0a0a0a;
  --diffs-bg-deletion-override: rgb(239 68 68 / .14);
  --diffs-bg-addition-override: rgb(34 197 94 / .14);
  --diffs-bg-deletion-emphasis-override: rgb(239 68 68 / .24);
  --diffs-bg-addition-emphasis-override: rgb(34 197 94 / .24);
  --diffs-deletion-color-override: #f87171;
  --diffs-addition-color-override: #4ade80;
  --diffs-fg-number-override: rgb(115 115 115 / .78);
}
[data-diffs-header="default"] {
  min-height: 36px;
  padding-inline: 0;
  border: 0;
  background: transparent;
}
[data-header-content] { gap: 8px; }
[data-title] { color: #e5e5e5; font-weight: 700; }
[data-metadata] { font-size: 11px; font-weight: 700; }
[data-separator-wrapper] { background: #0a0a0a; color: rgb(163 163 163 / .46); }
[data-code] { scrollbar-color: rgb(115 115 115 / .46) transparent; }
[data-column-number] { padding-left: 1.5ch; padding-right: 1ch; }
[data-line] { padding-inline: 1.35ch; }
[data-line-type="change-deletion"], [data-line-type="change-addition"] { box-shadow: inset 3px 0 0 currentColor; }
`;

async function renderFullDiffBody(text = '') {
  if (!diffDialogBody) return;
  const renderVersion = ++diffRenderVersion;
  diffDialogBody.textContent = 'Loading diff…';
  const truncated = /\n\n… changes truncated\s*$/.test(text);
  const diffText = truncated ? text.replace(/\n\n… changes truncated\s*$/, '') : text;
  if (!isUnifiedDiff(diffText)) {
    renderPlainDiff(diffDialogBody, text);
    return;
  }
  try {
    const { FileDiff, processPatch } = await import('@pierre/diffs');
    if (renderVersion !== diffRenderVersion) return;
    const files = processPatch(diffText.endsWith('\n') ? diffText : `${diffText}\n`, undefined, true).files;
    if (!files.length) {
      renderPlainDiff(diffDialogBody, text);
      return;
    }
    const list = document.createElement('div');
    list.className = 'pierre-diff-list';
    if (truncated) {
      const warning = document.createElement('p');
      warning.className = 'diff-truncated-warning';
      warning.textContent = '… changes truncated';
      list.append(warning);
    }
    for (const fileDiff of files) {
      const section = document.createElement('section');
      section.className = 'pierre-diff-file';
      list.append(section);
      // ponytail: FileDiff owns syntax highlighting and its shadow-DOM grid; CodeView can replace this if huge diffs lag.
      new FileDiff({ diffStyle: 'unified', disableFileHeader: files.length === 1, lineDiffType: 'word', overflow: 'scroll', themeType: 'dark', unsafeCSS: PIERRE_DIFF_CSS }).render({ fileDiff, containerWrapper: section });
    }
    diffDialogBody.replaceChildren(list);
  } catch {
    if (renderVersion === diffRenderVersion) renderPlainDiff(diffDialogBody, text);
  }
}

function renderDiffDialog() {
  if (!diffDialog || !diffDialogTitle || !diffDialogFiles || !diffDialogBody || !lastDiffPayload) return;
  const files = diffFileRows(lastDiffPayload);
  const showFileRail = files.length > 1;
  const activeFile = files.find((file) => file.path === diffDialogPath);
  const activeText = diffDialogPath === '__all__' ? fullDiffText(lastDiffPayload) : diffTextForFile(activeFile || files[0], lastDiffPayload);
  diffDialog.classList.toggle('has-file-rail', showFileRail);
  diffDialogFiles.hidden = !showFileRail;
  diffDialogTitle.textContent = diffDialogPath === '__all__' && showFileRail ? 'Full diff' : activeFile?.path || files[0]?.path || 'Full diff';
  diffDialogFiles.replaceChildren();

  const addButton = (label, pathValue) => {
    const active = diffDialogPath === pathValue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `diff-file${active ? ' is-active' : ''}`;
    if (active) button.setAttribute('aria-current', 'true');
    button.textContent = label;
    button.addEventListener('click', () => {
      diffDialogPath = pathValue;
      renderDiffDialog();
    });
    diffDialogFiles.append(button);
  };
  if (showFileRail) {
    addButton('All', '__all__');
    files.forEach((file) => addButton(file.path, file.path));
  }
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
  notesList.closest('.notes-main')?.toggleAttribute('hidden', !notes.length);

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
    renderLinkedText(node, displayText);
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
  if (event.traceToolKey) return event.traceToolKey;
  const runId = workflowRunIdFromEvent(event);
  const traceRunId = traceRunKey(event);
  const toolName = String(event.toolName || event.label || 'tool').toLowerCase().split('.').pop();
  if (toolName === 'todo') return `${traceRunId}:todo`;
  if (event.toolCallId) return event.toolCallId;
  if (runId && /workflow/i.test(`${event.toolName || ''} ${event.label || ''}`)) return `workflow:${runId}`;
  const args = event.args && typeof event.args === 'object' ? event.args : null;
  const argsKey = args ? JSON.stringify(Object.keys(args).sort().map((key) => [key, args[key]])) : '';
  return `${traceRunId}:${toolName}:${argsKey || event.id || event.timestamp || graphTools.size}`;
}

function mergeToolEvent(event = {}) {
  const key = toolKey(event);
  const previous = toolEventSnapshots.get(key) || {};
  const currentArgs = event.args && typeof event.args === 'object' ? event.args : {};
  const currentDetails = event.details && typeof event.details === 'object' ? event.details : {};
  const hasResult = Object.hasOwn(event, 'result') && event.result !== undefined && event.result !== null;
  const hasOutput = Object.hasOwn(event, 'output') && event.output !== undefined && event.output !== null;
  const merged = {
    ...previous,
    ...event,
    traceToolKey: key,
    args: { ...(previous.args || {}), ...currentArgs },
    details: { ...(previous.details || {}), ...currentDetails },
    result: hasResult ? event.result : previous.result,
    output: hasOutput ? event.output : '',
    delta: Object.hasOwn(event, 'delta') ? event.delta : '',
    label: event.label || previous.label,
    toolName: event.toolName || previous.toolName,
    isError: typeof event.isError === 'boolean' ? event.isError : Boolean(previous.isError),
  };
  toolEventSnapshots.set(key, merged);
  return merged;
}

function normalizedToolName(event = {}) {
  return String(event.toolName || event.label || 'tool').toLowerCase().split('.').pop();
}

function toolUiKind(event = {}) {
  const toolName = normalizedToolName(event);
  if (toolName === 'bash') return 'bash';
  if (toolName === 'edit' || toolName === 'write') return 'edit';
  if (toolName === 'read') return 'read';
  if (toolName === 'workflow') return 'workflow';
  if (toolName === 'todo') return 'todo';
  if (toolName === 'ask_user_question') return 'question';
  if (toolName === 'request_approval' || toolName === 'approval') return 'approval';
  if (toolName.includes('grep') || ['find_files', 'web_search', 'code_search', 'fetch_content'].includes(toolName)) return 'search';
  return 'tool';
}

const TRACE_ICON_PATHS = {
  tool: 'M226.76,69a8,8,0,0,0-12.84-2.88l-40.3,37.19-17.23-3.7-3.7-17.23,37.19-40.3A8,8,0,0,0,187,29.24,72,72,0,0,0,88,96,72.34,72.34,0,0,0,94,124.94L33.79,177c-.15.12-.29.26-.43.39a32,32,0,0,0,45.26,45.26c.13-.13.27-.28.39-.42L131.06,162A72,72,0,0,0,232,96,71.56,71.56,0,0,0,226.76,69ZM160,152a56.14,56.14,0,0,1-27.07-7,8,8,0,0,0-9.92,1.77L67.11,211.51a16,16,0,0,1-22.62-22.62L109.18,133a8,8,0,0,0,1.77-9.93,56,56,0,0,1,58.36-82.31l-31.2,33.81a8,8,0,0,0-1.94,7.1L141.83,108a8,8,0,0,0,6.14,6.14l26.35,5.66a8,8,0,0,0,7.1-1.94l33.81-31.2A56.06,56.06,0,0,1,160,152Z',
  search: 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm88,104a87.62,87.62,0,0,1-6.4,32.94l-44.7-27.49a15.92,15.92,0,0,0-6.24-2.23l-22.82-3.08a16.11,16.11,0,0,0-16,7.86h-8.72l-3.8-7.86a15.91,15.91,0,0,0-11-8.67l-8-1.73L96.14,104h16.71a16.06,16.06,0,0,0,7.73-2l12.25-6.76a16.62,16.62,0,0,0,3-2.14l26.91-24.34A15.93,15.93,0,0,0,166,49.1l-.36-.65A88.11,88.11,0,0,1,216,128ZM143.31,41.34,152,56.9,125.09,81.24,112.85,88H96.14a16,16,0,0,0-13.88,8l-8.73,15.23L63.38,84.19,74.32,58.32a87.87,87.87,0,0,1,69-17ZM40,128a87.53,87.53,0,0,1,8.54-37.8l11.34,30.27a16,16,0,0,0,11.62,10l21.43,4.61L96.74,143a16.09,16.09,0,0,0,14.4,9h1.48l-7.23,16.23a16,16,0,0,0,2.86,17.37l.14.14L128,205.94l-1.94,10A88.11,88.11,0,0,1,40,128Zm102.58,86.78,1.13-5.81a16.09,16.09,0,0,0-4-13.9,1.85,1.85,0,0,1-.14-.14L120,174.74,133.7,144l22.82,3.08,45.72,28.12A88.18,88.18,0,0,1,142.58,214.78Z',
  edit: 'M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z',
  bash: 'M128,128a8,8,0,0,1-3,6.25l-40,32a8,8,0,1,1-10-12.5L107.19,128,75,102.25a8,8,0,1,1,10-12.5l40,32A8,8,0,0,1,128,128Zm48,24H136a8,8,0,0,0,0,16h40a8,8,0,0,0,0-16Zm56-96V200a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56ZM216,200V56H40V200H216Z',
  approval: 'M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0ZM82.34,141.66a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32l-56,56a8,8,0,0,1-11.32,0Z',
  read: 'M181.66,146.34a8,8,0,0,1,0,11.32l-24,24a8,8,0,0,1-11.32-11.32L164.69,152l-18.35-18.34a8,8,0,0,1,11.32-11.32Zm-72-24a8,8,0,0,0-11.32,0l-24,24a8,8,0,0,0,0,11.32l24,24a8,8,0,0,0,11.32-11.32L91.31,152l18.35-18.34A8,8,0,0,0,109.66,122.34ZM216,88V216a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V40A16,16,0,0,1,56,24h96a8,8,0,0,1,5.66,2.34l56,56A8,8,0,0,1,216,88Zm-56-8h28.69L160,51.31Zm40,136V96H152a8,8,0,0,1-8-8V40H56V216H200Z',
  workflow: 'M200,48H136V16a8,8,0,0,0-16,0V48H56A32,32,0,0,0,24,80V192a32,32,0,0,0,32,32H200a32,32,0,0,0,32-32V80A32,32,0,0,0,200,48Zm16,144a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V80A16,16,0,0,1,56,64H200a16,16,0,0,1,16,16Zm-52-56H92a28,28,0,0,0,0,56h72a28,28,0,0,0,0-56Zm-24,16v24H116V152ZM80,164a12,12,0,0,1,12-12h8v24H92A12,12,0,0,1,80,164Zm84,12h-8V152h8a12,12,0,0,1,0,24ZM72,108a12,12,0,1,1,12,12A12,12,0,0,1,72,108Zm88,0a12,12,0,1,1,12,12A12,12,0,0,1,160,108Z',
  thinking: 'M43.18,128a29.78,29.78,0,0,1,8,10.26c4.8,9.9,4.8,22,4.8,33.74,0,24.31,1,36,24,36a8,8,0,0,1,0,16c-17.48,0-29.32-6.14-35.2-18.26-4.8-9.9-4.8-22-4.8-33.74,0-24.31-1-36-24-36a8,8,0,0,1,0-16c23,0,24-11.69,24-36,0-11.72,0-23.84,4.8-33.74C50.68,38.14,62.52,32,80,32a8,8,0,0,1,0,16C57,48,56,59.69,56,84c0,11.72,0,23.84-4.8,33.74A29.78,29.78,0,0,1,43.18,128ZM240,120c-23,0-24-11.69-24-36,0-11.72,0-23.84-4.8-33.74C205.32,38.14,193.48,32,176,32a8,8,0,0,0,0,16c23,0,24,11.69,24,36,0,11.72,0,23.84,4.8,33.74a29.78,29.78,0,0,0,8,10.26,29.78,29.78,0,0,0-8,10.26c-4.8,9.9-4.8,22-4.8,33.74,0,24.31-1,36-24,36a8,8,0,0,0,0,16c17.48,0,29.32-6.14,35.2-18.26,4.8-9.9,4.8-22,4.8-33.74,0-24.31,1-36,24-36a8,8,0,0,0,0-16Z',
  complete: 'M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z',
};

function traceIconHtml(kind = 'tool', className = 'trace-icon') {
  const resolvedKind = kind === 'question' ? 'approval' : kind === 'todo' ? 'complete' : kind;
  const path = TRACE_ICON_PATHS[resolvedKind] || TRACE_ICON_PATHS.tool;
  return `<svg class="${className}" data-trace-icon="${escapeHtml(kind)}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>`;
}

function toolKindLabel(kind, event = {}, display = toolDisplay(event)) {
  if (kind === 'bash') return 'Bash';
  if (kind === 'edit') return normalizedToolName(event) === 'write' ? 'Write' : 'Edit';
  if (kind === 'read') {
    const lineCount = Number(event.args?.limit);
    return Number.isFinite(lineCount) && lineCount > 0 ? `Read ${lineCount} lines` : 'Read';
  }
  if (kind === 'search') {
    const toolName = normalizedToolName(event);
    if (toolName === 'web_search') return 'Web Search';
    if (toolName === 'code_search') return 'Code Search';
    if (toolName === 'fetch_content') return 'Fetch';
    if (toolName.includes('grep')) return 'Search';
    return 'Find';
  }
  if (kind === 'approval') return 'Approval';
  if (kind === 'question') return 'Question';
  if (kind === 'todo') return 'Todo';
  return display.label || event.label || event.toolName || 'Tool';
}

function toolResultText(event = {}) {
  const result = event.result;
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    if (Array.isArray(result.content)) {
      const text = result.content
        .map((part) => part?.type === 'text' ? String(part.text || '') : '')
        .filter(Boolean)
        .join('\n');
      if (text) return text;
    }
    for (const key of ['output', 'text', 'summary', 'message', 'error']) {
      if (typeof result[key] === 'string' && result[key].trim()) return result[key];
    }
  }
  return String(event.output || event.resultText || '').trim();
}

function toolJson(value) {
  if (value === undefined || value === null || value === '') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function basename(value = '') {
  return String(value || '').split(/[\\/]/).filter(Boolean).pop() || String(value || '');
}

function compactToolChip(value = '', max = 56) {
  return clamp(String(value || '').replace(/\s+/g, ' ').trim(), max);
}

function toolChipHtml(label, className = 'tool-chip', max = 180) {
  const fullText = String(label || '').replace(/\s+/g, ' ').trim();
  const text = compactToolChip(fullText, max);
  return text ? `<span class="${className}" title="${escapeHtml(fullText)}">${escapeHtml(text)}</span>` : '';
}

function toolSummaryPillsHtml(event = {}, display = toolDisplay(event), kind = toolUiKind(event)) {
  const args = event.args && typeof event.args === 'object' ? event.args : {};
  const chips = [];
  if (kind === 'bash' && args.command) chips.push(toolChipHtml(String(args.command).split(/\r?\n/)[0], 'tool-command-pill'));
  if (kind === 'edit' && display.target) chips.push(toolChipHtml(display.target, 'tool-file-pill'));
  if (kind === 'read' && display.target) chips.push(toolChipHtml(display.target, 'tool-file-pill'));
  if (kind === 'search' && display.target) chips.push(toolChipHtml(display.target, 'tool-query-pill'));
  if (event.result?.additions || event.result?.deletions) {
    chips.push(`<span class="tool-diff-stat"><b>+${escapeHtml(event.result.additions || 0)}</b><em>-${escapeHtml(event.result.deletions || 0)}</em></span>`);
  }
  return chips.join('');
}

function toolOutputText(event = {}, accumulatedOutput = '') {
  return String(accumulatedOutput || toolResultText(event) || '').trim();
}

function toolMetaRowsHtml(rows = []) {
  const visible = rows.filter(([, value]) => String(value ?? '').trim());
  if (!visible.length) return '';
  return `<dl class="tool-meta-grid">${visible.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
}

function toolPreHtml(text = '', className = 'tool-output-block') {
  return String(text || '').trim() ? `<pre class="${className}" data-tool-output>${escapeHtml(clamp(text, 8000))}</pre>` : '<pre data-tool-output hidden></pre>';
}

function toolDiffRowsHtml(text = '') {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim()).slice(0, 80);
  if (!lines.length) return '';
  const rows = lines.map((line, index) => {
    const type = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : 'ctx';
    return `<div class="tool-diff-row is-${type}"><span>${index + 1}</span><code>${escapeHtml(line)}</code></div>`;
  }).join('');
  return `<div class="tool-diff-viewer" aria-label="Patch preview">${rows}</div>`;
}

function toolSearchRowsHtml(event = {}, outputText = '') {
  const args = event.args && typeof event.args === 'object' ? event.args : {};
  const result = event.result && typeof event.result === 'object' ? event.result : {};
  const rawSources = [
    ...(Array.isArray(result.sources) ? result.sources : []),
    ...(Array.isArray(result.urls) ? result.urls : []),
    ...(Array.isArray(args.urls) ? args.urls : []),
  ];
  const outputRows = outputText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4);
  const rows = (rawSources.length ? rawSources : outputRows).slice(0, 6);
  return rows.map((source) => `
    <div class="tool-search-result-row">
      <strong>${escapeHtml(toolKindLabel('search', event))}</strong>
      <code>${escapeHtml(compactToolChip(source, 180))}</code>
    </div>
  `).join('');
}

function renderToolDetailHtml(event = {}, display = toolDisplay(event), kind = toolUiKind(event), accumulatedOutput = '') {
  const args = event.args && typeof event.args === 'object' ? event.args : {};
  const outputText = toolOutputText(event, accumulatedOutput);

  if (kind === 'bash') {
    const command = String(args.command || display.target || display.action || 'command');
    return `
      <div class="tool-terminal" aria-label="Terminal output">
        <pre data-tool-output>&gt; ${escapeHtml(command)}
${outputText ? `\n${escapeHtml(clamp(outputText, 8000))}` : '\nwaiting for output...'}</pre>
      </div>
    `;
  }

  if (kind === 'edit') {
    const patch = String(event.details?.patch || event.details?.diff || event.result?.diff || outputText || '').trim();
    const operation = normalizedToolName(event) === 'write' ? 'write file' : args.operation || 'edit file';
    return `
      ${toolMetaRowsHtml([
        ['file', display.target || args.path || args.file_path || args.file || args.filename],
        ['operation', operation],
        ['changed', event.result?.changed ? `${event.result.changed} file` : ''],
      ])}
      ${toolDiffRowsHtml(patch)}
      ${patch ? '' : toolPreHtml(toolJson(event.result || args), 'tool-output-block')}
    `;
  }

  if (kind === 'search') {
    const query = display.target || args.query || args.url || args.glob || args.constraints || outputText || 'search';
    return `
      <div class="tool-search-results" aria-label="Search results">
        <div class="tool-search-result-card"><p>${escapeHtml(`${toolKindLabel(kind, event)} completed for: ${compactToolChip(query, 220)}`)}</p></div>
        ${toolSearchRowsHtml(event, outputText)}
      </div>
    `;
  }

  if (kind === 'read') {
    return `
      <div class="tool-read-card">
        <strong>${escapeHtml(basename(display.target || args.path || args.file || 'file'))}</strong>
        <span>${escapeHtml(display.target || args.path || args.file || '')}</span>
      </div>
      ${toolPreHtml(outputText || toolJson(event.result), 'tool-output-block')}
    `;
  }

  if (kind === 'approval' || kind === 'question') {
    return `
      <div class="tool-approval-panel">
        <strong>${escapeHtml(args.action || args.question || display.action || toolKindLabel(kind, event))}</strong>
        <div><button type="button" disabled>allow once</button><button type="button" disabled>decline</button></div>
      </div>
      ${toolPreHtml(toolJson(event.result || event.details || args), 'tool-output-block')}
    `;
  }

  if (kind === 'todo') return '<pre data-tool-output hidden></pre>';

  return `
    <div class="tool-json-grid">
      <div><span>args</span>${toolPreHtml(toolJson(args), 'tool-output-block')}</div>
      <div><span>result</span>${toolPreHtml(outputText || toolJson(event.result || event.details), 'tool-output-block')}</div>
    </div>
  `;
}

function shouldOpenToolCard(kind, state, detailHtml = '') {
  return false;
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

function settleTraceRun() {
  for (const card of toolCards.values()) card.open = false;
}

function renderTimelineToolEvent(event) {
  if (!traceTimeline) return;
  const follow = shouldFollowTrace();
  const key = toolKey(event);
  const display = toolDisplay(event);
  const kind = toolUiKind(event);
  const state = event.isError ? 'error' : event.phase === 'end' ? 'done' : 'running';
  let node = toolCards.get(key);
  const isNewNode = !node;

  if (!node) {
    const article = document.createElement('article');
    article.className = `timeline-item tool-item ${display.kind === 'workflow' ? 'workflow-item' : ''}`;
    article.innerHTML = `
      <div class="timeline-dot" aria-hidden="true"></div>
      <details class="tool-card trace-tool-card is-${escapeHtml(kind)} ${display.kind === 'workflow' ? 'workflow-card' : ''}" data-tool-kind="${escapeHtml(kind)}">
        <summary>
          <span class="tool-kind-mark" aria-hidden="true">${traceIconHtml(kind)}</span>
          <span data-tool-label></span>
          <span class="tool-target" data-tool-action></span>
          <span class="tool-summary-pills" data-tool-pills></span>
          <span class="badge"></span>
        </summary>
        <div class="tool-detail" data-tool-detail><pre data-tool-output hidden></pre></div>
      </details>
    `;
    markTimelineEnter(article);
    traceTimeline.append(article);
    node = article.querySelector('.tool-card');
    toolCards.set(key, node);
  }

  const action = display.action || node.dataset.toolAction || '';
  if (display.action) node.dataset.toolAction = display.action;
  node.querySelector('[data-tool-label]').textContent = toolKindLabel(kind, event, display);
  node.querySelector('.tool-kind-mark').innerHTML = traceIconHtml(kind);
  node.querySelector('[data-tool-action]').textContent = ['tool', 'workflow'].includes(kind) ? action : '';
  node.querySelector('[data-tool-pills]').innerHTML = toolSummaryPillsHtml(event, display, kind);
  node.querySelector('.badge').textContent = state === 'error' ? 'failed' : state;
  node.dataset.phase = event.phase || '';
  node.dataset.state = state;
  node.dataset.toolKind = kind;
  const output = toolTimelineOutput(event);
  if (event.phase === 'end' && output) {
    node.dataset.toolOutputText = clamp(output, 8000);
  } else if (event.phase === 'update' && output) {
    const previous = node.dataset.toolOutputText || '';
    node.dataset.toolOutputText = clamp(`${previous}${output}`, 8000);
  }
  const detailHtml = renderToolDetailHtml(event, display, kind, node.dataset.toolOutputText || '');
  node.querySelector('[data-tool-detail]').innerHTML = detailHtml;
  if (isNewNode) node.open = shouldOpenToolCard(kind, state, detailHtml);

  followTraceLatest(follow);
}

function toolTimelineOutput(event = {}) {
  if (todoToolName(event) === 'todo') return '';
  if (event.phase === 'update') return String(event.delta || event.output || '');
  if (event.phase === 'end') return toolResultText(event);
  return '';
}

function traceRunKey(event = {}) {
  return String(event.runId || event.bridgeRunId || event.submittedAtMs || currentRunId(currentThread) || 'latest');
}

function normalizeTraceText(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\*\*(.*?)\*\*$/, '$1').replace(/\*\*([^*]+)\*\*/g, '$1'))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderThinkingBody(body, text = '') {
  if (!body) return;
  const parts = normalizeTraceText(text).split(/\n{2,}/).map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  body.replaceChildren();
  for (const part of parts) {
    const paragraph = document.createElement('p');
    paragraph.textContent = part;
    body.append(paragraph);
  }
}

function renderTimelineThinkingEvent(event) {
  const text = normalizeTraceText(event.delta || event.text);
  if (!traceTimeline || !text) return;
  const follow = shouldFollowTrace();
  const article = document.createElement('article');
  article.className = 'timeline-item thinking-item';
  article.innerHTML = '<div class="thinking-card"><div class="thinking-body"></div></div>';
  markTimelineEnter(article);
  renderThinkingBody(article.querySelector('.thinking-body'), text);
  traceTimeline.append(article);
  followTraceLatest(follow);
}

function renderTimelineSummaryEvent(event) {
  const summary = String(event.summary || event.session?.finalAnswerSummary || '').replace(/\s+/g, ' ').trim();
  if (!traceTimeline || !summary) return;
  const follow = shouldFollowTrace();
  settleTraceRun(event);
  const article = document.createElement('article');
  article.className = 'timeline-item summary-item';
  article.innerHTML = `
    <div class="timeline-dot" aria-hidden="true"></div>
    <div class="timeline-card">
      <strong class="trace-summary-title">${traceIconHtml('complete')}<span>summary</span></strong>
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
  const mergedEvent = mergeToolEvent(event);
  updateAgentGraphForTool(mergedEvent);
  syncTodoStateFromEvent(mergedEvent);
  renderImplementationNoteEvent(mergedEvent);
  renderTimelineToolEvent(mergedEvent);
  scheduleDiffRefresh(mergedEvent.phase === 'end' ? 250 : 900);
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
    if (appendTranscript && !event.historical) appendAssistantChunk(event.chunk);
    if (event.done || event.runStatus === 'completed' || event.runStatus === 'failed') {
      settleTraceRun(event);
      captureRunFinished(event);
    }
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
    settleTraceRun(event);
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

async function refreshTerminalThreadStatus() {
  if (!name || activeStream || document.visibilityState !== 'visible' || !isTerminalStatus(effectiveStatus(currentThread))) return;
  const { thread } = await fetchJson(`/api/threads/${encodeURIComponent(name)}`);
  if (!thread) return;
  renderThread(thread);
  renderThreadHistory(thread);
  if (isActiveStatus(effectiveStatus(thread))) {
    resetThreadStreamState();
    streamRun();
  }
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

function streamRun() {
  if (activeStream) activeStream.close();
  activeStream = new EventSource(streamUrl(`/api/sessions/${encodeURIComponent(name)}/stream`, lastEventId), { withCredentials: true });

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
      renderStopButton(currentThread);
      renderLifecycleButtons(currentThread);
      renderArchiveButton(currentThread);
      scheduleDiffRefresh(0);
      submitInFlight = false;
      finalizeAssistantBody();
      activeAssistantBody = null;
      renderComposerState(currentThread);
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
diffBox?.addEventListener('click', (event) => {
  event.stopPropagation();
  openDiffDialog('__all__');
});
diffDialogClose?.addEventListener('click', () => diffDialog?.close());
diffDialog?.addEventListener('click', (event) => {
  if (event.target === diffDialog) diffDialog.close();
});
timeline?.addEventListener('click', (event) => {
  const link = event.target?.closest?.('a.rendered-link');
  if (!link || !timeline.contains(link)) return;
  if (link.dataset.linkKind === 'local') {
    const artifactPath = name ? localHtmlArtifactPathFromHref(link.getAttribute('href')) : '';
    if (!artifactPath) return;
    event.preventDefault();
    location.assign(htmlArtifactUrl(artifactPath, { interactive: true }));
    return;
  }
  event.preventDefault();
  void openSafeLink(link.getAttribute('href'));
});
agentActivityClose?.addEventListener('click', () => setAgentActivityOpen(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isAgentActivityOpen()) setAgentActivityOpen(false);
});
modelRefInput.addEventListener('change', saveRunControls);
thinkingLevelInput.addEventListener('change', () => {
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
  renderArchiveButtonContent('Archiving thread');
  try {
    await fetchJson(`/api/threads/${encodeURIComponent(name)}/archive`, { method: 'POST' });
    window.location.assign('/workspace.html');
  } catch (error) {
    renderArchiveButton();
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
    if (!activeDelivery) resetThreadStreamState();
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

// ponytail: terminal-only poll avoids a second push channel; active runs still use SSE.
setInterval(() => { void refreshTerminalThreadStatus().catch(() => {}); }, THREAD_STATUS_POLL_MS);

try {
  const { thread, output } = await loadThreadBootstrap();
  restoreInitialThreadPosition();
  const status = output.runStatus || thread.runStatus;
  timelineEntriesCanAnimate = true;
  if (['launching', 'running', 'starting', 'queued'].includes(status)) streamRun();
  if (output.deferred) {
    void loadOutput()
      .then(() => restoreInitialThreadPosition())
      .catch((error) => setStatus(error.message, 'error'));
  }
} catch (error) {
  renderEvent({ type: 'status', runStatus: 'failed', warning: error.message, timestamp: new Date().toISOString() });
  setStatus(error.message, 'error');
}
