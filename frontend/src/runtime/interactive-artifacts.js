const FENCE_RE = /```makerspace-ui\s*\n?([\s\S]*?)```/gi;
const CONTROL_TYPES = new Set(['slider', 'checklist', 'select', 'radio', 'text']);
const DELIVERY_TYPES = new Set(['auto', 'followUp', 'steer']);
const MAX_ARTIFACTS = 3;
const MAX_CONTROLS = 12;
const MAX_ACTIONS = 8;
const MAX_ITEMS = 16;
const MAX_TEXT = 1000;
const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;

function shortText(value, max = MAX_TEXT) {
  return String(value ?? '').trim().slice(0, max);
}

function validId(value) {
  const id = shortText(value, 40);
  return ID_RE.test(id) ? id : '';
}

function optionItem(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = shortText(value, 120);
    return text ? { value: text, label: text } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const itemValue = shortText(value.value, 120);
  const label = shortText(value.label || itemValue, 160);
  return itemValue && label ? { value: itemValue, label } : null;
}

function optionList(value, key = 'options') {
  const source = Array.isArray(value?.[key]) ? value[key] : Array.isArray(value) ? value : [];
  return source.map(optionItem).filter(Boolean).slice(0, MAX_ITEMS);
}

function clampNumber(value, fallback, min = -100000, max = 100000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeControl(control) {
  if (!control || typeof control !== 'object') return null;
  const id = validId(control.id);
  const type = shortText(control.type, 24);
  const label = shortText(control.label || id, 160);
  if (!id || !CONTROL_TYPES.has(type) || !label) return null;

  const base = {
    id,
    type,
    label,
    help: shortText(control.help, 240),
  };

  if (type === 'slider') {
    const min = clampNumber(control.min, 0);
    const max = clampNumber(control.max, 10);
    if (max <= min) return null;
    const step = clampNumber(control.step, 1, 0.000001, Math.max(1, max - min));
    const fallback = min <= 0 && max >= 0 ? 0 : min;
    const defaultValue = clampNumber(control.default ?? control.value, fallback, min, max);
    return { ...base, min, max, step, default: defaultValue };
  }

  if (type === 'select' || type === 'radio') {
    const options = optionList(control, 'options');
    if (!options.length) return null;
    const defaultValue = shortText(control.default ?? options[0].value, 120);
    return { ...base, options, default: options.some((item) => item.value === defaultValue) ? defaultValue : options[0].value };
  }

  if (type === 'checklist') {
    const items = optionList(control, 'items');
    if (!items.length) return null;
    const defaults = new Set((Array.isArray(control.default) ? control.default : []).map((item) => shortText(item, 120)));
    return { ...base, items, default: items.filter((item) => defaults.has(item.value)).map((item) => item.value) };
  }

  if (type === 'text') {
    return {
      ...base,
      default: shortText(control.default ?? control.value, 500),
      placeholder: shortText(control.placeholder, 160),
      multiline: Boolean(control.multiline),
    };
  }

  return null;
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object') return null;
  const id = validId(action.id);
  const label = shortText(action.label || id, 80);
  const prompt = shortText(action.prompt, 2000);
  const delivery = shortText(action.delivery || 'followUp', 16);
  if (!id || !label || !prompt || !DELIVERY_TYPES.has(delivery)) return null;
  return { id, label, prompt, delivery };
}

export function validateInteractiveArtifact(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Number(value.version) !== 1) return null;
  const title = shortText(value.title || 'Interactive controls', 160);
  const controls = (Array.isArray(value.controls) ? value.controls : []).map(normalizeControl).filter(Boolean).slice(0, MAX_CONTROLS);
  const actions = (Array.isArray(value.actions) ? value.actions : []).map(normalizeAction).filter(Boolean).slice(0, MAX_ACTIONS);
  if (!title || !actions.length) return null;
  return {
    version: 1,
    title,
    description: shortText(value.description, 300),
    controls,
    actions,
  };
}

export function extractInteractiveArtifacts(value) {
  const text = String(value || '');
  const artifacts = [];
  for (const match of text.matchAll(FENCE_RE)) {
    if (artifacts.length >= MAX_ARTIFACTS) break;
    try {
      const artifact = validateInteractiveArtifact(JSON.parse(match[1].trim()));
      if (artifact) artifacts.push({ artifact, start: match.index, end: match.index + match[0].length });
    } catch {
      // Invalid model-authored JSON stays visible as plain text.
    }
  }
  return artifacts;
}

export function stripInteractiveArtifactBlocks(value) {
  const text = String(value || '');
  const matches = extractInteractiveArtifacts(text);
  if (!matches.length) return text;
  let output = '';
  let offset = 0;
  for (const match of matches) {
    let start = match.start;
    let end = match.end;
    if (text[start - 1] === '\n' && text[end] === '\n') end += 1;
    else if (text[start - 1] === '\n') start -= 1;
    output += text.slice(offset, Math.max(offset, start));
    offset = end;
  }
  return `${output}${text.slice(offset)}`.replace(/\n{3,}/g, '\n\n').trim();
}

