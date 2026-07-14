import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequestHandler } from '../src/server/routes.js';

function responseRecorder() {
  let resolve;
  const done = new Promise((next) => {
    resolve = next;
  });
  const response = {
    headersSent: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body = '') {
      this.body = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
      resolve(this);
    },
    destroy(error) {
      throw error;
    },
  };
  return { response, done };
}

test('control board static route checks owner access before serving', async () => {
  let currentUserCalls = 0;
  let accessCalls = 0;
  let staticCalls = 0;
  const handler = createRequestHandler({
    config: { authRequired: true },
    provider: { info: () => ({ kind: 'test' }) },
    http: {
      bindCorsRequest() {},
      corsHeadersFor: () => ({}),
      sendJson(response, statusCode, payload) {
        response.writeHead(statusCode, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      },
      sendText(response, statusCode, payload, contentType = 'text/plain', headers = {}) {
        response.writeHead(statusCode, { 'content-type': contentType, ...headers });
        response.end(payload);
      },
      readJsonBody: async () => ({}),
      serveStatic: async (pathname, response) => {
        staticCalls += 1;
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(`static:${pathname}`);
      },
    },
    auth: {
      requireApiToken: () => false,
      browserSessionId: () => '',
      hasTrustedControlToken: () => false,
      currentUser: async () => {
        currentUserCalls += 1;
        return { id: 'github-1', login: 'mona' };
      },
      requireControlBoardAccess: async (_request, response) => {
        accessCalls += 1;
        response.writeHead(403, { 'content-type': 'application/json' });
        response.end('{"error":"no"}');
        return null;
      },
    },
    runState: {},
    threads: {},
    sessions: {},
  });
  const { response, done } = responseRecorder();

  await handler({ method: 'GET', url: '/control-board.html', headers: { host: 'localhost:8787' } }, response);
  await done;

  assert.equal(response.statusCode, 403);
  assert.equal(currentUserCalls, 1);
  assert.equal(accessCalls, 1);
  assert.equal(staticCalls, 0);
});

test('static files do not load user auth before serving', async () => {
  let browserSessionCalls = 0;
  let trustedTokenCalls = 0;
  let currentUserCalls = 0;
  const handler = createRequestHandler({
    config: { authRequired: true },
    provider: { info: () => ({ kind: 'test' }) },
    http: {
      bindCorsRequest() {},
      corsHeadersFor: () => ({}),
      sendJson(response, statusCode, payload) {
        response.writeHead(statusCode, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      },
      sendText(response, statusCode, payload, contentType = 'text/plain', headers = {}) {
        response.writeHead(statusCode, { 'content-type': contentType, ...headers });
        response.end(payload);
      },
      readJsonBody: async () => ({}),
      serveStatic: async (pathname, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(`static:${pathname}`);
      },
    },
    auth: {
      requireApiToken: () => false,
      browserSessionId: () => {
        browserSessionCalls += 1;
        return '';
      },
      hasTrustedControlToken: () => {
        trustedTokenCalls += 1;
        return false;
      },
      currentUser: async () => {
        currentUserCalls += 1;
        return null;
      },
    },
    runState: {},
    threads: {},
    sessions: {},
  });
  const { response, done } = responseRecorder();

  await handler({ method: 'GET', url: '/workspace.html', headers: { host: 'localhost:8787' } }, response);
  await done;

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'static:/workspace.html');
  assert.equal(browserSessionCalls, 0);
  assert.equal(trustedTokenCalls, 0);
  assert.equal(currentUserCalls, 0);
});
