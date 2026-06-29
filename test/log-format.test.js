import test from 'node:test';
import assert from 'node:assert/strict';

import { outputEventsFromText } from '../src/log-format.js';

test('outputEventsFromText promotes system lines without timestamp prefixes', () => {
  assert.deepEqual(outputEventsFromText('[system] Starting\nagent output\n[system] Done\n'), [
    {
      type: 'log',
      source: 'system',
      message: 'Starting',
      chunk: '[system] Starting\n',
    },
    { type: 'chunk', chunk: 'agent output\n' },
    {
      type: 'log',
      source: 'system',
      message: 'Done',
      chunk: '[system] Done\n',
    },
  ]);
});

test('outputEventsFromText strips legacy timestamp prefixes from system lines', () => {
  assert.deepEqual(outputEventsFromText('[2026-06-16T18:30:00.000Z] [system] Starting\n'), [
    {
      type: 'log',
      source: 'system',
      message: 'Starting',
      chunk: '[system] Starting\n',
    },
  ]);
});
