import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { applyAppearance } from '../frontend/src/runtime/appearance.js';

test('applies the fixed app appearance', (t) => {
  const oldDocument = globalThis.document;
  const oldDesktop = globalThis.spannerDesktop;
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
    if (oldDesktop === undefined) delete globalThis.spannerDesktop;
    else globalThis.spannerDesktop = oldDesktop;
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  });

  assert.deepEqual(applyAppearance(), { theme: 'light', font: 'inter', palette: 'terra' });
  assert.deepEqual(globalThis.document.documentElement.dataset, { theme: 'light', font: 'inter', palette: 'terra' });
  assert.deepEqual(toggles, [['dark', false]]);

  globalThis.spannerDesktop = {};
  assert.deepEqual(applyAppearance(), { theme: 'light', font: 'inter', palette: 'terra' });
  assert.deepEqual(globalThis.document.documentElement.dataset, { theme: 'light', font: 'inter', palette: 'terra', desktop: 'true' });
});

test('pins app typography to Inter', () => {
  const styles = readFileSync(new URL('../frontend/src/styles/app.css', import.meta.url), 'utf8');
  const fluidUi = readFileSync(new URL('../frontend/src/styles/fluid-ui.css', import.meta.url), 'utf8');
  const appPages = ['index', 'workspace', 'thread', 'history', 'telemetry', 'local-telemetry', 'settings']
    .map((name) => readFileSync(new URL(`../frontend/${name}.html`, import.meta.url), 'utf8'))
    .join('\n');

  assert.match(styles, /--font-family-ui:\s*'Inter Variable', Inter,/);
  assert.match(styles, /--font-family-code:\s*var\(--font-family-ui\)/);
  assert.match(styles, /--mono:\s*var\(--font-family-code\)/);
  assert.doesNotMatch(styles, /hack-font|JetBrains Mono/);
  assert.match(fluidUi, /--font-mono: var\(--font-sans\);/);
  assert.match(fluidUi, /--mono: var\(--font-sans\);/);
  assert.doesNotMatch(appPages, /JetBrains|Noto Serif|Saira|Shippori/);
});
