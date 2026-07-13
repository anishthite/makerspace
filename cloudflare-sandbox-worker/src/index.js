import { getSandbox, proxyToSandbox } from '@cloudflare/sandbox';

export { Sandbox } from '@cloudflare/sandbox';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const COMMAND_TIMEOUT_MS = 15 * 60_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function bodyJson(request) {
  if (!request.body) return {};
  return request.json().catch(() => ({}));
}

function requireAuth(request, env) {
  const token = env.BROKER_TOKEN || '';
  if (!token) return null;
  const got = request.headers.get('authorization') || '';
  return got === `Bearer ${token}` ? null : json({ error: 'unauthorized' }, 401);
}

function idFrom(pathname) {
  const match = pathname.match(/^\/sessions\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function bridgeHostPattern(env = {}) {
  const configured = String(env.CLOUDFLARE_SANDBOX_PORT_HOSTNAME || 'spanner.sh').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  return configured ? `-bridge.${configured}` : '-bridge.spanner.sh';
}

function shouldProxyToSandbox(url, env) {
  const hostname = url.hostname.toLowerCase();
  return hostname.endsWith(bridgeHostPattern(env)) || /(^|[.-])[^.]*-bridge[.-]/.test(hostname);
}

function errorMessage(error) {
  return error?.message || String(error);
}

function sandbox(env, id, sleepAfter = '15m', keepAlive = true) {
  return getSandbox(env.Sandbox, id, {
    // ponytail: keepAlive avoids silent filesystem loss; manual suspend backs up then destroys.
    transport: 'http',
    sleepAfter,
    keepAlive,
    normalizeId: true,
    enableDefaultSession: false,
    containerTimeouts: { instanceGetTimeoutMS: 60_000, portReadyTimeoutMS: 180_000 },
  });
}

function envObject(envVars = []) {
  return Object.fromEntries((Array.isArray(envVars) ? envVars : [])
    .filter((item) => item?.key && item?.value)
    .map((item) => [String(item.key), String(item.value)]));
}

async function execRoute(request, env, id) {
  const body = await bodyJson(request);
  const result = await sandbox(env, id).exec(String(body.command || 'true'), {
    cwd: body.cwd || undefined,
    timeout: Number(body.timeoutMs || COMMAND_TIMEOUT_MS),
    env: body.env ? envObject(body.env) : undefined,
  });
  return json(result);
}

async function fileRoute(request, env, id, url) {
  const box = sandbox(env, id);
  if (request.method === 'GET') {
    const path = url.searchParams.get('path') || '';
    const encoding = url.searchParams.get('encoding') || '';
    if (!path) return json({ error: 'path is required' }, 400);
    if (encoding && encoding !== 'base64') return json({ error: 'unsupported encoding' }, 400);
    const file = await box.readFile(path, encoding ? { encoding } : undefined);
    return json(encoding ? { ...file, encoding } : file);
  }
  if (request.method === 'PUT') {
    const body = await bodyJson(request);
    if (!body.path) return json({ error: 'path is required' }, 400);
    await box.writeFile(String(body.path), String(body.content || ''));
    return json({ ok: true });
  }
  return json({ error: 'method not allowed' }, 405);
}

function portHostname(url, env) {
  const configured = String(env.CLOUDFLARE_SANDBOX_PORT_HOSTNAME || '').trim();
  if (configured) return configured;
  return url.hostname.startsWith('sandbox.') ? url.hostname.slice('sandbox.'.length) : url.hostname;
}

async function portRoute(request, env, id, url) {
  const port = Number(url.pathname.match(/\/ports\/(\d+)$/)?.[1] || 0);
  if (!port) return json({ error: 'port is required' }, 400);
  const box = sandbox(env, id);
  const hostname = portHostname(url, env);
  try {
    const exposed = await box.exposePort(port, { hostname, name: 'pi-bridge', token: 'bridge' });
    return json({ bridgeUrl: exposed.url, httpsUrl: exposed.url, port: exposed.port });
  } catch (error) {
    if (!box.tunnels?.get) throw error;
    const tunnel = await box.tunnels.get(port);
    const tunnelUrl = tunnel.url || tunnel;
    return json({ bridgeUrl: tunnelUrl, httpsUrl: tunnelUrl, port });
  }
}

async function backupRoute(request, env, id) {
  const body = await bodyJson(request);
  const dir = String(body.dir || '/workspace');
  const backup = await sandbox(env, id).createBackup({
    dir,
    name: body.name || `${id}-backup`,
    ttl: Number(body.ttl || 7 * 24 * 60 * 60),
    // ponytail: R2 binding mode avoids managing separate S3 credentials; revisit for huge repos.
    localBucket: body.localBucket !== false,
  });
  return json({ backup });
}

async function restoreRoute(request, env, id) {
  const body = await bodyJson(request);
  if (!body.backup) return json({ error: 'backup is required' }, 400);
  return json(await sandbox(env, id).restoreBackup(body.backup));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (shouldProxyToSandbox(url, env)) {
      try {
        const proxied = await proxyToSandbox(request, env);
        if (proxied) return proxied;
      } catch (error) {
        return json({ error: errorMessage(error), context: { phase: 'proxy' } }, 502);
      }
    }

    const auth = requireAuth(request, env);
    if (auth) return auth;

    try {
      if (request.method === 'GET' && pathname === '/healthz') return json({ ok: true });
      if (request.method === 'POST' && pathname === '/sessions') {
        const body = await bodyJson(request);
        const name = String(body.name || '').trim();
        if (!name) return json({ error: 'name is required' }, 400);
        await sandbox(env, name, body.sleepAfter || '15m', body.keepAlive !== false).exec('mkdir -p /workspace /home/root/.spanner/control/pi-sessions', { timeout: 60_000 });
        return json({ id: name, name, state: 'ready' });
      }

      const id = idFrom(pathname);
      if (!id) return json({ error: 'not found' }, 404);
      if (request.method === 'DELETE' && pathname === `/sessions/${encodeURIComponent(id)}`) {
        await sandbox(env, id).destroy();
        return json({ ok: true, id, state: 'deleted' });
      }
      if (request.method === 'POST' && pathname.endsWith('/exec')) return execRoute(request, env, id);
      if (pathname.endsWith('/files')) return fileRoute(request, env, id, url);
      if (request.method === 'POST' && pathname.endsWith('/backup')) return backupRoute(request, env, id);
      if (request.method === 'POST' && pathname.endsWith('/restore')) return restoreRoute(request, env, id);
      if (request.method === 'POST' && /\/ports\/\d+$/.test(pathname)) return portRoute(request, env, id, url);
      return json({ error: 'not found' }, 404);
    } catch (error) {
      return json({ error: errorMessage(error) }, 500);
    }
  },
};
