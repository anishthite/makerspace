import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const settingsPage = readFileSync(new URL('../frontend/src/pages.jsx', import.meta.url), 'utf8');
const settingsJs = readFileSync(new URL('../frontend/src/runtime/settings.js', import.meta.url), 'utf8');

test('settings page omits URL query token backend controls', () => {
  assert.doesNotMatch(settingsJs, /const connectionParams = new URLSearchParams\(location\.search\);/);
  assert.doesNotMatch(settingsJs, /apiFromUrl|tokenFromUrl|workbenchApiBase|workbenchApiToken/);
  assert.doesNotMatch(settingsPage, /id="api-base"|id="api-token"|id="connection-summary"/);
  assert.doesNotMatch(settingsJs, /connectionSummary/);
  assert.match(settingsJs, /import\.meta\.env\?\.VITE_WORKBENCH_API_BASE/);
});

test('settings page exposes Pi profile editor wiring', () => {
  assert.match(settingsPage, /id="pi-profile"/);
  assert.match(settingsPage, /id="pi-agents"/);
  assert.match(settingsPage, /id="pi-skills"/);
  assert.match(settingsJs, /fetchJson\('\/api\/pi-profile'\)/);
  assert.match(settingsJs, /enabledSkills: checkedResourceIds\(piSkillsList\)/);
});

test('settings page hides unavailable GitHub auth actions', () => {
  assert.match(settingsJs, /githubLogin\.hidden = connected;/);
  assert.match(settingsJs, /githubLogout\.hidden = !connected;/);
  assert.match(settingsJs, /githubLogout\.hidden = true;/);
});
