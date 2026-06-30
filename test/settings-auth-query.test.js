import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const settingsHtml = readFileSync(new URL('../public/settings.html', import.meta.url), 'utf8');
const settingsJs = readFileSync(new URL('../public/settings.js', import.meta.url), 'utf8');
const frontendSettingsJs = readFileSync(new URL('../frontend/src/runtime/settings.js', import.meta.url), 'utf8');

test('settings page omits URL query token backend controls', () => {
  assert.doesNotMatch(settingsJs, /const connectionParams = new URLSearchParams\(location\.search\);/);
  assert.doesNotMatch(settingsJs, /apiFromUrl|tokenFromUrl|makerspaceApiBase|makerspaceApiToken/);
  assert.doesNotMatch(settingsHtml, /id="api-base"|id="api-token"|id="connection-summary"/);
  assert.doesNotMatch(settingsJs, /connectionSummary/);
  assert.match(frontendSettingsJs, /import\.meta\.env\.VITE_MAKERSPACE_API_BASE/);
});

test('settings page exposes Pi profile editor wiring', () => {
  assert.match(settingsHtml, /id="pi-profile"/);
  assert.match(settingsHtml, /id="pi-agents"/);
  assert.match(settingsHtml, /id="pi-skills"/);
  assert.match(settingsJs, /fetchJson\('\/api\/pi-profile'\)/);
  assert.match(settingsJs, /enabledSkills: checkedResourceIds\(piSkillsList\)/);
});
