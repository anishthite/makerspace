import { bindImageDropZone, clearImageInput, filesToImageAttachments, imageInputFiles, updateImageStatus } from './image-attachments.js';
import { submitOnEnter } from './submit-on-enter.js';

const PROJECT_KEY = 'spannerSelectedProject';
const RECENT_PROJECTS_KEY = 'spannerRecentProjects';
const MODEL_REF_KEY = 'spannerModelRef';
const THINKING_LEVEL_KEY = 'spannerThinkingLevel';
const PICK_NEW_PROJECT_VALUE = '__pick_new_project__';
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

let bound = false;
let runtimeFetchJson = null;
let defaultsPromise = null;
let defaultsLoaded = false;
let defaultThinkingLevel = 'xhigh';
let projectsPromise = null;
let projectsLoaded = false;
let sidebarProjects = [];
let selectedPromptProject = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^[\w.-]+\/[\w.-]+(?:\.git)?$/i.test(text)) return `https://github.com/${text.replace(/\.git$/i, '')}.git`;
  if (/^github\.com\//i.test(text)) return `https://${text.replace(/\.git$/i, '')}.git`;
  return text;
}

function readSelectedProject() {
  try {
    const project = JSON.parse(localStorage.getItem(PROJECT_KEY) || 'null');
    return project?.value ? project : null;
  } catch {
    return null;
  }
}

function readCachedRecentProjects() {
  try {
    const projects = JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) || '[]');
    return Array.isArray(projects) ? projects.filter((project) => project?.value).slice(0, 8) : [];
  } catch {
    return [];
  }
}

function writeSelectedProject(project) {
  if (!project?.value) return;
  localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
}

function sidebarProjectKey(project) {
  const value = cleanProjectValue(project?.value);
  if (!value) return '';
  const kind = project?.kind === 'local' || looksLikeLocalPath(value) ? 'local' : 'git';
  return `${kind}:${kind === 'git' ? value.replace(/\.git$/i, '').toLowerCase() : value}`;
}

function promptProjectCandidate(projects = sidebarProjects) {
  return selectedPromptProject || readSelectedProject() || projects.find((project) => project?.value) || null;
}

