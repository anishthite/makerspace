import test from 'node:test';
import assert from 'node:assert/strict';

import { extractHtmlOutput, htmlPreviewDocument, looksLikeHtmlOutput } from '../frontend/src/runtime/html-preview.js';

test('looksLikeHtmlOutput accepts full html documents', () => {
  assert.equal(looksLikeHtmlOutput('<!doctype html><html><body><h1>Hello</h1></body></html>'), true);
});

test('extractHtmlOutput unwraps html code fences', () => {
  assert.equal(
    extractHtmlOutput('```html\n<section><h1>Hello</h1><p>World</p></section>\n```'),
    '<section><h1>Hello</h1><p>World</p></section>',
  );
});

test('htmlPreviewDocument wraps fragments with no-scroll app defaults', () => {
  const doc = htmlPreviewDocument('<section><h1>Hello</h1><p>World</p></section>');
  assert.match(doc, /^<!doctype html>/);
  assert.match(doc, /Content-Security-Policy/);
  assert.match(doc, /data-makerspace-preview/);
  assert.match(doc, /overflow: hidden !important/);
});

test('htmlPreviewDocument can wrap fragments with dark defaults', () => {
  const doc = htmlPreviewDocument('<section><h1>Hello</h1><p>World</p></section>', 'dark');
  assert.match(doc, /color-scheme: dark/);
  assert.match(doc, /--bg: #0E1118/);
  assert.match(doc, /--ink: #E6EDF3/);
  assert.match(doc, /--muted: #C8D0E0/);
  assert.match(doc, /html, body \{ background: transparent; \}/);
});

test('htmlPreviewDocument injects no-scroll CSS into full documents', () => {
  const doc = htmlPreviewDocument('<!doctype html><html><head><title>Hello</title></head><body><h1>Hello</h1></body></html>');
  assert.match(doc, /<head><meta http-equiv="Content-Security-Policy"/);
  assert.match(doc, /overflow: hidden !important/);
});

test('plain text stays plain', () => {
  assert.equal(looksLikeHtmlOutput('Use <code>tags</code> in a sentence.'), false);
  assert.equal(htmlPreviewDocument('Use <code>tags</code> in a sentence.'), '');
});
