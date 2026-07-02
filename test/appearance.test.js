import test from 'node:test';
import assert from 'node:assert/strict';

import { applyAppearance } from '../frontend/src/runtime/appearance.js';

test('applies the fixed app appearance', (t) => {
  const oldDocument = globalThis.document;
  const oldDesktop = globalThis.makerspaceDesktop;
  const oldStorage = globalThis.localStorage;
  const toggles = [];
  globalThis.document = {
    documentElement: {
      dataset: {},
      classList: { toggle: (name, value) => toggles.push([name, value]) },
    },
  };
  globalThis.localStorage = { getItem: () => assert.fail('appearance storage should not be read') };
  t.after(() => {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldDesktop === undefined) delete globalThis.makerspaceDesktop;
    else globalThis.makerspaceDesktop = oldDesktop;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  });

  assert.deepEqual(applyAppearance(), { theme: 'dark', font: 'mono', palette: 'slate' });
  assert.deepEqual(globalThis.document.documentElement.dataset, { theme: 'dark', font: 'mono', palette: 'slate' });
  assert.deepEqual(toggles, [['dark', true]]);

  globalThis.makerspaceDesktop = {};
  assert.deepEqual(applyAppearance(), { theme: 'dark', font: 'mono', palette: 'slate' });
  assert.deepEqual(globalThis.document.documentElement.dataset, { theme: 'dark', font: 'mono', palette: 'slate', desktop: 'true' });
});
