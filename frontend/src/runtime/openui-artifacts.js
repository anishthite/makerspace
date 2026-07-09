const FENCE_RE = /```openui(?:-chat)?\s*\n?([\s\S]*?)```/gi;
const MAX_ARTIFACTS = 3;
const MAX_SOURCE = 20000;
const MAX_PROMPT = 2000;

function shortText(value, max = MAX_SOURCE) {
  return String(value ?? '').trim().slice(0, max);
}

export function normalizeOpenUISource(value) {
  const source = shortText(value);
  if (!source || /^root\s*=/m.test(source)) return source;
  return /^[A-Z][A-Za-z0-9_]*\s*\(/.test(source) ? `root = ${source}` : source;
}

export function extractOpenUIArtifacts(value) {
  const text = String(value || '');
  const artifacts = [];
  for (const match of text.matchAll(FENCE_RE)) {
    if (artifacts.length >= MAX_ARTIFACTS) break;
    const source = normalizeOpenUISource(match[1]);
    if (!source) continue;
    artifacts.push({ source, start: match.index, end: match.index + match[0].length });
  }
  return artifacts;
}

export function stripOpenUIArtifactBlocks(value) {
  const text = String(value || '');
  const matches = extractOpenUIArtifacts(text);
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

function safeJson(value) {
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value, null, 2).slice(0, 1200);
  } catch {
    return '';
  }
}

export function openUIActionPrompt(event = {}) {
  const type = shortText(event.type, 80) || 'action';
  const message = shortText(event.humanFriendlyMessage, MAX_PROMPT);
  const url = shortText(event.params?.url, 1000);
  const context = shortText(event.params?.context, 1000);
  const formState = safeJson(event.formState);
  const lines = [`[OpenUI action: ${type}]`];
  if (message) lines.push(message);
  if (url) lines.push(`URL: ${url}`);
  if (context) lines.push(`Context: ${context}`);
  if (formState) lines.push(`Form state:\n${formState}`);
  return lines.join('\n').trim();
}
