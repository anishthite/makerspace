export function timestampSystemLines(text, timestamp = new Date().toISOString()) {
  return String(text).replace(/(^|\n)(\[system\])/g, `$1[${timestamp}] $2`);
}
