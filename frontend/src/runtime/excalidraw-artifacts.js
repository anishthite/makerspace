const EXCALIDRAW_TOKEN_RE = /(?:^|[\s([`'"])([^\s`'"<>]+\.excalidraw)\b/gi;
const DIAGRAM_IMAGE_TOKEN_RE = /(?:^|[\s([`'"])([^\s`'"<>]+\.(?:gif|jpe?g|png|svg|webp))\b/gi;
const EXCALIDRAW_IGNORE_CONTEXT_RE = /\b(?:could not load|does not exist|failed to load|fake|missing|placeholder|sample|unreferenced|unrelated|unstaged|untracked|left\s+unstaged|left\s+unpushed|do\s+not\s+(?:open|push|render|view)|don't\s+(?:open|push|render|view)|example\s+paths?|not\s+automatically)\b/i;
const DIAGRAM_IMAGE_CONTEXT_RE = /\b(?:architecture|artifact|chart|diagram|excalidraw|figure|flow|inline|mockup|preview|rendered?|saved|screenshot|tour|wireframe)\b|<img\b/i;
const IMAGE_EXT_RE = /\.(?:gif|jpe?g|png|svg|webp)$/i;
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_ATTR_RE = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

function normalizeRelativeArtifactPath(value, extensionRe) {
  let text = String(value || '').trim().replace(/^(?:\.\/)+/, '').replaceAll('\\', '/');
  text = text.replace(/^[`'"(<[]+|[`'"),.;:>\]]+$/g, '');
  if (!text || text.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(text) || /[*?\[\]{}]/.test(text)) return '';
  const parts = text.split('/').filter(Boolean);
  if (!parts.length || parts.includes('..') || !extensionRe.test(parts.at(-1) || '')) return '';
  return parts.join('/');
}

export function normalizeExcalidrawArtifactPath(value) {
  return normalizeRelativeArtifactPath(value, /\.excalidraw$/i);
}

export function normalizeDiagramImageArtifactPath(value) {
  return normalizeRelativeArtifactPath(value, IMAGE_EXT_RE);
}

function artifactContext(value, start, end, size = 180) {
  const text = String(value || '');
  const before = text.slice(Math.max(0, start - size), start);
  const after = text.slice(end, Math.min(text.length, end + size));
  return `${before} ${after}`;
}

function ignoredArtifactContext(value, start, end) {
  return EXCALIDRAW_IGNORE_CONTEXT_RE.test(artifactContext(value, start, end));
}

function diagramImageContext(value, start, end) {
  return DIAGRAM_IMAGE_CONTEXT_RE.test(artifactContext(value, start, end));
}

export function excalidrawArtifactPaths(value) {
  const text = String(value || '');
  const seen = new Set();
  const paths = [];
  for (const match of text.matchAll(EXCALIDRAW_TOKEN_RE)) {
    const rawPath = match[1];
    const start = match.index + match[0].length - rawPath.length;
    const path = normalizeExcalidrawArtifactPath(rawPath);
    if (!path || seen.has(path) || ignoredArtifactContext(text, start, start + rawPath.length)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

export function diagramImageArtifactPaths(value) {
  const text = String(value || '');
  const seen = new Set();
  const paths = [];
  for (const match of text.matchAll(DIAGRAM_IMAGE_TOKEN_RE)) {
    const rawPath = match[1];
    const start = match.index + match[0].length - rawPath.length;
    const path = normalizeDiagramImageArtifactPath(rawPath);
    if (!path || seen.has(path) || ignoredArtifactContext(text, start, start + rawPath.length) || !diagramImageContext(text, start, start + rawPath.length)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

export function htmlImageArtifactPaths(value) {
  const text = String(value || '');
  const seen = new Set();
  const paths = [];
  for (const tag of text.matchAll(IMG_TAG_RE)) {
    const srcMatch = String(tag[0] || '').match(SRC_ATTR_RE);
    const path = normalizeDiagramImageArtifactPath(srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3] ?? '');
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}
