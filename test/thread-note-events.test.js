import test from 'node:test';
import assert from 'node:assert/strict';

import { implementationNoteFromToolEvent, implementationNotesFromToolEvent } from '../public/implementation-notes.js';

const noteHtml = `<!doctype html><html><head><title>Spec — demo note</title></head><body>
<h1>Demo note</h1>
<h2>Summary</h2><div class="kv"><b>Goal</b><div>Add the smallest useful thing.</div></div>
<h2>Files</h2><table><tr><th>Path</th><th>Kind</th><th>Delta</th></tr>
<tr><td><code>public/thread.js</code></td><td>touch</td><td>Render note cards.</td></tr>
<tr><td><code>test/thread-note-events.test.js</code></td><td>new</td><td>Cover extraction.</td></tr>
</table></body></html>`;

test('implementationNoteFromToolEvent summarizes note writes', () => {
  const note = implementationNoteFromToolEvent({
    type: 'tool',
    toolName: 'write',
    args: { path: 'implementation-notes/2026-06-24-demo-note.html', content: noteHtml },
  });

  assert.equal(note.title, 'Demo note');
  assert.equal(note.action, 'added');
  assert.equal(note.summary, 'Add the smallest useful thing.');
  assert.match(note.html, /<h1>Demo note<\/h1>/);
  assert.deepEqual(note.files, [
    { path: 'public/thread.js', kind: 'touch', delta: 'Render note cards.' },
    { path: 'test/thread-note-events.test.js', kind: 'new', delta: 'Cover extraction.' },
  ]);
});

test('implementationNoteFromToolEvent previews note reads', () => {
  const note = implementationNoteFromToolEvent({
    type: 'tool',
    toolName: 'read',
    args: { path: 'implementation-notes/2026-06-24-demo-note.html' },
    output: noteHtml,
  });

  assert.equal(note.title, 'Demo note');
  assert.equal(note.action, 'opened');
  assert.equal(note.summary, 'Add the smallest useful thing.');
  assert.match(note.html, /<h1>Demo note<\/h1>/);
  assert.equal(note.files.length, 2);
});

test('implementationNoteFromToolEvent ignores the notes index and globs', () => {
  assert.equal(
    implementationNoteFromToolEvent({ type: 'tool', toolName: 'edit', args: { path: 'implementation-notes/INDEX.html' } }),
    null,
  );
  assert.equal(
    implementationNoteFromToolEvent({ type: 'tool', toolName: 'bash', args: { path: 'implementation-notes/*.html' } }),
    null,
  );
});

test('implementationNoteFromToolEvent can find a note path in tool output', () => {
  const note = implementationNoteFromToolEvent({
    type: 'tool',
    toolName: 'write',
    output: 'Successfully wrote 12 bytes to implementation-notes/2026-06-24-path-only.html',
  });

  assert.equal(note.path, 'implementation-notes/2026-06-24-path-only.html');
  assert.equal(note.title, 'Path Only');
  assert.equal(note.html, '');
});

test('implementationNotesFromToolEvent finds every concrete note path', () => {
  const notes = implementationNotesFromToolEvent({
    type: 'tool',
    toolName: 'bash',
    output: [
      'implementation-notes/2026-06-24-first-note.html',
      'implementation-notes/*.html',
      'implementation-notes/INDEX.html',
      'implementation-notes/2026-06-25-second-note.html:',
      'implementation-notes/2026-06-24-first-note.html',
    ].join('\n'),
  });

  assert.deepEqual(notes.map((note) => note.path), [
    'implementation-notes/2026-06-24-first-note.html',
    'implementation-notes/2026-06-25-second-note.html',
  ]);
  assert.deepEqual(notes.map((note) => note.title), ['First Note', 'Second Note']);
});

test('implementationNoteFromToolEvent ignores partial edit HTML previews', () => {
  const note = implementationNoteFromToolEvent({
    type: 'tool',
    toolName: 'edit',
    args: { path: 'implementation-notes/2026-06-24-demo-note.html', edits: [{ newText: '<h2>Verification</h2><table></table>' }] },
  });

  assert.equal(note.title, 'Demo Note');
  assert.equal(note.html, '');
});
