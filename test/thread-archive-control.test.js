import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/thread.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/thread.js', import.meta.url), 'utf8');

const archiveButtonMarkup = '<button id="archive-thread" class="primary-btn thread-done-btn" type="button" hidden>mark as done</button>';

test('thread view exposes a top-right mark-as-done control in the header', () => {
  assert.ok(html.includes(archiveButtonMarkup));
  assert.equal(html.indexOf(archiveButtonMarkup), html.lastIndexOf(archiveButtonMarkup));
  assert.ok(html.indexOf('<div class="header-actions">') < html.indexOf(archiveButtonMarkup));
  assert.ok(html.indexOf('<span id="thread-status" class="status-pill">connecting</span>') < html.indexOf(archiveButtonMarkup));
  assert.ok(html.indexOf(archiveButtonMarkup) < html.indexOf('</header>'));
  assert.ok(html.indexOf(archiveButtonMarkup) < html.indexOf('<form id="prompt-form" class="flow-composer">'));
  assert.match(html, /<script type="module" src="\/thread\.js\?v=[^"]+"><\/script>/);
});

test('archive control uses the existing finished-thread archive route', () => {
  assert.match(js, /const ARCHIVEABLE_THREAD_STATUSES = \['completed', 'ready', 'failed'\];/);
  assert.match(js, /function canArchiveThread\(thread\) \{/);
  assert.match(js, /ARCHIVEABLE_THREAD_STATUSES\.includes\(status\) && !thread\?\.archivedAt/);
  assert.match(js, /archiveButton\?\.addEventListener\('click', async \(\) => \{/);
  assert.match(js, /archiveButton\.textContent = 'marking…';/);
  assert.match(js, /fetchJson\(`\/api\/threads\/\$\{encodeURIComponent\(name\)\}\/archive`, \{ method: 'POST' \}\)/);
  assert.match(js, /window\.location\.assign\('\/workspace\.html'\);/);
});

test('header hides the duplicate done status next to mark-as-done', () => {
  assert.match(js, /statusNode\.hidden = statusNode\.textContent === 'done' && Boolean\(archiveButton && !archiveButton\.hidden\);/);
  assert.match(js, /archiveButton\.textContent = 'mark as done';\n\s*syncHeaderStatusVisibility\(\);/);
  assert.match(js, /statusNode\.dataset\.active = String\(active\);\n\s*syncHeaderStatusVisibility\(\);/);
});
