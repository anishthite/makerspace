import test from 'node:test';
import assert from 'node:assert/strict';

import { getAppearance, normalizeAppearance, saveAppearance } from '../public/appearance.js';

test('normalizes appearance preferences', () => {
  assert.deepEqual(normalizeAppearance({ theme: 'dark', font: 'mono', palette: 'graphite' }), { theme: 'dark', font: 'mono', palette: 'graphite' });
  assert.deepEqual(normalizeAppearance({ theme: 'light', font: 'sans', palette: 'nerv-os' }), { theme: 'light', font: 'sans', palette: 'nerv-os' });
  assert.deepEqual(normalizeAppearance({ theme: 'dark', font: 'mono', palette: 'lcl-reactor' }), { theme: 'dark', font: 'mono', palette: 'lcl-reactor' });
  assert.deepEqual(normalizeAppearance({ theme: 'system', font: 'serif', palette: 'neon' }), { theme: 'dark', font: 'mono', palette: 'slate' });
});

test('saves and applies appearance preferences', (t) => {
  const oldDocument = globalThis.document;
  const oldStorage = globalThis.localStorage;
  const oldDesktop = globalThis.makerspaceDesktop;
  const store = new Map();
  globalThis.document = { documentElement: { dataset: {} } };
  globalThis.localStorage = {
    getItem: (key) => store.get(key) || '',
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  t.after(() => {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
    if (oldDesktop === undefined) delete globalThis.makerspaceDesktop;
    else globalThis.makerspaceDesktop = oldDesktop;
  });

  assert.deepEqual(getAppearance(), { theme: 'dark', font: 'mono', palette: 'slate' });

  saveAppearance({ theme: 'light', font: 'sans', palette: 'lcl-reactor' });
  assert.deepEqual(getAppearance(), { theme: 'light', font: 'sans', palette: 'lcl-reactor' });
  assert.equal(store.get('makerspaceTheme'), 'light');
  assert.equal(store.get('makerspaceFont'), 'sans');
  assert.equal(store.get('makerspaceDarkPalette'), 'lcl-reactor');
  assert.deepEqual(globalThis.document.documentElement.dataset, { theme: 'light', font: 'sans', palette: 'lcl-reactor' });

  saveAppearance({ theme: 'dark', font: 'mono', palette: 'slate' });
  assert.equal(store.has('makerspaceTheme'), false);
  assert.equal(store.has('makerspaceFont'), false);
  assert.equal(store.has('makerspaceDarkPalette'), false);
  assert.deepEqual(globalThis.document.documentElement.dataset, { theme: 'dark', font: 'mono', palette: 'slate' });

  globalThis.makerspaceDesktop = {};
  saveAppearance({ theme: 'dark', font: 'mono', palette: 'midnight' });
  assert.deepEqual(globalThis.document.documentElement.dataset, { theme: 'dark', font: 'mono', palette: 'midnight', desktop: 'true' });
});
