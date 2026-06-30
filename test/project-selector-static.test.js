import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('project selector offers desktop local folders', () => {
  const pages = read('frontend/src/pages.jsx');
  const project = read('frontend/src/runtime/project.js');
  const settingsJs = read('frontend/src/runtime/settings.js');
  const styles = read('frontend/public/styles.css');
  const app = read('frontend/src/runtime/app.js');

  assert.match(pages, /project-choose-folder/);
  assert.match(pages, /choose local folder/i);
  assert.match(pages, /className="project-target repo-input"[\s\S]*project-choose-folder/);
  assert.doesNotMatch(pages, /project-provider-banner/);
  assert.match(project, /makerspaceDesktop\?\.chooseFolder/);
  assert.match(project, /makerspaceSelectedProject/);
  assert.match(project, /\/api\/recent-projects/);
  assert.match(project, /project-running-badge/);
  assert.match(project, /cache: 'no-store'/);
  assert.match(project, /function refreshProjectThreads\(\)/);
  assert.match(project, /await refreshProjectThreads\(\);[\s\S]+await loadGitHubRepos\(\);/);
  assert.match(project, /function effectiveThreadStatus\(thread\)/);
  assert.match(project, /runningAgentCount/);
  assert.match(pages, /href="\/settings\.html#codex"/);
  assert.match(pages, /href="\/settings\.html#github"/);
  assert.match(pages, /id="codex"/);
  assert.match(pages, /id="github"/);
  assert.match(settingsJs, /function openWebCodexTab\(\)/);
  assert.match(settingsJs, /function navigateCodexTab\(codexTab, url\)/);
  assert.match(settingsJs, /globalThis\.open\?\.\('about:blank', '_blank'\)/);
  assert.match(styles, /\.home-actions \.auth-pill \{[^}]*border-color: transparent;/);
  assert.match(app, /readSelectedProject/);
  assert.match(app, /repoPath: repoInput/);
});
