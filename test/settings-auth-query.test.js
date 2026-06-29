import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const settingsHtml = readFileSync(new URL('../public/settings.html', import.meta.url), 'utf8');
const settingsJs = readFileSync(new URL('../public/settings.js', import.meta.url), 'utf8');

test('settings page consumes backend token query params before api calls', () => {
  assert.match(settingsJs, /const connectionParams = new URLSearchParams\(location\.search\);/);
  assert.match(settingsJs, /localStorage\.setItem\('makerspaceApiBase', apiFromUrl\.replace/);
  assert.match(settingsJs, /localStorage\.setItem\('makerspaceApiToken', tokenFromUrl\);/);
  assert.ok(settingsJs.indexOf('tokenFromUrl') < settingsJs.indexOf('async function loadCodexAuth'));
  assert.match(settingsJs, /history\.replaceState/);
});

test('settings page exposes Pi profile editor wiring', () => {
  assert.match(settingsHtml, /id="pi-profile"/);
  assert.match(settingsHtml, /id="pi-agents"/);
  assert.match(settingsHtml, /id="pi-skills"/);
  assert.match(settingsJs, /fetchJson\('\/api\/pi-profile'\)/);
  assert.match(settingsJs, /enabledSkills: checkedResourceIds\(piSkillsList\)/);
});
