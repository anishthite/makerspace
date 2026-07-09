import test from 'node:test';
import assert from 'node:assert/strict';

import {
  actionPrompt,
  extractInteractiveArtifacts,
  stripInteractiveArtifactBlocks,
  validateInteractiveArtifact,
} from '../frontend/src/runtime/interactive-artifacts.js';

test('interactive artifact blocks parse, normalize, and strip safely', () => {
  const text = `Before
\`\`\`workbench-ui
{"version":1,"title":"Tune","controls":[{"id":"detail","type":"slider","label":"Detail","min":1,"max":10,"default":7}],"actions":[{"id":"apply","label":"Apply","delivery":"followUp","prompt":"Revise with detail={{detail}}."}]}
\`\`\`
After`;

  const artifacts = extractInteractiveArtifacts(text);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].artifact.title, 'Tune');
  assert.deepEqual(artifacts[0].artifact.controls[0], {
    id: 'detail',
    type: 'slider',
    label: 'Detail',
    help: '',
    min: 1,
    max: 10,
    step: 1,
    default: 7,
  });
  assert.equal(stripInteractiveArtifactBlocks(text), 'Before\nAfter');
});

test('interactive artifacts accept legacy makerspace-ui alias and fail closed on invalid actions', () => {
  assert.equal(extractInteractiveArtifacts('```makerspace-ui\n{"version":1,"title":"Alias","actions":[{"id":"go","label":"Go","prompt":"x"}]}\n```').length, 1);
  assert.equal(validateInteractiveArtifact({
    version: 1,
    title: 'Bad',
    actions: [{ id: 'send', label: 'Send', delivery: 'now', prompt: 'Nope' }],
  }), null);
  assert.equal(extractInteractiveArtifacts('```workbench-ui\nnot json\n```').length, 0);
});

test('interactive action prompts interpolate visible values', () => {
  assert.equal(
    actionPrompt({ id: 'apply', label: 'Apply', prompt: 'Use {{tone}} and {{items}}.' }, { tone: 'brief', items: ['a', 'b'] }),
    '[UI action: Apply]\nUse brief and a, b.',
  );
});
