import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { acceptedImageFiles, bindImageDropZone, clearImageInput, imageAttachmentSrc, imageInputFiles, updateImageStatus } from '../frontend/src/runtime/image-attachments.js';

function fakeDocument() {
  const doc = { createElement };
  function createElement(tagName) {
    return {
      tagName,
      ownerDocument: doc,
      children: [],
      attributes: {},
      className: '',
      title: '',
      _text: '',
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = [...nodes]; this._text = ''; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      removeAttribute(name) { delete this.attributes[name]; },
      get textContent() { return this._text || this.children.map((child) => child.textContent || '').join(''); },
      set textContent(value) { this._text = String(value); this.children = []; },
    };
  }
  return doc;
}

test('acceptedImageFiles keeps supported non-empty images only', () => {
  const png = { name: 'screen.png', type: 'image/png', size: 1 };
  const jpg = { name: 'photo.jpg', type: 'image/jpg', size: 1 };
  const screenshot = { name: 'Screenshot 2026-08-11.png', type: 'application/octet-stream', size: 1 };
  const unnamedTypeScreenshot = { name: 'Screenshot 2026-08-11.webp', type: '', size: 1 };

  assert.deepEqual(
    acceptedImageFiles([
      png,
      { name: 'empty.png', type: 'image/png', size: 0 },
      { name: 'vector.svg', type: 'image/svg+xml', size: 1 },
      { name: 'notes.txt', type: 'text/plain', size: 1 },
      jpg,
      screenshot,
      unnamedTypeScreenshot,
    ]),
    [png, jpg, screenshot, unnamedTypeScreenshot],
  );
});

test('updateImageStatus previews screenshots with inferred image MIME', () => {
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  const previousRevokeObjectURL = globalThis.URL.revokeObjectURL;
  const seen = [];
  const status = fakeDocument().createElement('span');
  status.classList = { toggle() {} };
  const screenshot = {
    name: 'Screenshot 2026-08-13.png',
    type: 'application/octet-stream',
    size: 12,
    slice(start, end, type) { return { name: this.name, size: end - start, type }; },
  };

  try {
    globalThis.URL.createObjectURL = (blob) => {
      seen.push(blob);
      return `blob:${blob.type || 'none'}`;
    };
    globalThis.URL.revokeObjectURL = () => {};

    updateImageStatus({ files: [screenshot] }, status);

    assert.equal(seen[0]?.type, 'image/png');
    assert.equal(status.children[1]?.children[0]?.src, 'blob:image/png');
  } finally {
    if (previousCreateObjectURL === undefined) delete globalThis.URL.createObjectURL;
    else globalThis.URL.createObjectURL = previousCreateObjectURL;
    if (previousRevokeObjectURL === undefined) delete globalThis.URL.revokeObjectURL;
    else globalThis.URL.revokeObjectURL = previousRevokeObjectURL;
  }
});

