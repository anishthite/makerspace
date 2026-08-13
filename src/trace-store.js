import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { d1StateRequested, readD1Kv, writeD1Kv } from './d1-state.js';

export const TRACE_STORE_VERSION = 1;
export const DEFAULT_MAX_TRACE_EVENTS = 2000;

const MAX_TRACE_STRING_CHARS = 32_000;
const MAX_TRACE_ARRAY_ITEMS = 120;
const MAX_TRACE_OBJECT_KEYS = 160;
const MAX_TRACE_DEPTH = 8;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|auth(?:orization)?|credential|password|secret|token)/i;

const writeQueues = new Map();
const lastEntryIds = new Map();

function maxTraceEvents(config = {}) {
  const configured = Number(config.traceStoreMaxEvents);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_MAX_TRACE_EVENTS;
}

function d1TraceStoreEnabled() {
  return d1StateRequested();
}

function localTraceStoreDir(config = {}) {
  return String(config.traceStoreDir || '').trim();
}

function traceStoreEnabled(config = {}) {
  return d1TraceStoreEnabled() || Boolean(localTraceStoreDir(config));
}

function traceStoreKey(name) {
  return `trace:${String(name || 'thread')}`;
}

function traceFileName(name) {
  const encoded = encodeURIComponent(String(name || 'thread')).replace(/\*/g, '%2A');
  return `${encoded || 'thread'}.jsonl`;
}

export function traceStoreFilePath(config = {}, name) {
  const directory = localTraceStoreDir(config);
  return directory ? path.join(directory, traceFileName(name)) : '';
}

function queueKey(config, name) {
  if (d1TraceStoreEnabled()) return `d1:${traceStoreKey(name)}`;
  const filePath = traceStoreFilePath(config, name);
  return filePath ? `file:${filePath}` : '';
}

function sessionHeader(name, timestamp = new Date().toISOString()) {
  return {
    type: 'session',
    version: TRACE_STORE_VERSION,
    id: String(name || 'thread'),
    timestamp,
    source: 'spanner-trace',
  };
}

function truncateString(value) {
  const text = String(value);
  if (text.length <= MAX_TRACE_STRING_CHARS) return text;
  return `${text.slice(0, MAX_TRACE_STRING_CHARS)}... [truncated]`;
}

function sanitizeTraceValue(value, key = '', depth = 0) {
  if (key === 'session') return undefined;
  if (SECRET_KEY_PATTERN.test(key)) return '[redacted]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (depth >= MAX_TRACE_DEPTH) return '[object]';

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_TRACE_ARRAY_ITEMS)
      .map((item) => sanitizeTraceValue(item, '', depth + 1))
      .filter((item) => item !== undefined);
  }

  if (typeof value !== 'object') return undefined;

  const output = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, MAX_TRACE_OBJECT_KEYS)) {
    const sanitized = sanitizeTraceValue(childValue, childKey, depth + 1);
    if (sanitized !== undefined) output[childKey] = sanitized;
  }
  return output;
}

export function sanitizeTraceEvent(event = {}) {
  const sanitized = sanitizeTraceValue(event);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) ? sanitized : {};
}

function traceEntry(name, event, parentId = null) {
  const cleanEvent = sanitizeTraceEvent(event);
  const timestamp = String(cleanEvent.timestamp || event.timestamp || new Date().toISOString());
  if (!cleanEvent.timestamp) cleanEvent.timestamp = timestamp;
  return {
    type: 'trace',
    version: TRACE_STORE_VERSION,
    id: String(cleanEvent.id || `${Date.now()}-${randomUUID()}`),
    parentId,
    timestamp,
    sessionId: String(name || 'thread'),
    event: cleanEvent,
  };
}

function storedEventFromEntry(entry) {
  const event = entry?.event;
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const output = { ...event };
  if (!output.timestamp && entry.timestamp) output.timestamp = String(entry.timestamp);
  if (!Object.prototype.hasOwnProperty.call(output, 'id') && entry.id) {
    const numeric = Number(entry.id);
    output.id = Number.isFinite(numeric) ? numeric : String(entry.id);
  }
  return output;
}

function parseTraceFile(text) {
  let header = null;
  const entries = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    if (parsed.type === 'session' && !header) {
      header = parsed;
    } else if (parsed.type === 'trace' && parsed.event && typeof parsed.event === 'object') {
      entries.push(parsed);
    }
  }
  return { header, entries };
}

function traceReadLimit(value, fallback) {
  if (value === Infinity) return Infinity;
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : fallback;
}

async function readLocalTraceTail(filePath, limit) {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const chunks = [];
    let position = size;
    let lineBreaks = 0;
    while (position > 0 && lineBreaks <= limit) {
      const length = Math.min(position, 64 * 1024);
      position -= length;
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      const chunk = buffer.subarray(0, bytesRead);
      for (const byte of chunk) {
        if (byte === 0x0a) lineBreaks += 1;
      }
      chunks.unshift(chunk);
    }
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/).filter(Boolean).slice(-limit).join('\n');
  } finally {
    await handle.close();
  }
}

