const LINK_PROTOCOLS = new Set([
  'http:',
  'https:',
  'vscode:',
  'vscode-insiders:',
  'cursor:',
  'zed:',
  'jetbrains:',
]);

const BARE_LINK_RE = /\b(?:https?:\/\/|(?:vscode(?:-insiders)?|cursor|zed|jetbrains):\/\/)[^\s<>"'`]+/gi;
const BARE_LOOPBACK_LINK_RE = /\b(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?(?:\/[^\s<>"'`]*)?/gi;
const BARE_LOCAL_LINK_RE = /(^|[\s(])((?:\/|\.{1,2}\/|[#?])[^\s<>"'`]+|[A-Za-z0-9._~-][A-Za-z0-9._~/-]*\.(?:csv|diff|excalidraw|gif|html?|jpe?g|jsonl?|log|md|patch|pdf|png|svg|tsv|txt|webp)(?:[?#][^\s<>"'`]*)?)/gi;
const MARKDOWN_LINK_RE = /\[([^\]\n]{1,240})\]\((\S{1,2000}?)\)/g;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const LOCAL_FILE_RE = /\.(?:csv|diff|excalidraw|gif|html?|jpe?g|jsonl?|log|md|patch|pdf|png|svg|tsv|txt|webp)(?:[?#].*)?$/i;
const LOOPBACK_LINK_START_RE = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?(?:\/|[?#]|$)/i;

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

export function safeLinkHref(value) {
  const text = trimLinkPunctuation(value);
  if (!text || /[\u0000-\u001f\u007f\s]/.test(text)) return '';
  const loopbackHref = safeLoopbackHref(text);
  if (loopbackHref) return loopbackHref;
  const localHref = safeLocalHref(text);
  if (localHref) return localHref;
  try {
    const url = new URL(text);
    return LINK_PROTOCOLS.has(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
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

function safeLocalHref(text) {
  if (
    !text ||
    text.startsWith('//') ||
    text.includes('\\') ||
    SCHEME_RE.test(text) ||
    /[\u0000-\u001f\u007f\s<>"'`]/.test(text)
  ) return '';

  const startsLocal = text.startsWith('/') || text.startsWith('./') || text.startsWith('../') || text.startsWith('#') || text.startsWith('?');
  const looksRelative = /^[A-Za-z0-9._~-]/.test(text) && !text.includes(':') && (text.includes('/') || LOCAL_FILE_RE.test(text));
  if (!startsLocal && !looksRelative) return '';

  try {
    const base = new URL(baseLocationHref());
    const resolved = new URL(text, base);
    return resolved.origin === base.origin ? text : '';
  } catch {
    return '';
  }
}

function overlaps(start, end, ranges) {
  return ranges.some((range) => start < range.end && end > range.start);
}

function pushBareLinkRange(ranges, raw, start, overlapEnd = start + raw.length) {
  const visible = trimLinkPunctuation(raw);
  const href = safeLinkHref(visible);
  const end = start + visible.length;
  if (!href || overlaps(start, overlapEnd, ranges)) return;
  ranges.push({ start, end, text: visible, href });
}

function linkKind(href) {
  try {
    const base = new URL(baseLocationHref());
    const url = new URL(href, base);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === base.origin) return 'local';
    if (url.protocol === 'http:' || url.protocol === 'https:') return 'external';
    return 'code';
  } catch {
    return 'local';
  }
}

export function linkTextParts(value) {
  const text = String(value || '');
  const ranges = [];

  for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
    const href = safeLinkHref(match[2]);
    if (!href) continue;
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      text: markdownLabel(match[1]) || href,
      href,
    });
  }

  for (const match of text.matchAll(BARE_LINK_RE)) {
    pushBareLinkRange(ranges, match[0], match.index);
  }

  for (const match of text.matchAll(BARE_LOOPBACK_LINK_RE)) {
    pushBareLinkRange(ranges, match[0], match.index);
  }

  for (const match of text.matchAll(BARE_LOCAL_LINK_RE)) {
    const start = match.index + match[1].length;
    pushBareLinkRange(ranges, match[2], start, match.index + match[0].length);
  }

  if (!ranges.length) return [{ type: 'text', text }];
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);

  const parts = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start < offset) continue;
    if (range.start > offset) parts.push({ type: 'text', text: text.slice(offset, range.start) });
    parts.push({
      type: 'link',
      text: range.text,
      href: range.href,
      kind: linkKind(range.href),
    });
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
    if (part.kind !== 'local') {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    anchor.dataset.linkKind = part.kind;
    node.append(anchor);
  }
}

export async function openSafeLink(value) {
  const href = safeLinkHref(value);
  if (!href) return false;
  if (linkKind(href) === 'local') {
    const target = new URL(href, baseLocationHref()).href;
    if (globalThis.location?.assign) {
      globalThis.location.assign(target);
      return true;
    }
    const opened = globalThis.open?.(target, '_blank', 'noopener,noreferrer');
    if (opened) opened.opener = null;
    return true;
  }
  const desktopOpen = globalThis.spannerDesktop?.openExternal;
  if (desktopOpen) {
    try {
      await desktopOpen(href);
      return true;
    } catch {
      // Fall through to the browser opener.
    }
  }
  const opened = globalThis.open?.(href, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
  return true;
}
