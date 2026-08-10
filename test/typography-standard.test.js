import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const SOURCE_ROOT = 'frontend/src';
const SOURCE_EXTENSIONS = new Set(['.css', '.js', '.jsx']);
const FORBIDDEN_FONT_STACK = /\b(?:ui-monospace|SFMono(?:-Regular)?|Menlo|Monaco|Consolas|Hack|JetBrains Mono|Georgia|Arial|Helvetica|Times New Roman|Courier(?: New)?|monospace)\b/;

function sourceFiles(dir = SOURCE_ROOT) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.'))) ? [path] : [];
  });
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
  const offenders = sourceFiles().flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    return FORBIDDEN_FONT_STACK.test(text) ? [path] : [];
  });

  assert.deepEqual(offenders, []);
});
