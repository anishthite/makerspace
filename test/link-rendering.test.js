import test from 'node:test';
import assert from 'node:assert/strict';

import { linkTextParts, safeLinkHref } from '../frontend/src/runtime/link-rendering.js';

test('safe links include web, editor, loopback, and same-origin local hrefs', () => {
  const cases = [
    ['https://example.com/docs', 'https://example.com/docs'],
    ['localhost:8788/settings.html', 'http://localhost:8788/settings.html'],
    ['vscode://file/Users/me/app.js:12:3', 'vscode://file/Users/me/app.js:12:3'],
    ['cursor://file/Users/me/app.js:12', 'cursor://file/Users/me/app.js:12'],
    ['/settings.html?tab=codex', '/settings.html?tab=codex'],
    ['./artifacts/demo.html#preview', './artifacts/demo.html#preview'],
    ['implementation-notes/thread-link-rendering.html', 'implementation-notes/thread-link-rendering.html'],
    ['javascript:alert(1)', ''],
    ['file:///etc/passwd', ''],
    ['//example.com/docs', ''],
  ];

  for (const [input, expected] of cases) {
    assert.equal(safeLinkHref(input), expected);
  }
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

test('message link parts render markdown and bare local links', () => {
  const parts = linkTextParts('Open [settings](/settings.html), [notes](implementation-notes/thread-link-rendering.html), ./demo.html, artifacts/demo.html, and #top.');
  assert.deepEqual(parts, [
    { type: 'text', text: 'Open ' },
    { type: 'link', text: 'settings', href: '/settings.html', kind: 'local' },
    { type: 'text', text: ', ' },
    { type: 'link', text: 'notes', href: 'implementation-notes/thread-link-rendering.html', kind: 'local' },
    { type: 'text', text: ', ' },
    { type: 'link', text: './demo.html', href: './demo.html', kind: 'local' },
    { type: 'text', text: ', ' },
    { type: 'link', text: 'artifacts/demo.html', href: 'artifacts/demo.html', kind: 'local' },
    { type: 'text', text: ', and ' },
    { type: 'link', text: '#top', href: '#top', kind: 'local' },
    { type: 'text', text: '.' },
  ]);
});

test('message link parts render bare artifact output paths', () => {
  const parts = linkTextParts('Updated: artifacts/fish-biomechanics-research-compendium.html Preview: output/playwright/fish-biomechanics-research-compendium.png');
  assert.deepEqual(parts, [
    { type: 'text', text: 'Updated: ' },
    {
      type: 'link',
      text: 'artifacts/fish-biomechanics-research-compendium.html',
      href: 'artifacts/fish-biomechanics-research-compendium.html',
      kind: 'local',
    },
    { type: 'text', text: ' Preview: ' },
    {
      type: 'link',
      text: 'output/playwright/fish-biomechanics-research-compendium.png',
      href: 'output/playwright/fish-biomechanics-research-compendium.png',
      kind: 'local',
    },
  ]);
});

test('message link parts render bare loopback links', () => {
  assert.deepEqual(linkTextParts('Open localhost:8788/thread.html?name=demo.'), [
    { type: 'text', text: 'Open ' },
    { type: 'link', text: 'localhost:8788/thread.html?name=demo', href: 'http://localhost:8788/thread.html?name=demo', kind: 'external' },
    { type: 'text', text: '.' },
  ]);
});

test('message link parts keep same-origin loopback links local', () => {
  const previousLocation = globalThis.location;
  globalThis.location = { href: 'http://localhost:8788/thread.html?name=current' };
  try {
    assert.deepEqual(linkTextParts('Open localhost:8788/settings.html.'), [
      { type: 'text', text: 'Open ' },
      { type: 'link', text: 'localhost:8788/settings.html', href: 'http://localhost:8788/settings.html', kind: 'local' },
      { type: 'text', text: '.' },
    ]);
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
});

test('bare link trailing punctuation stays outside the anchor', () => {
  assert.deepEqual(linkTextParts('Open https://example.com/docs).'), [
    { type: 'text', text: 'Open ' },
    { type: 'link', text: 'https://example.com/docs', href: 'https://example.com/docs', kind: 'external' },
    { type: 'text', text: ').' },
  ]);
});
