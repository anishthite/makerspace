const FENCE_RE = /```openui(?:-chat)?\s*\n?([\s\S]*?)```/gi;
const MAX_ARTIFACTS = 3;
const MAX_SOURCE = 20000;
const MAX_PROMPT = 2000;
const TABLE_DIVIDER_CELL_RE = /^:?-{3,}:?$/;

function shortText(value, max = MAX_SOURCE) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeTripleQuotedStrings(value) {
  // ponytail: OpenUI has no triple strings; full lexer only if content needs literal """.
  return value.replace(/"""([\s\S]*?)"""/g, (_, text) => JSON.stringify(text));
}

function normalizeMissingColumnData(value) {
  // ponytail: OpenUI Col() needs data; empty columns beat a renderer error.
  return value.replace(
    /\bCol\s*\(\s*((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))\s*\)/g,
    'Col($1, [])',
  );
}

export function normalizeOpenUISource(value) {
  const source = normalizeMissingColumnData(normalizeTripleQuotedStrings(shortText(value)));
  if (!source || /^root\s*=/m.test(source)) return source;
  return /^[A-Z][A-Za-z0-9_]*\s*\(/.test(source) ? `root = ${source}` : source;
}

function lineRecords(text) {
  const records = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && text[index] !== '\n') continue;
    records.push({ start, end: index, text: text.slice(start, index).replace(/\r$/, '') });
    start = index + 1;
  }
  return records;
}

function splitMarkdownTableRow(line) {
  let value = String(line || '').trim();
  if (!value.includes('|')) return null;
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  const cells = [];
  let cell = '';
  let inCode = false;
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      cell += char === '|' ? '|' : `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '`') inCode = !inCode;
    if (char === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells.length > 1 ? cells : null;
}

function isMarkdownTableDivider(line, columnCount) {
  const cells = splitMarkdownTableRow(line);
  return Boolean(
    cells
      && cells.length === columnCount
      && cells.every((cell) => TABLE_DIVIDER_CELL_RE.test(cell.trim())),
  );
}

function normalizeRow(cells, columnCount) {
  const row = cells.slice(0, columnCount);
  if (cells.length > columnCount) row[columnCount - 1] = cells.slice(columnCount - 1).join(' | ');
  while (row.length < columnCount) row.push('');
  return row;
}

function openUITableSource(headers, rows) {
  const columns = headers.map((_, index) => rows.map((row) => row[index] ?? ''));
  return [
    `root = Table([${headers.map((header, index) => `Col(${JSON.stringify(header)}, col${index})`).join(', ')}])`,
    ...columns.map((values, index) => `col${index} = ${JSON.stringify(values)}`),
  ].join('\n');
}

function markdownTableArtifacts(text) {
  const records = lineRecords(text);
  const artifacts = [];
  let inFence = false;
  for (let index = 0; index < records.length - 2 && artifacts.length < MAX_ARTIFACTS; index += 1) {
    const trimmed = records[index].text.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const headers = splitMarkdownTableRow(records[index].text);
    if (!headers || headers.length < 2 || !isMarkdownTableDivider(records[index + 1].text, headers.length)) continue;

    const rows = [];
    let rowIndex = index + 2;
    while (rowIndex < records.length) {
      const cells = splitMarkdownTableRow(records[rowIndex].text);
      if (!cells) break;
      rows.push(normalizeRow(cells, headers.length));
      rowIndex += 1;
    }
    if (!rows.length) continue;

    artifacts.push({
      source: openUITableSource(headers, rows),
      start: records[index].start,
      end: records[rowIndex - 1].end,
    });
    index = rowIndex - 1;
  }
  return artifacts;
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
  return artifacts.length ? artifacts : markdownTableArtifacts(text);
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
