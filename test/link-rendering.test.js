import test from 'node:test';
import assert from 'node:assert/strict';

import { linkTextParts, safeLinkHref } from '../frontend/src/runtime/link-rendering.js';

test('safe links include web and editor protocols only', () => {
  assert.equal(safeLinkHref('https://example.com/docs'), 'https://example.com/docs');
  assert.equal(safeLinkHref('vscode://file/Users/me/app.js:12:3'), 'vscode://file/Users/me/app.js:12:3');
  assert.equal(safeLinkHref('cursor://file/Users/me/app.js:12'), 'cursor://file/Users/me/app.js:12');
  assert.equal(safeLinkHref('javascript:alert(1)'), '');
  assert.equal(safeLinkHref('file:///etc/passwd'), '');
});

test('message link parts render markdown, bare external, and code links', () => {
  const parts = linkTextParts('See [docs](https://example.com/docs). Open vscode://file/Users/me/app.js:12:3, not javascript:alert(1).');
  assert.deepEqual(parts, [
    { type: 'text', text: 'See ' },
    { type: 'link', text: 'docs', href: 'https://example.com/docs', kind: 'external' },
    { type: 'text', text: '. Open ' },
    { type: 'link', text: 'vscode://file/Users/me/app.js:12:3', href: 'vscode://file/Users/me/app.js:12:3', kind: 'code' },
    { type: 'text', text: ', not javascript:alert(1).' },
  ]);
});

test('bare link trailing punctuation stays outside the anchor', () => {
  assert.deepEqual(linkTextParts('Open https://example.com/docs).'), [
    { type: 'text', text: 'Open ' },
    { type: 'link', text: 'https://example.com/docs', href: 'https://example.com/docs', kind: 'external' },
    { type: 'text', text: ').' },
  ]);
});
