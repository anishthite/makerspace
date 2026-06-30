import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('project selector offers desktop local folders', () => {
  const index = read('public/index.html');
  const project = read('public/project.js');
  const workspace = read('public/workspace.html');
  const settings = read('public/settings.html');
  const styles = read('public/styles.css');
  const app = read('public/app.js');

  assert.match(index, /project-choose-folder/);
  assert.match(index, /\/project\.js\?v=agent-refresh-1/);
  assert.match(index, /choose local folder/i);
  assert.match(index, /target-input project-target repo-input[\s\S]*project-choose-folder/);
  assert.doesNotMatch(index, /project-provider-banner/);
  assert.match(project, /makerspaceDesktop\?\.chooseFolder/);
  assert.match(project, /makerspaceSelectedProject/);
  assert.match(project, /\/api\/recent-projects/);
  assert.match(project, /project-running-badge/);
  assert.match(project, /cache: 'no-store'/);
  assert.match(project, /function refreshProjectThreads\(\)/);
  assert.match(project, /await refreshProjectThreads\(\);\n    await loadGitHubRepos\(\);/);
  assert.match(project, /function effectiveThreadStatus\(thread\)/);
  assert.match(project, /runningAgentCount/);
  assert.match(index, /href="\/settings\.html#codex"/);
  assert.match(index, /href="\/settings\.html#github"/);
  assert.match(workspace, /href="\/settings\.html#codex"/);
  assert.match(workspace, /href="\/settings\.html#github"/);
  assert.match(settings, /id="codex"/);
  assert.match(settings, /id="github"/);
  assert.match(styles, /\.home-actions \.auth-pill \{[^}]*border-color: transparent;/);
  assert.match(app, /readSelectedProject/);
  assert.match(app, /repoPath: repoInput/);
});
