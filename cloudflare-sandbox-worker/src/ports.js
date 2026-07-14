export const DEFAULT_PORT_HOSTNAME = 'spanner.sh';
export const BRIDGE_PORT_TOKEN = 'bridge';

export function cleanHostname(value) {
  const raw = String(value || '').trim().replace(/\/+$/g, '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return parsed.hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
  } catch {
    return raw.toLowerCase().replace(/^\.+|\.+$/g, '');
  }
}

export function bridgeHostPattern(env = {}) {
  const configured = cleanHostname(env.CLOUDFLARE_SANDBOX_PORT_HOSTNAME || DEFAULT_PORT_HOSTNAME);
  return `-${BRIDGE_PORT_TOKEN}.${configured || DEFAULT_PORT_HOSTNAME}`;
}

export function portHostname(url, env) {
  const configured = cleanHostname(env.CLOUDFLARE_SANDBOX_PORT_HOSTNAME);
  if (configured) return configured;
  const hostname = cleanHostname(url.hostname);
  if (hostname.startsWith('sandbox.')) return hostname.slice('sandbox.'.length);
  return hostname.endsWith('.workers.dev') ? DEFAULT_PORT_HOSTNAME : hostname || DEFAULT_PORT_HOSTNAME;
}

export function stablePortUrl(port, id, hostname, protocol = 'https:') {
  const host = cleanHostname(hostname);
  if (!port || !id || !host || host === 'localhost' || host.endsWith('.localhost')) return '';
  const scheme = protocol === 'http:' ? 'http' : 'https';
  return `${scheme}://${port}-${id}-${BRIDGE_PORT_TOKEN}.${host}`;
}

export function portUrl(value, port, id, hostname, protocol = 'https:') {
  if (typeof value === 'string' && value) return value;
  return value?.url || value?.href || stablePortUrl(port, id, hostname, protocol);
}
