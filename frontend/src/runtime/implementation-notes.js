const NOTE_PATH_GLOBAL_PATTERN = /implementation-notes\/(?!INDEX\.html\b)(?![^\s"'<>)]*[*?\[\]{}])[^\s"'<>)]*\.html\b/gi;

function cleanHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(div|p|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPath(path) {
  return String(path || '').replace(/[.,;:]+$/, '');
}

function notePaths(value) {
  const text = String(value || '').replace(/\\/g, '/');
  return [...new Set(Array.from(text.matchAll(NOTE_PATH_GLOBAL_PATTERN), (match) => cleanPath(match[0])))];
}


function titleFromPath(path) {
  const slug = path.split('/').pop()?.replace(/\.html$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '') || 'implementation note';
  return slug.split('-').filter(Boolean).map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`).join(' ');
}

function firstMatch(content, pattern) {
  const value = content.match(pattern)?.[1];
  return cleanHtml(value);
}

function summaryValue(content, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return firstMatch(content, new RegExp(`<b[^>]*>\\s*${escapedLabel}\\s*<\\/b>\\s*<div[^>]*>([\\s\\S]*?)<\\/div>`, 'i'))
    || firstMatch(content, new RegExp(`<tr[^>]*>\\s*<th[^>]*>\\s*${escapedLabel}\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i'));
}

function noteContent(args, event) {
  if (typeof args.content === 'string') return args.content;
  if (Array.isArray(args.edits)) return args.edits.map((edit) => (typeof edit?.newText === 'string' ? edit.newText : '')).join('\n');
  return String(event.toolName || '').toLowerCase() === 'read' ? String(event.output || event.delta || '') : '';
}

function previewableNoteHtml(content) {
  const text = String(content || '').trim();
  return /^(?:<!doctype\s+html|<html\b)/i.test(text) ? text : '';
}

function extractFiles(content) {
  const table = content.match(/<h2[^>]*>\s*Files\s*<\/h2>\s*<table[^>]*>([\s\S]*?)<\/table>/i)?.[1] || '';
  if (!table) return [];

  return Array.from(table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))
    .map(([, row]) => Array.from(row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(([, cell]) => cleanHtml(cell)))
    .filter((cells) => cells.length >= 3 && cells[0] && !/^path$/i.test(cells[0]))
    .map(([path, kind, delta]) => ({ path, kind, delta }));
}

export function implementationNotesFromToolEvent(event = {}) {
  const args = event.args && typeof event.args === 'object' ? event.args : {};
  const paths = [
    ...notePaths(args.path || args.file_path),
    ...notePaths(event.label),
    ...notePaths(event.output),
    ...notePaths(event.delta),
  ];
  const uniquePaths = [...new Set(paths)];
  if (!uniquePaths.length) return [];

  const toolName = String(event.toolName || '').toLowerCase();
  const content = noteContent(args, event);
  const action = toolName === 'write' ? 'added' : toolName === 'edit' ? 'updated' : toolName === 'read' ? 'opened' : 'touched';

  return uniquePaths.map((path) => {
    const title = firstMatch(content, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
      || firstMatch(content, /<title[^>]*>(?:Spec\s*—\s*)?([\s\S]*?)<\/title>/i)
      || titleFromPath(path);

    return {
      path,
      title,
      action,
      summary: summaryValue(content, 'Goal') || summaryValue(content, 'Surface') || '',
      files: extractFiles(content),
      html: previewableNoteHtml(content),
    };
  });
}

export function implementationNoteFromToolEvent(event = {}) {
  return implementationNotesFromToolEvent(event)[0] || null;
}
