import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function createHttpHelpers({ publicDir }) {
  const allowedOrigin = process.env.MAKERSPACE_ALLOWED_ORIGIN || process.env.PUBLIC_APP_ORIGIN || '*';
  const corsHeaders = {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-api-token,x-makerspace-session',
    ...(allowedOrigin === '*' ? {} : { 'access-control-allow-credentials': 'true' }),
  };

  function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders });
    response.end(`${JSON.stringify(payload, null, 2)}\n`);
  }

  function sendText(response, statusCode, payload, contentType = 'text/plain; charset=utf-8', headers = {}) {
    response.writeHead(statusCode, { 'content-type': contentType, ...corsHeaders, ...headers });
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
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1);
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
