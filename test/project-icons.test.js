import test from 'node:test';
import assert from 'node:assert/strict';

import { projectIconName, projectIconSvg } from '../frontend/src/runtime/project-icons.js';

test('project icons pick stable pseudo-random Phosphor line categories', () => {
  const project = { label: 'docs-site', value: 'https://github.com/acme/docs-site.git' };
  assert.equal(projectIconName(project), projectIconName(project));
  assert.equal(
    projectIconName({ label: 'renamed', value: project.value }),
    projectIconName(project),
  );
  assert.equal(projectIconName({ label: 'docs-site' }), projectIconName('docs-site'));
});

test('project icon renderer returns inert inline svg', () => {
  const svg = projectIconSvg({ label: 'docs-site' }, 'project-line-icon custom-icon');
  assert.match(svg, /^<svg class="project-line-icon custom-icon"/);
  assert.match(svg, /viewBox="0 0 256 256"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /<path d="/);
  assert.doesNotMatch(svg, /<script/i);
});
