import test from 'node:test';
import assert from 'node:assert/strict';

import { submitOnEnter } from '../public/submit-on-enter.js';

function bind() {
  const listeners = new Map();
  const textarea = { addEventListener: (type, listener) => listeners.set(type, listener) };
  let submits = 0;
  const button = { disabled: false };
  submitOnEnter(textarea, { requestSubmit: () => submits += 1 }, button);
  return { button, handler: listeners.get('keydown'), submits: () => submits };
}

function keydown(handler, overrides = {}) {
  const event = {
    defaultPrevented: false,
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    preventDefault() { this.defaultPrevented = true; },
    ...overrides,
  };
  handler(event);
  return event;
}

test('submitOnEnter sends plain Enter only', () => {
  const { button, handler, submits } = bind();

  assert.equal(keydown(handler).defaultPrevented, true);
  assert.equal(submits(), 1);

  for (const override of [
    { key: 'a' },
    { shiftKey: true },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { isComposing: true },
    { defaultPrevented: true },
  ]) {
    assert.equal(keydown(handler, override).defaultPrevented, Boolean(override.defaultPrevented));
  }

  button.disabled = true;
  assert.equal(keydown(handler).defaultPrevented, false);
  assert.equal(submits(), 1);
});
