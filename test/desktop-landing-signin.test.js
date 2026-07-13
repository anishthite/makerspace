import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../frontend/desktop.html', import.meta.url), 'utf8');
const pages = readFileSync(new URL('../frontend/src/pages.jsx', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../frontend/src/runtime/desktop.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../frontend/src/entry.jsx', import.meta.url), 'utf8');
const design = readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');

test('desktop landing is a React route with GitHub sign-in behavior', () => {
  assert.match(html, /data-react-page="desktop"/);
  assert.match(html, /src="\/src\/entry\.jsx"/);
  assert.match(pages, /function DesktopLandingPage\(\)/);
  assert.match(pages, /id="signin-open"/);
  assert.match(pages, /data-open-signin/);
  assert.match(pages, /<dialog id="signin-modal"/);
  assert.match(pages, /Continue with GitHub/);
  assert.match(runtime, /\/api\/auth\/github['"]/);
  assert.match(runtime, /\/api\/auth\/github\/login/);
  assert.match(runtime, /VITE_SPANNER_API_BASE/);
  assert.match(runtime, /'x-spanner-session': sessionId\(\)/);
  assert.match(runtime, /function targetUrl\(\)/);
  assert.match(runtime, /JSON\.stringify\(\{ returnTo: targetUrl\(\) \}\)/);
  assert.match(entry, /desktop: \(\) => import\('\.\/runtime\/desktop\.js'\)/);
});

test('desktop landing follows the root design system', () => {
  assert.match(design, /# Spanner design system/);
  assert.match(design, /`accent` \| `#1F5E9C`/);
  assert.match(pages, /Design source: DESIGN\.md/);
  assert.match(pages, /--ds-accent:#1F5E9C;/);
  assert.match(pages, /grid-template-columns:minmax\(0,1fr\) minmax\(320px,400px\)/);
  assert.match(pages, /aria-label="Example agent run"/);
});
