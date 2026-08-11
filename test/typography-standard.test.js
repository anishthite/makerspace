import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const SOURCE_ROOT = 'frontend/src';
const SOURCE_EXTENSIONS = new Set(['.css', '.html', '.js', '.jsx']);
const FORBIDDEN_FONT_STACK = /\b(?:ui-monospace|SFMono(?:-Regular)?|Menlo|Monaco|Consolas|Hack|JetBrains Mono|Georgia|Arial|Helvetica|Times New Roman|Courier(?: New)?|monospace)\b/;
const ALLOWED_FONT_WEIGHTS = new Set(['400', '500', '700', '800']);

function sourceFiles(dir = SOURCE_ROOT) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.'))) ? [path] : [];
  });
}

function activeFiles() {
  const rootHtml = readdirSync('frontend', { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => join('frontend', entry.name));
  return [...sourceFiles(), ...rootHtml];
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

function offSystemWeights(path, text) {
  const declarationWeights = [...text.matchAll(/font-weight\s*:\s*(\d{3})\b|font\s*:\s*(?:italic\s+)?(\d{3})\s+/g)]
    .map((match) => ({ match, weight: match[1] || match[2] }));
  const importWeights = [...text.matchAll(/wght@([^"']+)/g)]
    .flatMap((match) => (match[1].match(/\d{3}/g) || []).map((weight) => ({ match, weight })));

  return [...declarationWeights, ...importWeights]
    .filter(({ weight }) => !ALLOWED_FONT_WEIGHTS.has(weight))
    .map(({ match, weight }) => `${path}:${lineNumber(text, match.index)} uses ${weight}`);
}

test('active frontend source uses the canonical Inter stack', () => {
  const appCss = readFileSync('frontend/src/styles/app.css', 'utf8');
  const fluidCss = readFileSync('frontend/src/styles/fluid-ui.css', 'utf8');

  assert.match(appCss, /--font-family-ui:\s*'Inter Variable', Inter,/);
  assert.match(appCss, /--font-family-code:\s*var\(--font-family-ui\)/);
  assert.match(appCss, /--mono:\s*var\(--font-family-code\)/);
  assert.match(fluidCss, /--font-mono:\s*var\(--font-sans\)/);
});

test('active frontend source does not hard-code alternate font stacks', () => {
  const offenders = activeFiles().flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    return FORBIDDEN_FONT_STACK.test(text) ? [path] : [];
  });

  assert.deepEqual(offenders, []);
});

test('active frontend source only uses canonical font weights', () => {
  const offenders = activeFiles().flatMap((path) => offSystemWeights(path, readFileSync(path, 'utf8')));

  assert.deepEqual(offenders, []);
});
