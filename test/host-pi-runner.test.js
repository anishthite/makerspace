import test from 'node:test';
import assert from 'node:assert/strict';

import { assistantProviderErrorMessage, assistantTraceFields } from '../src/host-pi-runner.js';

test('assistantProviderErrorMessage extracts provider detail from empty assistant errors', () => {
  assert.equal(
    assistantProviderErrorMessage({
      role: 'assistant',
      stopReason: 'error',
      errorMessage: '{"detail":"Unable to fetch authentication verification keys."}',
      content: [],
    }),
    'Unable to fetch authentication verification keys.',
  );
});

test('assistantProviderErrorMessage ignores normal assistant messages', () => {
  assert.equal(
    assistantProviderErrorMessage({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Done' }] }),
    '',
  );
});

test('assistantTraceFields keeps thinking deltas tied to assistant messages', () => {
  assert.deepEqual(
    assistantTraceFields(
      { message: { timestamp: 1234 } },
      { type: 'thinking_delta', contentIndex: 2, partial: { timestamp: 9999 } },
    ),
    { messageTimestamp: 1234, contentIndex: 2 },
  );
  assert.deepEqual(assistantTraceFields({}, { partial: { timestamp: 4567 } }), { messageTimestamp: 4567 });
});
