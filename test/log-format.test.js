import test from 'node:test';
import assert from 'node:assert/strict';

import { timestampSystemLines } from '../src/log-format.js';

test('timestampSystemLines prefixes only system log lines', () => {
  assert.equal(
    timestampSystemLines('[system] Starting\nagent output\n[system] Done\n', '2026-06-16T18:30:00.000Z'),
    '[2026-06-16T18:30:00.000Z] [system] Starting\nagent output\n[2026-06-16T18:30:00.000Z] [system] Done\n',
  );
});
