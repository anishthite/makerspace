import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = readFileSync(new URL('../frontend/src/pages.jsx', import.meta.url), 'utf8');
const js = readFileSync(new URL('../frontend/src/runtime/thread.js', import.meta.url), 'utf8');

test('thread view exposes top-right lifecycle controls in the header', () => {
  assert.match(pages, /<div className="header-actions"><StatusPill id="thread-status">connecting<\/StatusPill>[\s\S]*<Button id="stop-thread"[^>]+className="thread-stop-btn"[^>]+>[\s\S]*stop<\/Button>[\s\S]*<Button id="resume-thread"[^>]+className="thread-resume-btn"[^>]+>resume<\/Button>[\s\S]*<Button id="delete-thread"[^>]+className="thread-delete-btn"[^>]+>delete<\/Button>[\s\S]*<Button id="archive-thread"[^>]+className="thread-done-btn"[^>]+>[\s\S]*archive<\/Button><\/div>/);
  assert.doesNotMatch(pages, /id="suspend-thread"/);
  for (const id of ['stop-thread', 'resume-thread', 'delete-thread', 'archive-thread']) {
    assert.equal(pages.match(new RegExp(`id="${id}"`, 'g'))?.length, 1);
  }
  assert.ok(pages.indexOf('className="header-actions"') < pages.indexOf('id="stop-thread"'));
  assert.ok(pages.indexOf('StatusPill id="thread-status"') < pages.indexOf('id="stop-thread"'));
  assert.ok(pages.indexOf('id="stop-thread"') < pages.indexOf('id="resume-thread"'));
  assert.ok(pages.indexOf('id="delete-thread"') < pages.indexOf('id="archive-thread"'));
  assert.ok(pages.indexOf('id="archive-thread"') < pages.indexOf('id="prompt-form"'));
});

test('stop control uses the running-thread stop route', () => {
  assert.match(js, /const stopButton = document\.querySelector\('#stop-thread'\);/);
  assert.match(js, /function canStopThread\(thread\) \{/);
  assert.match(js, /return isActiveStatus\(effectiveStatus\(thread\)\);/);
  assert.match(js, /stopButton\?\.addEventListener\('click', async \(\) => \{/);
  assert.match(js, /fetchJson\(`\/api\/threads\/\$\{encodeURIComponent\(name\)\}\/stop`, \{ method: 'POST' \}\)/);
});

test('sandbox lifecycle controls use resume and backup-delete routes', () => {
  assert.doesNotMatch(js, /suspendButton/);
  assert.doesNotMatch(js, /function canSuspendThread\(thread\) \{/);
  assert.match(js, /const resumeButton = document\.querySelector\('#resume-thread'\);/);
  assert.match(js, /const deleteButton = document\.querySelector\('#delete-thread'\);/);
  assert.match(js, /function canResumeThread\(thread\) \{/);
  assert.match(js, /function canDeleteThread\(thread\) \{/);
  assert.match(js, /fetchJson\(`\/api\/threads\/\$\{encodeURIComponent\(name\)\}\/\$\{route\}`, \{ method: 'POST' \}\)/);
  assert.match(js, /postLifecycleAction\(resumeButton, 'resume', 'resuming…', 'resuming'\)/);
  assert.match(js, /confirm\('Back up, then delete this sandbox\?'\)/);
  assert.match(js, /postLifecycleAction\(deleteButton, 'delete', 'backing up…', 'backing_up'\)/);
  assert.match(js, /Sandbox is suspended · send will resume it/);
  assert.match(js, /const blocked = \['deleted', 'backing_up'\]\.includes\(status\);/);
  assert.match(js, /status === 'suspended' \? 'Send to resume sandbox…'/);
});

test('archive control uses the existing finished-thread archive route', () => {
  assert.match(js, /const ARCHIVEABLE_THREAD_STATUSES = \['completed', 'ready', 'failed'\];/);
  assert.match(js, /function canArchiveThread\(thread\) \{/);
  assert.match(js, /ARCHIVEABLE_THREAD_STATUSES\.includes\(status\) && !thread\?\.archivedAt/);
  assert.match(js, /archiveButton\?\.addEventListener\('click', async \(\) => \{/);
  assert.match(js, /archiveButton\.textContent = 'archiving…';/);
  assert.match(js, /fetchJson\(`\/api\/threads\/\$\{encodeURIComponent\(name\)\}\/archive`, \{ method: 'POST' \}\)/);
  assert.match(js, /window\.location\.assign\('\/workspace\.html'\);/);
});

test('header hides the duplicate done status next to archive', () => {
  assert.match(js, /statusNode\.hidden = statusNode\.textContent === 'done' && Boolean\(archiveButton && !archiveButton\.hidden\);/);
  assert.match(js, /archiveButton\.textContent = 'archive';\n\s*syncHeaderStatusVisibility\(\);/);
  assert.match(js, /statusNode\.dataset\.active = String\(active\);\n\s*syncHeaderStatusVisibility\(\);/);
});
