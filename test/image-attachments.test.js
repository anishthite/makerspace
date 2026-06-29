import test from 'node:test';
import assert from 'node:assert/strict';

import { acceptedImageFiles, bindImageDropZone, clearImageInput, imageInputFiles, updateImageStatus } from '../public/image-attachments.js';

test('acceptedImageFiles keeps supported non-empty images only', () => {
  const png = { name: 'screen.png', type: 'image/png', size: 1 };
  const jpg = { name: 'photo.jpg', type: 'image/jpg', size: 1 };

  assert.deepEqual(
    acceptedImageFiles([
      png,
      { name: 'empty.png', type: 'image/png', size: 0 },
      { name: 'vector.svg', type: 'image/svg+xml', size: 1 },
      { name: 'notes.txt', type: 'text/plain', size: 1 },
      jpg,
    ]),
    [png, jpg],
  );
});

test('bindImageDropZone stores dropped and pasted images without DataTransfer constructor', () => {
  const previousDataTransfer = globalThis.DataTransfer;
  globalThis.DataTransfer = undefined;
  const listeners = new Map();
  const zone = {
    classList: { toggle() {} },
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  const input = { files: [], value: 'set', addEventListener() {} };
  const statusClasses = new Set(['muted']);
  const status = {
    textContent: '',
    classList: {
      toggle(name, enabled) {
        if (enabled) statusClasses.add(name);
        else statusClasses.delete(name);
      },
    },
  };
  const png = { name: 'drop.png', type: 'image/png', size: 1 };
  const webp = { name: 'paste.webp', type: 'image/webp', size: 1 };
  let dropPrevented = false;
  let pastePrevented = false;
  let textPastePrevented = false;

  try {
    bindImageDropZone(zone, input, status);
    listeners.get('drop')?.({
      dataTransfer: { types: ['Files'], files: [png] },
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

    assert.equal(dropPrevented, true);
    assert.equal(pastePrevented, true);
    assert.equal(textPastePrevented, false);
    assert.deepEqual(imageInputFiles(input), [png, webp]);
    assert.equal(status.textContent, '✓ 2 images added');
    assert.equal(statusClasses.has('has-images'), true);
    assert.equal(statusClasses.has('muted'), false);

    clearImageInput(input);
    updateImageStatus(input, status);
    assert.deepEqual(imageInputFiles(input), []);
    assert.equal(input.value, '');
    assert.equal(status.textContent, '');
    assert.equal(statusClasses.has('has-images'), false);
    assert.equal(statusClasses.has('muted'), true);
  } finally {
    if (previousDataTransfer === undefined) delete globalThis.DataTransfer;
    else globalThis.DataTransfer = previousDataTransfer;
  }
});
