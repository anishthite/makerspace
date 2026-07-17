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
const MARKDOWN_LINK_RE = /\[([^\]\n]{1,240})\]\((\S{1,2000}?)\)/g;

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
  try {
    const url = new URL(text);
    return LINK_PROTOCOLS.has(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function overlaps(start, end, ranges) {
  return ranges.some((range) => start < range.end && end > range.start);
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
    const raw = match[0];
    const visible = trimLinkPunctuation(raw);
    const href = safeLinkHref(visible);
    const start = match.index;
    const end = start + visible.length;
    if (!href || overlaps(start, match.index + raw.length, ranges)) continue;
    ranges.push({ start, end, text: visible, href });
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
      kind: range.href.startsWith('http') ? 'external' : 'code',
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
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.dataset.linkKind = part.kind;
    node.append(anchor);
  }
}

export async function openSafeLink(value) {
  const href = safeLinkHref(value);
  if (!href) return false;
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
