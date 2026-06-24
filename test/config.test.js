import test from 'node:test';
import assert from 'node:assert/strict';

import { collectForwardedEnv } from '../src/config.js';

test('collectForwardedEnv prefers saved Anthropic key', () => {
  const env = collectForwardedEnv(
    { forwardEnvKeys: ['ANTHROPIC_API_KEY'] },
    { anthropicApiKey: 'fake-anthropic-key' },
  );

  assert.deepEqual(env, [{ key: 'ANTHROPIC_API_KEY', value: 'fake-anthropic-key' }]);
});
