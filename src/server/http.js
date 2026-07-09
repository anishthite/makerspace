import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { allowedOriginFromEnv } from '../config.js';

const corsRequest = Symbol('spannerCorsRequest');

function normalizeOrigins(...values) {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : String(value || '').split(/[,\n]/)).map((origin) => origin.trim()).filter(Boolean))];
}

export function createHttpHelpers({ publicDir, allowedOrigin = allowedOriginFromEnv(), allowedOrigins = [] }) {
  const configuredOrigins = normalizeOrigins(allowedOrigins, allowedOrigin);
  const staticAliases = new Map([
    ['/homepage', 'desktop.html'],
    ['/desktop', 'desktop.html'],
    ['/thread', 'thread.html'],
    ['/telemetry', 'telemetry.html'],
    ['/local-telemetry', 'local-telemetry.html'],
  ]);

  function corsOriginFor(request) {
    if (!configuredOrigins.length) return '*';
    const origin = String(request?.headers?.origin || '').trim();
    return configuredOrigins.includes(origin) ? origin : configuredOrigins[0];
  }

  function corsHeadersFor(request) {
    const corsOrigin = corsOriginFor(request);
    return {
      'access-control-allow-origin': corsOrigin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization,x-api-token,x-spanner-session',
      ...(configuredOrigins.length > 1 ? { vary: 'origin' } : {}),
      ...(corsOrigin === '*' ? {} : { 'access-control-allow-credentials': 'true' }),
    };
  }

  const corsHeaders = corsHeadersFor();

  function bindCorsRequest(request, response) {
    response[corsRequest] = request;
  }

  function corsHeadersForResponse(response) {
    return corsHeadersFor(response?.[corsRequest]);
  }

  function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', ...corsHeadersForResponse(response) });
    response.end(`${JSON.stringify(payload, null, 2)}\n`);
  }

  function sendText(response, statusCode, payload, contentType = 'text/plain; charset=utf-8', headers = {}) {
    response.writeHead(statusCode, { 'content-type': contentType, ...corsHeadersForResponse(response), ...headers });
    response.end(payload);
  }

  function clientError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }

  function requestToken(request, _url) {
    const authorization = String(request.headers.authorization || '');
    if (authorization.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();
    return String(request.headers['x-api-token'] || '').trim();
  }

  function originFor(request) {
    return `${request.headers['x-forwarded-proto'] || 'http'}://${request.headers['x-forwarded-host'] || request.headers.host || 'localhost'}`;
  }

  async function readJsonBody(request) {
    const chunks = [];

    for await (const chunk of request) {
      chunks.push(chunk);
    }

    const text = Buffer.concat(chunks).toString('utf8').trim();
    return text ? JSON.parse(text) : {};
  }

  function contentTypeFor(filePath) {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
    if (filePath.endsWith('.gif')) return 'image/gif';
    if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
    if (filePath.endsWith('.png')) return 'image/png';
    if (filePath.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
    if (filePath.endsWith('.webp')) return 'image/webp';
    return 'text/plain; charset=utf-8';
  }

  async function serveStatic(requestPath, response) {
    const relativePath = staticAliases.get(requestPath) || (requestPath === '/' ? 'index.html' : requestPath.slice(1));
    const filePath = path.normalize(path.join(publicDir, relativePath));

    if (!filePath.startsWith(publicDir)) {
      sendText(response, 403, 'Forbidden');
      return;
    }

    try {
      const file = await readFile(filePath);
      sendText(response, 200, file, contentTypeFor(filePath));
    } catch (error) {
      if (error.code === 'ENOENT') {
        sendText(response, 404, 'Not found');
        return;
      }

      throw error;
    }
  }

  return {
    corsHeaders,
    corsHeadersFor,
    bindCorsRequest,
    sendJson,
    sendText,
    clientError,
    requestToken,
    originFor,
    readJsonBody,
    contentTypeFor,
    serveStatic,
  };
}
