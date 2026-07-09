import test from 'node:test';
import assert from 'node:assert/strict';

import { allowedOriginFromEnv, allowedOriginsFromEnv } from '../src/config.js';
import { createAuthService } from '../src/server/auth.js';
import { createHttpHelpers } from '../src/server/http.js';

function authHttpStub() {
  return {
    sendJson(response, status, payload) {
      response.status = status;
      response.payload = payload;
    },
    requestToken() {
      return '';
    },
    originFor() {
      return 'https://api.example';
    },
    clientError(message, statusCode = 400) {
      const error = new Error(message);
      error.statusCode = statusCode;
      return error;
    },
  };
}

test('Spanner origin env enables credentialed CORS', () => {
  const allowedOrigin = allowedOriginFromEnv({ SPANNER_ALLOWED_ORIGIN: 'https://spanner.example' });
  const { corsHeaders } = createHttpHelpers({ publicDir: '/tmp', allowedOrigin });

  assert.equal(corsHeaders['access-control-allow-origin'], 'https://spanner.example');
  assert.equal(corsHeaders['access-control-allow-credentials'], 'true');
});

test('public app origin remains a generic fallback', () => {
  assert.equal(allowedOriginFromEnv({ PUBLIC_APP_ORIGIN: 'https://public.example' }), 'https://public.example');
});

test('comma-separated Spanner origins reflect the requesting allowed origin', () => {
  const allowedOrigins = allowedOriginsFromEnv({
    SPANNER_ALLOWED_ORIGIN: 'https://preview.example, https://prod.example',
  });
  const { corsHeadersFor } = createHttpHelpers({ publicDir: '/tmp', allowedOrigins });

  assert.deepEqual(allowedOrigins, ['https://preview.example', 'https://prod.example']);
  assert.equal(corsHeadersFor({ headers: { origin: 'https://prod.example' } })['access-control-allow-origin'], 'https://prod.example');
  assert.equal(corsHeadersFor({ headers: { origin: 'https://prod.example' } })['access-control-allow-credentials'], 'true');
  assert.equal(corsHeadersFor({ headers: { origin: 'https://evil.example' } })['access-control-allow-origin'], 'https://preview.example');
});

test('plural Spanner origins env wins over singular origin env', () => {
  assert.deepEqual(allowedOriginsFromEnv({
    SPANNER_ALLOWED_ORIGINS: 'https://one.example,https://two.example',
    SPANNER_ALLOWED_ORIGIN: 'https://old.example',
  }), ['https://one.example', 'https://two.example']);
});

test('auth mutation origin checks use the full origin list', () => {
  const auth = createAuthService({
    config: {
      authRequired: true,
      allowedOrigins: ['https://preview.example', 'https://prod.example'],
      githubClientSecret: 'secret',
    },
    http: authHttpStub(),
  });

  assert.equal(auth.requireAuthMutationOrigin({ headers: { origin: 'https://prod.example' } }, {}, new URL('https://api.example/api/auth/logout')), false);

  const response = {};
  assert.equal(auth.requireAuthMutationOrigin({ headers: { origin: 'https://evil.example' } }, response, new URL('https://api.example/api/auth/logout')), true);
  assert.equal(response.status, 403);
});