function formatValue(value) {
  return Array.isArray(value) ? value.join(', ') : String(value ?? '');
}

export function actionPrompt(action, values = {}) {
  const body = String(action?.prompt || '').replace(/{{\s*([a-zA-Z][a-zA-Z0-9_-]{0,39})\s*}}/g, (_match, key) => formatValue(values[key]));
  const label = shortText(action?.label || action?.id || 'Action', 80);
  return `[UI action: ${label}]\n${body}`.trim();
}

function appendHelp(container, control) {
  if (!control.help) return;
  const help = document.createElement('p');
  help.className = 'interactive-control-help';
  help.textContent = control.help;
  container.append(help);
}

function renderControl(control, key) {
  const field = document.createElement('div');
  field.className = `interactive-control interactive-control-${control.type}`;
  const label = document.createElement('label');
  label.className = 'interactive-control-label';
  label.textContent = control.label;
  field.append(label);

  if (control.type === 'slider') {
    const row = document.createElement('div');
    row.className = 'interactive-slider-row';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
    input.value = String(control.default);
    const output = document.createElement('output');
    output.textContent = input.value;
    input.addEventListener('input', () => { output.textContent = input.value; });
    row.append(input, output);
    field.append(row);
    appendHelp(field, control);
    return { field, getValue: () => input.value };
  }

  if (control.type === 'select') {
    const select = document.createElement('select');
    control.options.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      option.selected = item.value === control.default;
      select.append(option);
    });
    field.append(select);
    appendHelp(field, control);
    return { field, getValue: () => select.value };
  }

  if (control.type === 'radio') {
    const group = document.createElement('div');
    group.className = 'interactive-choice-list';
    control.options.forEach((item, index) => {
      const choice = document.createElement('label');
      choice.className = 'interactive-choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `${key}-${control.id}`;
      input.value = item.value;
      input.checked = item.value === control.default || (!control.default && index === 0);
      choice.append(input, document.createTextNode(item.label));
      group.append(choice);
    });
    field.append(group);
    appendHelp(field, control);
    return { field, getValue: () => group.querySelector('input:checked')?.value || '' };
  }

  if (control.type === 'checklist') {
    const defaults = new Set(control.default || []);
    const group = document.createElement('div');
    group.className = 'interactive-choice-list';
    control.items.forEach((item) => {
      const choice = document.createElement('label');
      choice.className = 'interactive-choice';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = item.value;
      input.checked = defaults.has(item.value);
      choice.append(input, document.createTextNode(item.label));
      group.append(choice);
    });
    field.append(group);
    appendHelp(field, control);
    return { field, getValue: () => [...group.querySelectorAll('input:checked')].map((input) => input.value) };
  }

  const input = control.multiline ? document.createElement('textarea') : document.createElement('input');
  if (!control.multiline) input.type = 'text';
  input.value = control.default || '';
  input.placeholder = control.placeholder || '';
  field.append(input);
  appendHelp(field, control);
  return { field, getValue: () => input.value };
}

function renderArtifact({ artifact }, index, onAction) {
  const card = document.createElement('article');
  card.className = 'interactive-artifact-card';

  const head = document.createElement('div');
  head.className = 'interactive-artifact-head';
  const title = document.createElement('strong');
  title.textContent = artifact.title;
  const badge = document.createElement('span');
  badge.textContent = 'interactive';
  head.append(title, badge);
  card.append(head);

  if (artifact.description) {
    const description = document.createElement('p');
    description.className = 'interactive-artifact-description';
    description.textContent = artifact.description;
    card.append(description);
  }

  const getters = new Map();
  if (artifact.controls.length) {
    const controls = document.createElement('div');
    controls.className = 'interactive-controls';
    artifact.controls.forEach((control) => {
      const rendered = renderControl(control, `interactive-${index}`);
      getters.set(control.id, rendered.getValue);
      controls.append(rendered.field);
    });
    card.append(controls);
  }

  const actions = document.createElement('div');
  actions.className = 'interactive-actions';
  artifact.actions.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'interactive-action-button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      const values = Object.fromEntries([...getters].map(([id, getValue]) => [id, getValue()]));
      onAction?.({ artifact, action, values, prompt: actionPrompt(action, values), delivery: action.delivery });
    });
    actions.append(button);
  });
  card.append(actions);
  return card;
}

export function renderInteractiveArtifacts(node, rawText, onAction) {
  node.querySelector('.interactive-artifacts')?.remove();
  const artifacts = extractInteractiveArtifacts(rawText);
  if (!artifacts.length) return;

  const section = document.createElement('section');
  section.className = 'interactive-artifacts';
  section.setAttribute('aria-label', 'Interactive assistant controls');
  artifacts.forEach((entry, index) => section.append(renderArtifact(entry, index, onAction)));
  node.append(section);
}