async function readLocalTraceEntries(config, name, { limit = maxTraceEvents(config) } = {}) {
  const filePath = traceStoreFilePath(config, name);
  if (!filePath) return [];

  try {
    const count = traceReadLimit(limit, maxTraceEvents(config));
    const text = count === Infinity ? await readFile(filePath, 'utf8') : await readLocalTraceTail(filePath, count);
    return parseTraceFile(text).entries;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function normalizeD1TraceStore(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...sessionHeader(name), entries: [] };
  }

  let entries = [];
  if (Array.isArray(value.entries)) {
    entries = value.entries;
  } else if (Array.isArray(value.events)) {
    entries = value.events.map((event) => traceEntry(name, event, null));
  }

  return {
    ...sessionHeader(name, value.timestamp || value.createdAt || new Date().toISOString()),
    ...value,
    type: 'session',
    version: TRACE_STORE_VERSION,
    id: String(value.id || name || 'thread'),
    entries: entries.filter((entry) => entry?.type === 'trace' && entry.event && typeof entry.event === 'object'),
  };
}

async function readD1TraceEntries(name) {
  const stored = await readD1Kv(traceStoreKey(name), null);
  return normalizeD1TraceStore(stored, name).entries;
}

export async function readStoredTraceEvents(config = {}, name, { after = 0, limit = maxTraceEvents(config) } = {}) {
  if (!traceStoreEnabled(config)) return [];
  const entries = d1TraceStoreEnabled() ? await readD1TraceEntries(name) : await readLocalTraceEntries(config, name, { limit });
  const lastId = Number(after);
  return entries
    .map(storedEventFromEntry)
    .filter(Boolean)
    .filter((event) => {
      if (!Number.isFinite(lastId) || lastId <= 0) return true;
      const id = Number(event.id);
      return Number.isFinite(id) && id > lastId;
    });
}

async function ensureLocalTraceFile(config, name, timestamp) {
  const filePath = traceStoreFilePath(config, name);
  if (!filePath) return '';
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, `${JSON.stringify(sessionHeader(name, timestamp))}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return filePath;
}

async function appendLocalTraceEvent(config, name, event, key) {
  const entry = traceEntry(name, event, lastEntryIds.get(key) || null);
  const filePath = await ensureLocalTraceFile(config, name, entry.timestamp);
  if (!filePath) return null;

  await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  lastEntryIds.set(key, entry.id);
  return entry;
}

async function appendD1TraceEvent(config, name, event, key) {
  const current = normalizeD1TraceStore(await readD1Kv(traceStoreKey(name), null), name);
  const entry = traceEntry(name, event, current.entries.at(-1)?.id || lastEntryIds.get(key) || null);
  const entries = [...current.entries, entry].slice(-maxTraceEvents(config));
  const next = {
    ...current,
    type: 'session',
    version: TRACE_STORE_VERSION,
    id: String(name || current.id || 'thread'),
    updatedAt: entry.timestamp,
    entries,
  };
  await writeD1Kv(traceStoreKey(name), next);
  lastEntryIds.set(key, entry.id);
  return entry;
}

export function appendStoredTraceEvent(config = {}, name, event = {}) {
  if (!traceStoreEnabled(config)) return Promise.resolve(null);
  const key = queueKey(config, name);
  if (!key) return Promise.resolve(null);

  const operation = () => (
    d1TraceStoreEnabled()
      ? appendD1TraceEvent(config, name, event, key)
      : appendLocalTraceEvent(config, name, event, key)
  );
  const previous = writeQueues.get(key) || Promise.resolve();
  const next = previous.then(operation, operation);
  writeQueues.set(key, next.catch(() => {}));
  return next;
}

export async function flushStoredTraceEvents(config = {}, name) {
  const key = queueKey(config, name);
  if (!key) return;
  await (writeQueues.get(key) || Promise.resolve());
}

function traceEventIdentity(event = {}) {
  return [
    event.id ?? '',
    event.timestamp ?? '',
    event.type ?? '',
    event.runId ?? event.bridgeRunId ?? '',
    event.toolCallId ?? '',
    event.phase ?? '',
  ].map((part) => String(part)).join('\u001f');
}

export function mergeTraceEvents(storedEvents = [], liveEvents = []) {
  const liveKeys = new Set(liveEvents.map(traceEventIdentity));
  const seen = new Set();
  const merged = [];

  for (const event of storedEvents) {
    const key = traceEventIdentity(event);
    if (liveKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...event, historical: true });
  }

  for (const event of liveEvents) {
    const key = traceEventIdentity(event);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }

  return merged;
}
