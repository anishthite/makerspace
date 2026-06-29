export const DEFAULT_OUTPUT_RETAIN_CHARS = 1024 * 1024;
export const DEFAULT_BROWSER_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_BROWSER_SESSION_MAX = 200;

export function appendRetainedOutput(run, text, maxChars = DEFAULT_OUTPUT_RETAIN_CHARS) {
  if (!text) return run;
  run.output = `${run.output || ''}${text}`;
  run.outputBaseOffset = Number(run.outputBaseOffset) || 0;

  if (run.output.length > maxChars) {
    const drop = run.output.length - maxChars;
    run.output = run.output.slice(drop);
    run.outputBaseOffset += drop;
  }

  return run;
}

export function retainedOutputChunk(run, requestedOffset = 0) {
  const baseOffset = Number(run?.outputBaseOffset) || 0;
  const output = String(run?.output || '');
  const nextOffset = baseOffset + output.length;
  const offset = Number.isFinite(Number(requestedOffset)) && Number(requestedOffset) > baseOffset
    ? Math.min(Number(requestedOffset), nextOffset)
    : baseOffset;

  return {
    baseOffset,
    nextOffset,
    chunk: output.slice(offset - baseOffset),
    truncated: Number(requestedOffset) > 0 && Number(requestedOffset) < baseOffset,
  };
}

export function pruneBrowserSessions(sessions, {
  now = Date.now(),
  ttlMs = DEFAULT_BROWSER_SESSION_TTL_MS,
  max = DEFAULT_BROWSER_SESSION_MAX,
} = {}) {
  const entries = [...sessions.entries()];
  const fresh = entries.filter(([, value]) => {
    const updated = Date.parse(value?.updatedAt || value?.createdAt || '');
    return !Number.isFinite(updated) || now - updated <= ttlMs;
  });

  fresh.sort((left, right) => Date.parse(right[1]?.updatedAt || right[1]?.createdAt || '') - Date.parse(left[1]?.updatedAt || left[1]?.createdAt || ''));
  return new Map(fresh.slice(0, max));
}
