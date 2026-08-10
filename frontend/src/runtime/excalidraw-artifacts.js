const EXCALIDRAW_TOKEN_RE = /(?:^|[\s([`'"])([^\s`'"<>]+\.excalidraw)\b/gi;
const DIAGRAM_IMAGE_TOKEN_RE = /(?:^|[\s([`'"])([^\s`'"<>]+\.(?:gif|jpe?g|png|svg|webp))\b/gi;
const HTML_ARTIFACT_TOKEN_RE = /(?:^|[\s([`'"])([^\s`'"<>]+\.html)\b/gi;
const EXCALIDRAW_IGNORE_CONTEXT_RE = /\b(?:could not load|does not exist|failed to load|fake|missing|placeholder|sample|unreferenced|unrelated|unstaged|untracked|left\s+unstaged|left\s+unpushed|do\s+not\s+(?:open|push|render|view)|don't\s+(?:open|push|render|view)|example\s+paths?|not\s+automatically)\b/i;
const DIAGRAM_IMAGE_CONTEXT_RE = /\b(?:architecture|artifact|chart|diagram|excalidraw|figure|flow|inline|mockup|preview|rendered?|saved|screenshot|tour|wireframe)\b|<img\b/i;
const GENERATED_MEDIA_PATH_RE = /^(?:artifacts\/|output\/playwright\/|test-results\/)/i;
const HTML_ARTIFACT_PATH_RE = /^(?:artifacts\/|output\/playwright\/|test-results\/|implementation-notes\/(?!INDEX\.html\b))/i;
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

export function normalizeHtmlArtifactPath(value) {
  return normalizeRelativeArtifactPath(value, /\.html$/i);
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

function generatedMediaPath(path) {
  return GENERATED_MEDIA_PATH_RE.test(path);
}

export function isRenderableHtmlArtifactPath(path) {
  return HTML_ARTIFACT_PATH_RE.test(String(path || ''));
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
    if (!path || seen.has(path) || ignoredArtifactContext(text, start, start + rawPath.length) || (!diagramImageContext(text, start, start + rawPath.length) && !generatedMediaPath(path))) continue;
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

export function htmlArtifactPaths(value) {
  const text = String(value || '');
  const seen = new Set();
  const paths = [];
  for (const match of text.matchAll(HTML_ARTIFACT_TOKEN_RE)) {
    const rawPath = match[1];
    const start = match.index + match[0].length - rawPath.length;
    const path = normalizeHtmlArtifactPath(rawPath);
    if (!path || seen.has(path) || ignoredArtifactContext(text, start, start + rawPath.length) || !isRenderableHtmlArtifactPath(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function artifactStem(path) {
  return String(path || '').replace(/\.(?:excalidraw|gif|jpe?g|png|svg|webp)$/i, '');
}

function openUIString(value) {
  return JSON.stringify(String(value || ''));
}

export function artifactMediaOpenUISource(value, options = {}) {
  const skippedImages = new Set((options.skipImagePaths || []).map(normalizeDiagramImageArtifactPath).filter(Boolean));
  const imagePaths = diagramImageArtifactPaths(value).filter((path) => !skippedImages.has(path));
  const sourceByStem = new Map(excalidrawArtifactPaths(value).map((path) => [artifactStem(path), path]));
  const usedSources = new Set();
  const items = imagePaths.map((path) => {
    const source = sourceByStem.get(artifactStem(path)) || '';
    if (source) usedSources.add(source);
    return { component: 'ArtifactImage', args: [path, source].filter(Boolean) };
  });

  for (const path of sourceByStem.values()) {
    if (!usedSources.has(path)) items.push({ component: 'ExcalidrawArtifact', args: [path] });
  }
  if (!items.length) return '';

  const refs = items.map((_, index) => `artifact${index + 1}`);
  return [
    `root = ArtifactGallery([${refs.join(', ')}])`,
    ...items.map((item, index) => `${refs[index]} = ${item.component}(${item.args.map(openUIString).join(', ')})`),
  ].join('\n');
}
