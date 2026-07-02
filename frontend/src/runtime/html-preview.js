const HTML_FENCE_RE = /^```(?:html?)?\s*([\s\S]*?)\s*```$/i;
const HTML_FENCE_ANYWHERE_RE = /```(?:html?)\s*([\s\S]*?)```/i;
const HTML_TAG_RE = /<\/?(?:html|head|body|main|section|article|div|header|footer|nav|aside|h[1-6]|p|ul|ol|li|table|thead|tbody|tr|td|th|style|svg|canvas|form|button|input|label|figure|figcaption|img|a|span)\b[^>]*>/gi;
const PREVIEW_CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' http: https: data: blob:; style-src \'unsafe-inline\' https:; font-src https: data:; script-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">';
const PREVIEW_SHELL_STYLE = `<style data-makerspace-preview>
  * { box-sizing: border-box; }
  html, body { overflow: hidden !important; }
  body { margin: 0; background: transparent; }
  img, svg, video, canvas { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible; }
  table { max-width: 100%; table-layout: fixed; }
  th, td { overflow-wrap: anywhere; }
</style>`;
const PREVIEW_HEAD = `${PREVIEW_CSP}${PREVIEW_SHELL_STYLE}`;
const FRAGMENT_THEMES = {
  light: ':root { color-scheme: light; --bg: #FAF8F3; --paper: #FFFFFF; --ink: #241A12; --muted: #6F5D50; --blue: #1F5E9C; --rule: rgba(31, 94, 156, .18); --pre: #F3EEDF; }',
  dark: ':root { color-scheme: dark; --bg: #0E1118; --paper: #151923; --ink: #E6EDF3; --muted: #C8D0E0; --blue: #89B4FA; --rule: rgba(137, 180, 250, .22); --pre: #1B2130; }',
};

function fragmentStyle(theme = 'dark') {
  return `<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  ${FRAGMENT_THEMES[theme === 'dark' ? 'dark' : 'light']}
  html, body { background: transparent; }
  body { color: var(--ink); font: 15px/1.6 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main, section, article { display: block; max-width: 100%; }
  h1, h2, h3 { margin: 0 0 .5em; line-height: 1.15; letter-spacing: -.025em; }
  h1 { color: var(--blue); font-size: 28px; }
  h2 { font-size: 22px; }
  h3 { font-size: 18px; }
  p { max-width: 74ch; color: var(--muted); }
  ol, ul { padding-left: 1.35rem; }
  li { margin: .25rem 0; }
  a { color: var(--blue); }
  button, input, textarea, select { font: inherit; }
  button, .button, input[type="submit"] { border: 1px solid var(--blue); background: var(--blue); color: var(--bg); padding: 10px 14px; font-weight: 700; }
  input, textarea, select { width: 100%; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); padding: 10px 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid var(--rule); padding: 10px 12px; text-align: left; }
  th { color: var(--blue); }
  code, pre { font-family: inherit; }
  pre { padding: 14px; border: 1px solid var(--rule); background: var(--pre); }
</style>`;
}

function isHtmlCandidate(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^<!doctype\s+html/i.test(text) || /^<html[\s>]/i.test(text)) return true;
  if (/^<img\b[^>]*>$/i.test(text)) return true;
  const tags = text.match(HTML_TAG_RE) || [];
  return text.startsWith('<') && tags.length >= 2;
}

export function extractHtmlOutput(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';

  const fullFence = text.match(HTML_FENCE_RE);
  const candidate = (fullFence ? fullFence[1] : text).trim();
  if (isHtmlCandidate(candidate)) return candidate;

  const fencedHtml = text.match(HTML_FENCE_ANYWHERE_RE)?.[1]?.trim() || '';
  return isHtmlCandidate(fencedHtml) ? fencedHtml : '';
}

export function looksLikeHtmlOutput(value) {
  return Boolean(extractHtmlOutput(value));
}

function injectPreviewHead(html) {
  if (/<head\b/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${PREVIEW_HEAD}`);
  if (/<html\b/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${PREVIEW_HEAD}</head>`);
  return `${PREVIEW_HEAD}${html}`;
}

export function htmlPreviewDocument(value, theme = 'dark') {
  const html = extractHtmlOutput(value);
  if (!html) return '';
  if (/^<!doctype\s+html/i.test(html) || /^<html[\s>]/i.test(html)) return injectPreviewHead(html);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${PREVIEW_HEAD}${fragmentStyle(theme)}</head><body>${html}</body></html>`;
}
