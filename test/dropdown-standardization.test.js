import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('dropdowns reuse the main model-picker chrome without extra tokens', () => {
  const source = [
    read('frontend/src/styles/app.css'),
    read('frontend/src/components/ui/select.jsx'),
    read('frontend/src/styles/workspace.css'),
    read('frontend/src/styles/thread.css'),
  ].join('\n');
  const select = read('frontend/src/components/ui/select.jsx');
  const ui = read('frontend/src/components/ui.jsx');
  const pages = read('frontend/src/pages.jsx');
  const workspace = read('frontend/src/styles/workspace.css');
  const thread = read('frontend/src/styles/thread.css');

  assert.doesNotMatch(source, /--dropdown-|var\(--dropdown-/);
  assert.match(workspace, /\.model-picker select \{ appearance: none; cursor: pointer; color: var\(--ink-2\); font-weight: 600; \}/);
  assert.match(select, /bg-\[var\(--paper\)\][\s\S]+focus:bg-\[var\(--blue-soft\)\]/);
  assert.match(ui, /export function ProjectPicker/);
  assert.match(ui, /MutationObserver/);
  assert.match(pages, /<ProjectPicker id="sidebar-prompt-project-select"/);
  assert.doesNotMatch(pages, /<Select id="sidebar-prompt-project-select"/);

  for (const selector of ['repo-suggestions', 'workspace-switcher-menu', 'sidebar-scope-menu', 'sidebar-thread-menu']) {
    assert.match(workspace, new RegExp(`${selector}[\\s\\S]+border: 1px solid var\\(--rule\\);[\\s\\S]+background: var\\(--paper\\);`));
  }

  assert.match(workspace, /repo-suggestion\.is-active \{ background: var\(--blue-soft\)/);
  assert.match(workspace, /workspace-switcher-project\[aria-current="page"\][\s\S]+background: var\(--blue-soft\)/);
  assert.match(thread, /\.interactive-control select,[\s\S]+border: 1px solid var\(--rule\);[\s\S]+background: var\(--paper\)/);
});