function normalizedSidebarProjects(projects = []) {
  const current = promptProjectCandidate(projects);
  const seen = new Set();
  return [current, ...projects].filter((project) => {
    const key = sidebarProjectKey(project);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function threadUrl(name) {
  return `/thread.html?${new URLSearchParams({ name })}`;
}

function normalizeThinkingLevel(value, fallback = '') {
  const level = String(value || '').trim().toLowerCase();
  return THINKING_LEVELS.includes(level) ? level : THINKING_LEVELS[Number(level)] || fallback;
}

function sidebarThinkingLevelValue() {
  const { thinking } = elements();
  return normalizeThinkingLevel(thinking?.value);
}

function promptRequestBody(project, prompt, controls = {}) {
  const localProject = project?.kind === 'local' || looksLikeLocalPath(project?.value);
  const sourceRepoPath = cleanProjectValue(project?.sourceRepoPath);
  const worktreePath = cleanProjectValue(project?.worktreePath);
  return {
    ...(localProject ? { repoPath: cleanProjectValue(project.value) } : { repoUrl: normalizeRepoUrl(project.value) }),
    branch: project?.branch || 'main',
    prompt,
    repoSource: localProject ? '' : project?.repoSource || 'github',
    ...(sourceRepoPath ? { sourceRepoPath } : {}),
    ...(worktreePath ? { worktreePath } : {}),
    ...(project?.reuseRepoPath ? { reuseRepoPath: true } : {}),
    modelRef: controls.modelRef || localStorage.getItem(MODEL_REF_KEY) || '',
    thinkingLevel: controls.thinkingLevel || localStorage.getItem(THINKING_LEVEL_KEY) || '',
    images: Array.isArray(controls.images) ? controls.images : [],
  };
}

function elements() {
  return {
    dialog: document.querySelector('#sidebar-prompt-lightbox'),
    form: document.querySelector('#sidebar-prompt-form'),
    prompt: document.querySelector('#sidebar-prompt'),
    project: document.querySelector('#sidebar-prompt-project'),
    projectSelect: document.querySelector('#sidebar-prompt-project-select'),
    status: document.querySelector('#sidebar-prompt-status'),
    submit: document.querySelector('#sidebar-prompt-submit'),
    close: document.querySelector('#sidebar-prompt-lightbox-close'),
    model: document.querySelector('#sidebar-model-ref'),
    thinking: document.querySelector('#sidebar-thinking-level'),
    thinkingOutput: document.querySelector('#sidebar-thinking-level-value'),
    imageTrigger: document.querySelector('#sidebar-prompt-images-trigger'),
    images: document.querySelector('#sidebar-prompt-images'),
    imageStatus: document.querySelector('#sidebar-prompt-image-status'),
    triggers: [...document.querySelectorAll('[data-sidebar-new-worktree], [data-sidebar-worktree-new-thread]')],
  };
}

function setTriggerExpanded(open) {
  for (const trigger of elements().triggers) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function isEditableShortcutTarget(target) {
  return target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName);
}

function isWebNewThreadShortcut(event) {
  return !event.repeat
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
    && String(event.key || '').toLowerCase() === 'n'
    && !isEditableShortcutTarget(event.target);
}

function openFromNewWorktreeShortcut() {
  const button = document.querySelector('[data-sidebar-new-worktree]');
  if (button) {
    button.click();
    return;
  }
  openSidebarPromptLightbox();
}

function bindNewThreadShortcuts() {
  globalThis.spannerDesktop?.onNewThreadShortcut?.(openFromNewWorktreeShortcut);
  document.addEventListener('keydown', (event) => {
    if (!isWebNewThreadShortcut(event)) return;
    event.preventDefault();
    openFromNewWorktreeShortcut();
  });
}

function renderSidebarThinkingLevel() {
  const { thinking, thinkingOutput } = elements();
  if (!thinking) return;
  const level = sidebarThinkingLevelValue() || defaultThinkingLevel || 'xhigh';
  const title = `Thinking: ${level}`;
  if (thinkingOutput) {
    thinkingOutput.textContent = level;
    thinkingOutput.title = title;
  }
  thinking.title = title;
}

function setSidebarThinkingLevel(value) {
  const { thinking } = elements();
  if (!thinking) return;
  const level = normalizeThinkingLevel(value, 'xhigh');
  thinking.value = level;
  thinking.dispatchEvent(new Event('change', { bubbles: true }));
  renderSidebarThinkingLevel();
}

function ensureSidebarModelOption(value) {
  const { model } = elements();
  const text = String(value || '').trim();
  if (!model || !text || Array.from(model.options).some((option) => option.value === text)) return;
  const option = document.createElement('option');
  option.value = text;
  option.textContent = text;
  model.append(option);
}

function setSidebarModelRef(value) {
  const { model } = elements();
  if (!model) return;
  const text = String(value || '').trim();
  ensureSidebarModelOption(text);
  model.value = text;
  model.dispatchEvent(new Event('change', { bubbles: true }));
}

function saveSidebarRunControls() {
  const { model } = elements();
  try {
    localStorage.setItem(MODEL_REF_KEY, String(model?.value || '').trim());
    localStorage.setItem(THINKING_LEVEL_KEY, sidebarThinkingLevelValue());
  } catch {}
}

function loadSidebarRunControls() {
  setSidebarModelRef(localStorage.getItem(MODEL_REF_KEY) || '');
  setSidebarThinkingLevel(localStorage.getItem(THINKING_LEVEL_KEY) || '');
}

function renderSidebarModelOptions(defaults = {}) {
  const { model: modelInput } = elements();
  if (!modelInput) return;
  const model = String(defaults.model || defaults.agent || 'main agent model').trim();
  const modelLabel = model === 'Pi default model' ? 'main agent model' : model;
  const selected = localStorage.getItem(MODEL_REF_KEY) || modelInput.value || '';
  const selectedValue = selected === model || selected === 'Pi default model' ? '' : selected;
  const values = [];
  const seen = new Set();

  for (const value of [...(Array.isArray(defaults.models) ? defaults.models : []), selectedValue]) {
    const text = String(value || '').trim();
    if (!text || text === model || text === modelLabel || text === 'Pi default model' || seen.has(text)) continue;
    seen.add(text);
    values.push(text);
  }

  const title = values.length
    ? `Model: ${modelLabel}\nOptions: ${values.join(', ')}`
    : `Model: ${modelLabel}`;
  modelInput.innerHTML = `<option value="">${escapeHtml(modelLabel)}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  modelInput.title = title;
  setSidebarModelRef(selectedValue);
}

function renderSidebarPiDefaults(defaults = {}) {
  defaultThinkingLevel = String(defaults.thinking || defaultThinkingLevel || 'xhigh').trim().toLowerCase();
  renderSidebarModelOptions(defaults);
  renderSidebarThinkingLevel();
}

function ensureSidebarDefaults() {
  if (defaultsLoaded || typeof runtimeFetchJson !== 'function') return defaultsPromise;
  if (defaultsPromise) return defaultsPromise;
  defaultsPromise = runtimeFetchJson('/api/bootstrap?page=workspace&fast=1')
    .then((payload) => {
      renderSidebarPiDefaults(payload?.defaults || {});
      defaultsLoaded = true;
    })
    .catch(() => {
      renderSidebarPiDefaults();
    })
    .finally(() => {
      defaultsPromise = null;
    });
  return defaultsPromise;
}

function renderProjectState() {
  const { project, projectSelect, submit, status } = elements();
  const selected = promptProjectCandidate();
  if (project) {
    project.textContent = selected?.value
      ? `Project: ${selectedProjectLabel(selected)}`
      : 'Choose a project first.';
    project.title = selected?.value || '';
  }
  if (projectSelect) {
    const index = sidebarProjects.findIndex((entry) => sidebarProjectKey(entry) === sidebarProjectKey(selected));
    projectSelect.value = index >= 0 ? String(index) : '';
    projectSelect.title = selected?.value || 'Choose a project for this agent';
  }
  if (submit) submit.disabled = !selected?.value;
  if (status && !selected?.value) status.textContent = 'Choose a project first.';
  return selected;
}

function renderSidebarProjectOptions(projects = sidebarProjects) {
  const { projectSelect } = elements();
  sidebarProjects = normalizedSidebarProjects(projects);
  if (!projectSelect) return;
  const placeholder = sidebarProjects.length ? '<option value="">choose project...</option>' : '<option value="">no recent projects</option>';
  const pickNewOption = `<option value="${PICK_NEW_PROJECT_VALUE}">pick new project...</option>`;
  projectSelect.innerHTML = `${placeholder}${sidebarProjects.map((project, index) => `<option value="${index}">${escapeHtml(selectedProjectLabel(project))}</option>`).join('')}${pickNewOption}`;
  projectSelect.disabled = false;
  renderProjectState();
}

function ensureSidebarProjects() {
  if (projectsLoaded || typeof runtimeFetchJson !== 'function') return projectsPromise;
  if (projectsPromise) return projectsPromise;
  projectsPromise = runtimeFetchJson('/api/recent-projects')
    .then((payload) => {
      renderSidebarProjectOptions(payload?.projects || []);
      projectsLoaded = true;
    })
    .catch(() => {
      renderSidebarProjectOptions(readCachedRecentProjects());
    })
    .finally(() => {
      projectsPromise = null;
    });
  return projectsPromise;
}

export function openSidebarPromptLightbox(projectOverride = null) {
  const { dialog, prompt, status, images, imageStatus } = elements();
  if (!dialog) return;
  selectedPromptProject = projectOverride?.value ? projectOverride : readSelectedProject();
  renderSidebarProjectOptions(readCachedRecentProjects());
  loadSidebarRunControls();
  const selected = renderProjectState();
  if (status && selected?.value) status.textContent = '';
  updateImageStatus(images, imageStatus);
  setTriggerExpanded(true);
  void ensureSidebarDefaults();
  void ensureSidebarProjects();
  try {
    dialog.showModal ? dialog.showModal() : dialog.setAttribute('open', '');
  } catch {}
  setTimeout(() => {
    if (dialog.open) prompt?.focus();
  }, 0);
}

function closeSidebarPromptLightbox() {
  const { dialog, form, status, prompt, images, imageStatus } = elements();
  setTriggerExpanded(false);
  if (dialog?.open) dialog.close?.();
  dialog?.removeAttribute('open');
  form?.reset();
  prompt?.removeAttribute('aria-invalid');
  clearImageInput(images);
  updateImageStatus(images, imageStatus);
  loadSidebarRunControls();
  if (status) status.textContent = '';
  selectedPromptProject = null;
  renderProjectState();
}

export function bindSidebarPromptLightbox({ fetchJson, makeThreadUrl = threadUrl, onCreated } = {}) {
  runtimeFetchJson = fetchJson || runtimeFetchJson;
  if (bound) return;

  const { dialog, form, close, prompt, projectSelect, model, thinking, imageTrigger, images, imageStatus, submit } = elements();
  if (!dialog || !form) return;
  bound = true;
  bindNewThreadShortcuts();
  loadSidebarRunControls();
  renderProjectState();

  close?.addEventListener('click', closeSidebarPromptLightbox);
  dialog.addEventListener('cancel', () => setTimeout(closeSidebarPromptLightbox, 0));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeSidebarPromptLightbox();
  });

  projectSelect?.addEventListener('change', () => {
    if (projectSelect.value === PICK_NEW_PROJECT_VALUE) {
      location.href = '/';
      return;
    }
    const index = projectSelect.value === '' ? -1 : Number(projectSelect.value);
    selectedPromptProject = Number.isInteger(index) && index >= 0 ? sidebarProjects[index] || null : null;
    if (!selectedPromptProject?.reuseRepoPath) writeSelectedProject(selectedPromptProject);
    renderProjectState();
    elements().prompt?.focus();
  });

  model?.addEventListener('change', saveSidebarRunControls);
  thinking?.addEventListener('change', () => {
    renderSidebarThinkingLevel();
    saveSidebarRunControls();
  });
  prompt?.addEventListener('input', () => {
    if (!prompt.value.trim()) return;
    prompt.removeAttribute('aria-invalid');
    const { status } = elements();
    if (status?.dataset.reason === 'empty-prompt') {
      status.textContent = '';
      delete status.dataset.reason;
    }
  });
  imageTrigger?.addEventListener('click', () => images?.click());
  images?.addEventListener('change', () => updateImageStatus(images, imageStatus));
  bindImageDropZone(form, images, imageStatus);
  submitOnEnter(prompt, form, submit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { prompt, status, submit, model: modelInput, images: imageInput, imageStatus: statusImages } = elements();
    const selected = renderProjectState();
    const promptText = String(prompt?.value || '').trim();
    if (!selected?.value) {
      if (status) status.textContent = 'Choose a project before running.';
      return;
    }
    if (!promptText) {
      prompt?.setAttribute('aria-invalid', 'true');
      if (status) {
        status.textContent = 'Tell the main agent what to do before starting.';
        status.dataset.reason = 'empty-prompt';
      }
      prompt?.focus();
      return;
    }
    if (typeof runtimeFetchJson !== 'function') {
      if (status) status.textContent = 'Prompt runtime is unavailable.';
      return;
    }
    saveSidebarRunControls();
    if (!selected.reuseRepoPath) writeSelectedProject(selected);
    if (submit) submit.disabled = true;
    if (status) status.textContent = 'Starting...';
    try {
      const images = await filesToImageAttachments(imageInputFiles(imageInput));
      const payload = await runtimeFetchJson('/api/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(promptRequestBody(selected, promptText, {
          modelRef: String(modelInput?.value || '').trim(),
          thinkingLevel: sidebarThinkingLevelValue(),
          images,
        })),
      });
      clearImageInput(imageInput);
      updateImageStatus(imageInput, statusImages);
      onCreated?.(payload);
      const name = payload?.thread?.name;
      if (name) location.href = makeThreadUrl(name);
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not start prompt.';
      if (submit) submit.disabled = false;
    }
  });
}
