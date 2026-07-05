import test from 'node:test';
import assert from 'node:assert/strict';

import { allowedOriginFromEnv } from '../src/config.js';
import { createHttpHelpers } from '../src/server/http.js';

test('legacy Makerspace origin env enables credentialed CORS', () => {
  const allowedOrigin = allowedOriginFromEnv({ MAKERSPACE_ALLOWED_ORIGIN: 'https://make.thite.site' });
  const { corsHeaders } = createHttpHelpers({ publicDir: '/tmp', allowedOrigin });

  assert.equal(corsHeaders['access-control-allow-origin'], 'https://make.thite.site');
  assert.equal(corsHeaders['access-control-allow-credentials'], 'true');
});

test('Workbench origin env wins over legacy alias', () => {
  assert.equal(allowedOriginFromEnv({
    WORKBENCH_ALLOWED_ORIGIN: 'https://workbench.example',
    MAKERSPACE_ALLOWED_ORIGIN: 'https://makerspace.example',
  }), 'https://workbench.example');
});
