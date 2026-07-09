import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../frontend/desktop.html', import.meta.url), 'utf8');
const design = readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');

test('desktop landing exposes GitHub sign-in modal', () => {
  assert.match(html, /id="signin-open"[^>]+data-open-signin/);
  assert.match(html, /<dialog id="signin-modal"/);
  assert.match(html, /Continue with GitHub/);
  assert.match(html, /\/api\/auth\/github['"]/);
  assert.match(html, /\/api\/auth\/github\/login/);
  assert.match(html, /'x-workbench-session': sessionId\(\)/);
  assert.match(html, /JSON\.stringify\(\{ returnTo: location\.href \}\)/);
});

test('desktop landing follows the root design system', () => {
  assert.match(design, /# Workbench design system/);
  assert.match(design, /`accent` \| `#1F5E9C`/);
  assert.match(html, /Design source: DESIGN\.md/);
  assert.match(html, /--ds-accent: #1F5E9C;/);
  assert.match(html, /grid-template-columns: minmax\(0, 1fr\) minmax\(320px, 400px\)/);
  assert.match(html, /aria-label="Example agent run"/);
});
