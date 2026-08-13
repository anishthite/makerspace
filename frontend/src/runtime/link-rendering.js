const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

const APP_ROUTE_NAMES = new Set([
  '',
  'agent-elements-demo.html',
  'assistant-ui-components.html',
  'chimes.html',
  'desktop.html',
  'excalidraw-editor.html',
  'excalidraw-viewer.html',
  'history.html',
  'index.html',
  'local-telemetry.html',
  'onboarding-editor.html',
  'settings.html',
  'telemetry.html',
  'thread.html',
  'trace-components.html',
  'workspace.html',
]);

const FILE_EXTENSIONS = 'csv|diff|excalidraw|gif|html?|jpe?g|jsonl?|log|md|patch|pdf|png|svg|tsv|txt|webp|cjs|css|js|jsx|mjs|ts|tsx|yaml|yml';
const IMAGE_EXT_RE = /\.(?:gif|jpe?g|png|svg|webp)$/i;
const HTML_EXT_RE = /\.html?$/i;
const EXCALIDRAW_EXT_RE = /\.excalidraw$/i;
const LOCAL_FILE_EXT_RE = new RegExp(`\\.(?:${FILE_EXTENSIONS})$`, 'i');
const GENERATED_ARTIFACT_RE = /^(?:artifacts\/|output\/playwright\/|test-results\/)/i;
const HTML_ARTIFACT_RE = /^(?:artifacts\/|output\/playwright\/|test-results\/|implementation-notes\/(?!INDEX\.html\b))/i;

