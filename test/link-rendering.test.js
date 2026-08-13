import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyLinkTarget, linkTextParts, safeLinkHref } from '../frontend/src/runtime/link-rendering.js';

test('safe links classify web, app, artifact, and workspace file targets', () => {
  const cases = [
    ['https://example.com/docs', 'https://example.com/docs', 'external'],
    ['localhost:8788/settings.html', 'http://localhost:8788/settings.html', 'external'],
    ['/settings.html?tab=codex', '/settings.html?tab=codex', 'app'],
    ['./artifacts/demo.html#preview', 'artifacts/demo.html#preview', 'artifact'],
    ['implementation-notes/thread-link-rendering.html', 'implementation-notes/thread-link-rendering.html', 'artifact'],
    ['src/app.ts:12', 'src/app.ts#L12', 'workspace-file'],
    ['vscode://file/Users/me/app.js:12:3', '', ''],
    ['cursor://file/Users/me/app.js:12', '', ''],
    ['javascript:alert(1)', '', ''],
    ['file:///etc/passwd', '', ''],
    ['//example.com/docs', '', ''],
  ];

  for (const [input, expectedHref, expectedKind] of cases) {
    assert.equal(safeLinkHref(input), expectedHref);
    assert.equal(classifyLinkTarget(input)?.kind || '', expectedKind);
  }
});

test('message link parts render markdown and bare external links only for http(s)', () => {
  const parts = linkTextParts('See [docs](https://example.com/docs). Open vscode://file/Users/me/app.js:12:3, not javascript:alert(1).');
  assert.deepEqual(parts, [
    { type: 'text', text: 'See ' },
    { type: 'link', text: 'docs', href: 'https://example.com/docs', kind: 'external' },
    { type: 'text', text: '. Open vscode://file/Users/me/app.js:12:3, not javascript:alert(1).' },
  ]);
});

test('message link parts render markdown and bare app/local file links by explicit kind', () => {
  const parts = linkTextParts('Open [settings](/settings.html), [notes](implementation-notes/thread-link-rendering.html), ./demo.html, artifacts/demo.html, src/app.ts:12, and #top.');
  assert.deepEqual(parts, [
    { type: 'text', text: 'Open ' },
    { type: 'link', text: 'settings', href: '/settings.html', kind: 'app' },
    { type: 'text', text: ', ' },
    { type: 'link', text: 'notes', href: 'implementation-notes/thread-link-rendering.html', kind: 'artifact' },
    { type: 'text', text: ', ' },
    { type: 'link', text: './demo.html', href: 'demo.html', kind: 'workspace-file' },
    { type: 'text', text: ', ' },
    { type: 'link', text: 'artifacts/demo.html', href: 'artifacts/demo.html', kind: 'artifact' },
    { type: 'text', text: ', ' },
    { type: 'link', text: 'src/app.ts:12', href: 'src/app.ts#L12', kind: 'workspace-file' },
    { type: 'text', text: ', and ' },
    { type: 'link', text: '#top', href: '#top', kind: 'app' },
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
      kind: 'artifact',
    },
    { type: 'text', text: ' Preview: ' },
    {
      type: 'link',
      text: 'output/playwright/fish-biomechanics-research-compendium.png',
      href: 'output/playwright/fish-biomechanics-research-compendium.png',
      kind: 'artifact',
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

test('message link parts keep same-origin loopback links as app links', () => {
  const previousLocation = globalThis.location;
  globalThis.location = { href: 'http://localhost:8788/thread.html?name=current' };
  try {
    assert.deepEqual(linkTextParts('Open localhost:8788/settings.html.'), [
      { type: 'text', text: 'Open ' },
      { type: 'link', text: 'localhost:8788/settings.html', href: 'http://localhost:8788/settings.html', kind: 'app' },
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
