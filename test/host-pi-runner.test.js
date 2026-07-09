import test from 'node:test';
import assert from 'node:assert/strict';

import { assistantProviderErrorMessage } from '../src/host-pi-runner.js';

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
