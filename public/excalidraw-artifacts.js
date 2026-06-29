const EXCALIDRAW_TOKEN_RE = /(?:^|[\s([`'"])([^\s`'"<>]+\.excalidraw)\b/gi;

export function normalizeExcalidrawArtifactPath(value) {
  let text = String(value || '').trim().replace(/^(?:\.\/)+/, '').replaceAll('\\', '/');
  text = text.replace(/^[`'"(<[]+|[`'"),.;:>\]]+$/g, '');
  if (!text || text.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(text)) return '';
  const parts = text.split('/').filter(Boolean);
  if (!parts.length || parts.includes('..') || !parts.at(-1)?.endsWith('.excalidraw')) return '';
  return parts.join('/');
}

export function excalidrawArtifactPaths(value) {
  const seen = new Set();
  const paths = [];
  for (const match of String(value || '').matchAll(EXCALIDRAW_TOKEN_RE)) {
    const path = normalizeExcalidrawArtifactPath(match[1]);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}
