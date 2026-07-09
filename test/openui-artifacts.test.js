import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractOpenUIArtifacts,
  normalizeOpenUISource,
  openUIActionPrompt,
  stripOpenUIArtifactBlocks,
} from '../frontend/src/runtime/openui-artifacts.js';

test('openui artifact blocks extract and strip safely', () => {
  const text = `Before
\`\`\`openui
root = Card([title])
title = TextContent("Hello", "large-heavy")
\`\`\`
After`;

  const artifacts = extractOpenUIArtifacts(text);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].source, 'root = Card([title])\ntitle = TextContent("Hello", "large-heavy")');
  assert.equal(stripOpenUIArtifactBlocks(text), 'Before\nAfter');
});

test('openui extraction caps count and ignores empty fences', () => {
  const text = '```openui\n\n```\n```openui\na = 1\n```\n```openui-chat\nb = 2\n```\n```openui\nc = 3\n```\n```openui\nd = 4\n```';
  assert.deepEqual(extractOpenUIArtifacts(text).map((entry) => entry.source), ['a = 1', 'b = 2', 'c = 3']);
});

test('openui source accepts a bare component call as the root', () => {
  assert.equal(
    normalizeOpenUISource('Card([title])\ntitle = TextContent("Hi")'),
    'root = Card([title])\ntitle = TextContent("Hi")',
  );
  assert.equal(normalizeOpenUISource('root = Card([])'), 'root = Card([])');
});

test('openui action prompt keeps user review in the composer', () => {
  assert.equal(
    openUIActionPrompt({
      type: 'continue_conversation',
      humanFriendlyMessage: 'Show details',
      formState: { contact: { email: { value: 'a@example.com' } } },
    }),
    '[OpenUI action: continue_conversation]\nShow details\nForm state:\n{\n  "contact": {\n    "email": {\n      "value": "a@example.com"\n    }\n  }\n}',
  );
});
