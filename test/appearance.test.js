import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

  assert.deepEqual(applyAppearance(), { theme: 'dark', font: 'inter', palette: 'slate' });
  assert.deepEqual(globalThis.document.documentElement.dataset, { theme: 'dark', font: 'inter', palette: 'slate' });
  assert.deepEqual(toggles, [['dark', true]]);

  globalThis.makerspaceDesktop = {};
  assert.deepEqual(applyAppearance(), { theme: 'dark', font: 'inter', palette: 'slate' });
  assert.deepEqual(globalThis.document.documentElement.dataset, { theme: 'dark', font: 'inter', palette: 'slate', desktop: 'true' });
});

test('pins app typography to Inter', () => {
  const styles = readFileSync(new URL('../frontend/public/styles.css', import.meta.url), 'utf8');
  const fluidUi = readFileSync(new URL('../frontend/src/styles/fluid-ui.css', import.meta.url), 'utf8');
  const appPages = ['index', 'workspace', 'thread', 'history', 'telemetry', 'local-telemetry', 'settings']
    .map((name) => readFileSync(new URL(`../frontend/${name}.html`, import.meta.url), 'utf8'))
    .join('\n');

  assert.match(styles, /--mono: 'Inter'/);
  assert.match(styles, /--sans: var\(--mono\)/);
  assert.doesNotMatch(styles, /hack-font|JetBrains Mono/);
  assert.match(fluidUi, /--font-mono: var\(--font-sans\);/);
  assert.match(fluidUi, /--mono: var\(--font-sans\);/);
  assert.doesNotMatch(appPages, /JetBrains|Noto Serif|Saira|Shippori/);
});