test('new-thread modal binds its image input as a drop zone', () => {
  const pages = readFileSync(new URL('../frontend/src/components/agent-sidebar.jsx', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../frontend/src/runtime/sidebar-prompt-lightbox.js', import.meta.url), 'utf8');

  assert.match(pages, /<form id="sidebar-prompt-form" className="sidebar-prompt-lightbox-shell" noValidate>/);
  assert.match(pages, /<input id="sidebar-prompt-images" className="image-input" name="images" type="file"/);
  assert.match(runtime, /bindImageDropZone\(form, images, imageStatus\);/);
});

test('imageAttachmentSrc builds safe data URLs only', () => {
  assert.equal(imageAttachmentSrc({ mimeType: 'image/png', data: 'cG5n' }), 'data:image/png;base64,cG5n');
  assert.equal(imageAttachmentSrc({ mimeType: 'image/svg+xml', data: 'PHN2Zz4=' }), '');
  assert.equal(imageAttachmentSrc({ mimeType: 'image/png', data: 'not base64!' }), '');
});

test('bindImageDropZone stores dropped and pasted images without DataTransfer constructor', () => {
  const previousDataTransfer = globalThis.DataTransfer;
  const previousCreateObjectURL = globalThis.URL.createObjectURL;
  const previousRevokeObjectURL = globalThis.URL.revokeObjectURL;
  const revokedUrls = [];
  let createdUrlCount = 0;
  globalThis.DataTransfer = undefined;
  globalThis.URL.createObjectURL = (file) => `blob:${file.name}:${++createdUrlCount}`;
  globalThis.URL.revokeObjectURL = (url) => revokedUrls.push(url);
  const listeners = new Map();
  const zone = {
    classList: { toggle() {} },
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  const input = { files: [], value: 'set', addEventListener() {} };
  const statusClasses = new Set(['muted']);
  const status = fakeDocument().createElement('span');
  status.classList = {
    toggle(name, enabled) {
      if (enabled) statusClasses.add(name);
      else statusClasses.delete(name);
    },
  };
  const png = { name: 'drop.png', type: 'image/png', size: 1 };
  const webp = { name: 'paste.webp', type: 'image/webp', size: 1 };
  let dragOverPrevented = false;
  let dropPrevented = false;
  let pastePrevented = false;
  let textPastePrevented = false;

  try {
    bindImageDropZone(zone, input, status);
    const dragTransfer = { types: [], items: [{ kind: 'file' }], files: [], dropEffect: '' };
    listeners.get('dragover')?.({
      dataTransfer: dragTransfer,
      preventDefault() { dragOverPrevented = true; },
    });
    listeners.get('drop')?.({
      dataTransfer: { types: [], files: [png] },
      preventDefault() { dropPrevented = true; },
    });
    listeners.get('paste')?.({
      clipboardData: { files: [], items: [{ type: 'image/webp', getAsFile: () => webp }] },
      preventDefault() { pastePrevented = true; },
    });
    listeners.get('paste')?.({
      clipboardData: { files: [] },
      preventDefault() { textPastePrevented = true; },
    });

    assert.equal(dragOverPrevented, true);
    assert.equal(dragTransfer.dropEffect, 'copy');
    assert.equal(dropPrevented, true);
    assert.equal(pastePrevented, true);
    assert.equal(textPastePrevented, false);
    assert.deepEqual(imageInputFiles(input), [png, webp]);
    assert.equal(status.textContent, '2 images added');
    assert.equal(status.attributes['aria-label'], '2 images added');
    assert.equal(status.children.filter((child) => child.className === 'attachment-preview').length, 2);
    assert.deepEqual(status.children.slice(1).map((child) => child.children[0]?.src), ['blob:drop.png:2', 'blob:paste.webp:3']);
    assert.equal(statusClasses.has('has-images'), true);
    assert.equal(statusClasses.has('muted'), false);

    clearImageInput(input);
    updateImageStatus(input, status);
    assert.deepEqual(imageInputFiles(input), []);
    assert.equal(input.value, '');
    assert.equal(status.textContent, '');
    assert.equal(status.children.length, 0);
    assert.equal(status.attributes['aria-label'], undefined);
    assert.deepEqual(revokedUrls, ['blob:drop.png:1', 'blob:drop.png:2', 'blob:paste.webp:3']);
    assert.equal(statusClasses.has('has-images'), false);
    assert.equal(statusClasses.has('muted'), true);
  } finally {
    if (previousDataTransfer === undefined) delete globalThis.DataTransfer;
    else globalThis.DataTransfer = previousDataTransfer;
    if (previousCreateObjectURL === undefined) delete globalThis.URL.createObjectURL;
    else globalThis.URL.createObjectURL = previousCreateObjectURL;
    if (previousRevokeObjectURL === undefined) delete globalThis.URL.revokeObjectURL;
    else globalThis.URL.revokeObjectURL = previousRevokeObjectURL;
  }
});