const BARE_WEB_LINK_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const BARE_LOOPBACK_LINK_RE = /\b(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?(?:\/[^\s<>"'`]*)?/gi;
const BARE_APP_LINK_RE = /(^|[\s(])([#?][^\s<>"'`]+)/g;
const BARE_LOCAL_LINK_RE = new RegExp(`(^|[\\s(])((?:\\.{1,2}\\/)?[A-Za-z0-9._~-][A-Za-z0-9._~\\/-]*\\.(?:${FILE_EXTENSIONS})(?::\\d+(?::\\d+)?(?:-\\d+(?::\\d+)?)?|#[^\\s<>"'${'`'}]+)?)`, 'gi');
const MARKDOWN_LINK_RE = /\[([^\]\n]{1,240})\]\((\S{1,2000}?)\)/g;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const LOOPBACK_LINK_START_RE = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?(?:\/|[?#]|$)/i;
const HASH_LINE_RE = /#L([0-9]+)(?:C[0-9]+)?(?:-L?([0-9]+)(?:C[0-9]+)?)?$/i;
const COLON_LINE_RE = /:([0-9]+)(?::[0-9]+)?(?:-([0-9]+)(?::[0-9]+)?)?$/;

function trimLinkPunctuation(value) {
  let text = String(value || '').trim();
  while (/[.,;!?\]]$/.test(text) || (text.endsWith(')') && (text.match(/\)/g) || []).length > (text.match(/\(/g) || []).length)) {
    text = text.slice(0, -1);
  }
  return text;
}

function markdownLabel(value) {
  return String(value || '').replace(/\\([\\[\]()])/g, '$1');
}

function baseLocationHref() {
  return globalThis.location?.href || 'http://localhost/';
}

function safeLoopbackHref(text) {
  if (!LOOPBACK_LINK_START_RE.test(text)) return '';
  try {
    const url = new URL(`http://${text}`);
    if (url.hostname !== 'localhost' && !url.hostname.startsWith('127.') && !['[::1]', '::1'].includes(url.hostname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function parsePositiveInt(value) {
  const number = Number.parseInt(value, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function splitLocalLineSuffix(value) {
  const hashMatch = value.match(HASH_LINE_RE);
  if (hashMatch) {
    return {
      path: value.slice(0, hashMatch.index),
      hash: value.slice(hashMatch.index),
      lineStart: parsePositiveInt(hashMatch[1]),
      lineEnd: parsePositiveInt(hashMatch[2]),
    };
  }

  const hashIndex = value.indexOf('#');
  if (hashIndex >= 0) {
    const hash = value.slice(hashIndex);
    if (!hash || hash.includes('/')) return null;
    return { path: value.slice(0, hashIndex), hash };
  }

  const colonMatch = value.match(COLON_LINE_RE);
  if (colonMatch) {
    return {
      path: value.slice(0, colonMatch.index),
      hash: `#L${colonMatch[1]}${colonMatch[2] ? `-L${colonMatch[2]}` : ''}`,
      lineStart: parsePositiveInt(colonMatch[1]),
      lineEnd: parsePositiveInt(colonMatch[2]),
    };
  }

  return { path: value, hash: '' };
}

function normalizeRelativeFileTarget(value) {
  let text = trimLinkPunctuation(value).replace(/^(?:\.\/)+/, '').replaceAll('\\', '/');
  const split = splitLocalLineSuffix(text);
  if (!split) return null;
  text = split.path;
  if (
    !text
    || text.startsWith('/')
    || text.startsWith('../')
    || text.startsWith('//')
    || SCHEME_RE.test(text)
    || /[\u0000-\u001f\u007f\s<>"'`*?\[\]{}]/.test(text)
  ) return null;

  const parts = text.split('/').filter(Boolean);
  if (!parts.length || parts.includes('..') || !LOCAL_FILE_EXT_RE.test(parts.at(-1) || '')) return null;
  return { path: parts.join('/'), hash: split.hash || '', lineStart: split.lineStart, lineEnd: split.lineEnd };
}

function artifactKind(path) {
  if (EXCALIDRAW_EXT_RE.test(path)) return 'excalidraw';
  if (IMAGE_EXT_RE.test(path) && GENERATED_ARTIFACT_RE.test(path)) return 'image';
  if (HTML_EXT_RE.test(path) && HTML_ARTIFACT_RE.test(path)) return 'html';
  return '';
}

function sameOriginUrl(value) {
  try {
    const base = new URL(baseLocationHref());
    const url = new URL(value, base);
    return url.origin === base.origin ? url : null;
  } catch {
    return null;
  }
}

function appRouteTarget(value) {
  if (value.startsWith('#') || value.startsWith('?')) return { kind: 'app', href: value };
  const url = sameOriginUrl(value);
  if (!url) return null;
  const path = url.pathname.replace(/^\/+/, '');
  if (!APP_ROUTE_NAMES.has(path)) return null;
  const href = /^[a-z][a-z0-9+.-]*:/i.test(value) ? url.href : `${url.pathname}${url.search}${url.hash}`;
  return { kind: 'app', href };
}

function externalTarget(value) {
  const loopbackHref = safeLoopbackHref(value);
  if (!loopbackHref && !/^https?:\/\//i.test(value)) return null;
  const text = loopbackHref || value;
  try {
    const base = new URL(baseLocationHref());
    const url = new URL(text, base);
    if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
    if (url.origin === base.origin) return appRouteTarget(url.href) || null;
    return { kind: 'external', href: url.href };
  } catch {
    return null;
  }
}

export function classifyLinkTarget(value) {
  const text = trimLinkPunctuation(value);
  if (!text || /[\u0000-\u001f\u007f\s]/.test(text)) return null;

  const external = externalTarget(text);
  if (external) return external;

  const app = appRouteTarget(text);
  if (app) return app;

  const file = normalizeRelativeFileTarget(text);
  if (!file) return null;

  const kind = artifactKind(file.path);
  if (kind) {
    return { kind: 'artifact', href: `${file.path}${file.hash}`, path: file.path, artifactKind: kind, lineStart: file.lineStart, lineEnd: file.lineEnd };
  }
  return { kind: 'workspace-file', href: `${file.path}${file.hash}`, path: file.path, lineStart: file.lineStart, lineEnd: file.lineEnd };
}

export function safeLinkHref(value) {
  return classifyLinkTarget(value)?.href || '';
}

function overlaps(start, end, ranges) {
  return ranges.some((range) => start < range.end && end > range.start);
}

function pushLinkRange(ranges, raw, start, overlapEnd = start + raw.length, label = '', replaceEnd = 0) {
  const visible = trimLinkPunctuation(raw);
  const target = classifyLinkTarget(visible);
  const end = replaceEnd || start + visible.length;
  if (!target || overlaps(start, overlapEnd, ranges)) return;
  ranges.push({ start, end, text: label || visible, href: target.href, kind: target.kind });
}

export function linkTextParts(value) {
  const text = String(value || '');
  const ranges = [];

  for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
    pushLinkRange(ranges, match[2], match.index, match.index + match[0].length, markdownLabel(match[1]), match.index + match[0].length);
  }

  for (const match of text.matchAll(BARE_WEB_LINK_RE)) {
    pushLinkRange(ranges, match[0], match.index);
  }

  for (const match of text.matchAll(BARE_LOOPBACK_LINK_RE)) {
    pushLinkRange(ranges, match[0], match.index);
  }

  for (const match of text.matchAll(BARE_APP_LINK_RE)) {
    const start = match.index + match[1].length;
    pushLinkRange(ranges, match[2], start, match.index + match[0].length);
  }

  for (const match of text.matchAll(BARE_LOCAL_LINK_RE)) {
    const start = match.index + match[1].length;
    pushLinkRange(ranges, match[2], start, match.index + match[0].length);
  }

  if (!ranges.length) return [{ type: 'text', text }];
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);

  const parts = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start < offset) continue;
    if (range.start > offset) parts.push({ type: 'text', text: text.slice(offset, range.start) });
    parts.push({ type: 'link', text: range.text, href: range.href, kind: range.kind });
    offset = range.end;
  }
  if (offset < text.length) parts.push({ type: 'text', text: text.slice(offset) });
  return parts;
}

export function renderLinkedText(node, value) {
  const parts = linkTextParts(value);
  if (!parts.some((part) => part.type === 'link')) {
    node.textContent = String(value || '');
    return;
  }

  node.replaceChildren();
  const doc = node.ownerDocument || document;
  for (const part of parts) {
    if (part.type !== 'link') {
      node.append(doc.createTextNode(part.text));
      continue;
    }
    const anchor = doc.createElement('a');
    anchor.className = 'rendered-link';
    anchor.href = part.href;
    anchor.textContent = part.text;
    if (part.kind === 'external') {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    anchor.dataset.linkKind = part.kind;
    node.append(anchor);
  }
}

export async function openSafeLink(value) {
  const target = classifyLinkTarget(value);
  if (!target) return false;
  if (target.kind === 'app') {
    if (globalThis.location?.assign) {
      globalThis.location.assign(new URL(target.href, baseLocationHref()).href);
      return true;
    }
    return false;
  }
  if (target.kind !== 'external') return false;

  const desktopOpen = globalThis.spannerDesktop?.openExternal;
  if (desktopOpen) {
    try {
      await desktopOpen(target.href);
      return true;
    } catch {
      // Fall through for browser-only shells.
    }
  }
  const opened = globalThis.open?.(target.href, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
  return Boolean(opened);
}
