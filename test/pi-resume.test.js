import test from 'node:test';
import assert from 'node:assert/strict';

import { buildThreadResumeEntries } from '../src/host-pi-runner.js';

test('thread resume entries rebuild prior turns without duplicating current prompt', () => {
  const entries = buildThreadResumeEntries({
    name: 'local-thread-1',
    createdAt: '2026-06-25T00:00:00.000Z',
    taskPrompt: 'continue now',
    submittedAtMs: Date.parse('2026-06-25T00:03:00.000Z'),
    threadMessages: [
      { role: 'user', text: 'start here', timestamp: '2026-06-25T00:01:00.000Z', runId: '1' },
      { role: 'assistant', text: 'started', timestamp: '2026-06-25T00:02:00.000Z', runId: '1' },
      { role: 'user', text: 'continue now', timestamp: '2026-06-25T00:03:00.000Z', runId: String(Date.parse('2026-06-25T00:03:00.000Z')) },
    ],
  }, '/tmp/project');

  assert.equal(entries[0].type, 'session');
  assert.deepEqual(entries.slice(1).map((entry) => entry.message.role), ['user', 'assistant']);
  assert.equal(entries[1].message.content, 'start here');
  assert.equal(entries[2].message.content[0].text, 'started');
  assert.equal(entries[2].parentId, entries[1].id);
});
