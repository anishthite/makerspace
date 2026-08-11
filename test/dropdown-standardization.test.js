import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('visible dropdowns use the app select bridge', () => {
  const source = [
    read('frontend/src/styles/app.css'),
    read('frontend/src/components/ui/select.jsx'),
    read('frontend/src/styles/workspace.css'),
    read('frontend/src/styles/thread.css'),
  ].join('\n');
  const ui = read('frontend/src/components/ui.jsx');
  const pages = read('frontend/src/pages.jsx');
  const tracePage = read('frontend/src/trace-components-page.jsx');
  const interactive = read('frontend/src/runtime/interactive-artifacts.js');
  const workspace = read('frontend/src/styles/workspace.css');
  const thread = read('frontend/src/styles/thread.css');

  assert.doesNotMatch(source, /--dropdown-|var\(--dropdown-/);
  assert.match(ui, /export function Select/);
  assert.match(ui, /app-select-native sr-only/);
  assert.match(ui, /MutationObserver/);
  assert.doesNotMatch(ui, /return <select className=\{className\}/);

  assert.match(pages, /<Select id="model-ref" name="modelRef" variant="inline"/);
  assert.match(pages, /<Select id="sidebar-prompt-project-select" variant="prompt"/);
  assert.match(pages, /<Select id="sidebar-model-ref" name="modelRef" variant="prompt"/);
  assert.doesNotMatch(pages, /<ModelPicker|<ProjectPicker|<select/);
  assert.doesNotMatch(tracePage, /<select/);
  assert.doesNotMatch(interactive, /createElement\('select'\)/);

  for (const selector of ['repo-suggestions', 'workspace-switcher-menu', 'sidebar-scope-menu', 'sidebar-thread-menu']) {
    assert.match(workspace, new RegExp(`${selector}[\\s\\S]+border: 1px solid var\\(--rule\\);[\\s\\S]+background: var\\(--paper\\);`));
  }

  assert.match(workspace, /sidebar-prompt-project-picker \[data-slot="select-trigger"\][\s\S]+border-color: transparent !important/);
  assert.match(thread, /\.interactive-select-trigger[\s\S]+background: var\(--paper\)/);
});
