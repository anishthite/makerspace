import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = readFileSync(new URL('../frontend/src/pages.jsx', import.meta.url), 'utf8');
const js = readFileSync(new URL('../frontend/src/runtime/thread.js', import.meta.url), 'utf8');

test('thread view exposes top-right stop and mark-as-done controls in the header', () => {
  assert.match(pages, /<div className="header-actions"><StatusPill id="thread-status">connecting<\/StatusPill><Button id="stop-thread"[^>]+className="thread-stop-btn"[^>]+>stop<\/Button><Button id="archive-thread"[^>]+className="thread-done-btn"[^>]+>mark as done<\/Button><\/div>/);
  assert.equal(pages.match(/id="stop-thread"/g)?.length, 1);
  assert.equal(pages.match(/id="archive-thread"/g)?.length, 1);
  assert.ok(pages.indexOf('className="header-actions"') < pages.indexOf('id="stop-thread"'));
  assert.ok(pages.indexOf('StatusPill id="thread-status"') < pages.indexOf('id="stop-thread"'));
  assert.ok(pages.indexOf('id="stop-thread"') < pages.indexOf('id="archive-thread"'));
  assert.ok(pages.indexOf('id="archive-thread"') < pages.indexOf('id="prompt-form"'));
});

test('stop control uses the running-thread stop route', () => {
  assert.match(js, /const stopButton = document\.querySelector\('#stop-thread'\);/);
  assert.match(js, /function canStopThread\(thread\) \{/);
  assert.match(js, /return isActiveStatus\(effectiveStatus\(thread\)\);/);
  assert.match(js, /stopButton\?\.addEventListener\('click', async \(\) => \{/);
  assert.match(js, /fetchJson\(`\/api\/threads\/\$\{encodeURIComponent\(name\)\}\/stop`, \{ method: 'POST' \}\)/);
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
