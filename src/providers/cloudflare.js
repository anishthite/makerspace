import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { collectForwardedEnv } from '../config.js';
import { buildSetupScript } from '../setup-script.js';

const DEFAULT_SETUP_PATH = '/tmp/spanner-setup.sh';

function shellQuote(value) {
  const escaped = String(value).replace(/'/g, `'\\''`);
  return `'${escaped}'`;
}

function statusFromRemote(remote = {}) {
  const state = String(remote.state || remote.status || '').toLowerCase();
  if (['ready', 'running', 'started'].includes(state)) return 'ready';
  if (['creating', 'starting', 'restoring'].includes(state)) return 'launching';
  if (['stopped', 'suspended'].includes(state)) return 'suspended';
  if (['deleted', 'destroyed'].includes(state)) return 'deleted';
  if (['error', 'failed'].includes(state)) return 'failed';
  return 'ready';
}

function sandboxName(sessionOrName) {
  const raw = typeof sessionOrName === 'string'
    ? sessionOrName
    : sessionOrName?.workspaceSessionName || sessionOrName?.cloudflareSandboxName || sessionOrName?.sandboxId || sessionOrName?.cloudflareSandboxId || sessionOrName?.name;
  return String(raw || '').trim();
}

function parseBrokerUrl(config) {
  const baseUrl = String(config.cloudflareBrokerUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('CLOUDFLARE_SANDBOX_BROKER_URL is required for the cloudflare provider.');
  return baseUrl;
}

function asJson(value) {
  if (!value || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeRemote(remote = {}, session = {}) {
  const name = remote.name || session.name || '';
  const bridgeUrl = remote.bridgeUrl || remote.httpsUrl || session.bridgeUrl || '';
  return {
    name,
    status: statusFromRemote(remote),
    sshDest: null,
    bridgeMode: true,
    httpsUrl: bridgeUrl,
    bridgeUrl,
    previewToken: remote.previewToken || null,
    connectCommand: remote.connectCommand || null,
    runAgentCommand: remote.runAgentCommand || null,
    tailLogCommand: remote.tailLogCommand || null,
    sandboxId: remote.id || remote.sandboxId || name,
    cloudflareSandboxId: remote.id || remote.sandboxId || name,
    cloudflareSandboxName: remote.name || name,
    cloudflareState: remote.state || remote.status || null,
  };
}

function backupDirs(config) {
  const dirs = [
    { key: 'workspace', dir: config.remoteWorkspaceDir || '/workspace' },
    { key: 'piSessions', dir: path.posix.join(config.remoteControlDir || '/home/root/.spanner/control', 'pi-sessions') },
  ];
  return dirs.filter((item, index, all) => item.dir && all.findIndex((other) => other.dir === item.dir) === index);
}

function isStartupRetry(status, data) {
  if (![500, 502, 503, 504].includes(Number(status))) return false;
  const message = String(data?.error || data?.message || '').toLowerCase();
  const phase = String(data?.context?.phase || '').toLowerCase();
  return ['startup', 'provisioning'].includes(phase) || /container is (starting|currently provisioning|booting)|retry in a moment/.test(message);
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 30_000);
  return Math.min(500 * (2 ** attempt), 5_000);
}

async function parseBrokerResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function brokerRequest(fetchImpl, config, route, options = {}) {
  const baseUrl = parseBrokerUrl(config);
  const startedAt = Date.now();
  const timeoutMs = Number(config.cloudflareBrokerRetryTimeoutMs || config.bridgeReadyTimeoutMs || 240_000);
  const maxRetries = Number(config.cloudflareBrokerRetryAttempts || 80);

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(`${baseUrl}${route}`, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(config.cloudflareBrokerToken ? { authorization: `Bearer ${config.cloudflareBrokerToken}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await parseBrokerResponse(response);
    if (response.ok) return data || {};

    if (attempt < maxRetries && Date.now() - startedAt < timeoutMs && isStartupRetry(response.status, data)) {
      // ponytail: only retry startup handshakes; broad command retries can duplicate side effects.
      const remainingMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
      const delayMs = Math.min(retryDelayMs(response, attempt), remainingMs);
      if (delayMs > 0) await sleep(delayMs);
      continue;
    }

    throw new Error(data?.error || data?.message || `Cloudflare broker request failed: ${response.status}`);
  }
}

function commandForScript(script, cwd) {
  const safeCwd = cwd ? `cd ${shellQuote(cwd)} && ` : '';
  return `${safeCwd}bash -lc ${shellQuote(script)}`;
}

function resultFromExec(result = {}) {
  return {
    exitCode: Number(result.exitCode ?? (result.success === false ? 1 : 0)),
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: result.output || `${result.stdout || ''}${result.stderr || ''}`,
  };
}

export function createCloudflareProvider(config, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for the cloudflare provider.');

  const request = (route, opts) => brokerRequest(fetchImpl, config, route, opts);

  async function exec(sessionOrName, command, opts = {}) {
    const name = sandboxName(sessionOrName);
    const result = await request(`/sessions/${encodeURIComponent(name)}/exec`, {
      method: 'POST',
      body: JSON.stringify({ command, cwd: opts.cwd || '', timeoutMs: opts.timeoutMs || 0, env: opts.env || undefined }),
    });
    const normalized = resultFromExec(result);
    if (opts.onData && normalized.output) opts.onData(normalized.output);
    return normalized;
  }

  async function restoreBackups(session) {
    const backups = Array.isArray(session.cloudflareBackups) ? session.cloudflareBackups : [];
    for (const item of backups) {
      if (!item?.backup) continue;
      await request(`/sessions/${encodeURIComponent(session.name)}/restore`, {
        method: 'POST',
        body: JSON.stringify({ backup: item.backup }),
      });
    }
  }

  async function createBackup(sessionOrName) {
    const name = sandboxName(sessionOrName);
    const created = [];
    for (const item of backupDirs(config)) {
      await exec(name, `mkdir -p ${shellQuote(item.dir)}`);
      const result = await request(`/sessions/${encodeURIComponent(name)}/backup`, {
        method: 'POST',
        body: JSON.stringify({ dir: item.dir, name: `${name}-${item.key}` }),
      });
      if (result.backup) created.push({ ...item, backup: asJson(result.backup) });
    }
    return {
      cloudflareBackups: created,
      cloudflareBackupCreatedAt: new Date().toISOString(),
    };
  }

  return {
    kind: 'cloudflare',
    name: 'cloudflare',
    info() {
      return {
        kind: 'cloudflare',
        transport: 'cloudflare-sandbox-broker',
        ready: Boolean(config.cloudflareBrokerUrl),
        brokerUrl: config.cloudflareBrokerUrl || '',
        machine: config.cloudflareMachine || 'standard-2',
        keepAlive: config.cloudflareKeepAlive !== false,
      };
    },
    envSummary() {
      return {
        provider: 'cloudflare',
        broker: Boolean(config.cloudflareBrokerUrl),
        token: Boolean(config.cloudflareBrokerToken),
        machine: config.cloudflareMachine || 'standard-2',
        keepAlive: config.cloudflareKeepAlive !== false,
        workspace: config.remoteWorkspaceDir,
      };
    },
    async listSessions() {
      return [];
    },
    async createSession(session, imageSettings = {}) {
      const envVars = collectForwardedEnv(config, imageSettings);
      const remote = await request('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: session.name,
          machine: config.cloudflareMachine || 'standard-2',
          sleepAfter: config.cloudflareSleepAfter || '15m',
          keepAlive: config.cloudflareKeepAlive !== false,
          envVars,
        }),
      });
      await restoreBackups(session);
      const setupScript = buildSetupScript(session, config);
      await this.writeRemoteFile(session.name, DEFAULT_SETUP_PATH, setupScript);
      const setup = await exec(session.name, `chmod +x ${shellQuote(DEFAULT_SETUP_PATH)} && ${shellQuote(DEFAULT_SETUP_PATH)}`, { cwd: '/', env: envVars, onData: session.onCreateLog });
      if (setup.exitCode !== 0) throw new Error(`Cloudflare setup failed: ${setup.stderr || setup.stdout || setup.exitCode}`);
      const port = await this.setShare(session.name, { sharePort: session.sharePort || config.bridgePort });
      return normalizeRemote({ ...remote, ...port }, session);
    },
    async destroySession(sessionOrName) {
      const name = sandboxName(sessionOrName);
      await request(`/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' });
      return { name, status: 'deleted', runStatus: 'deleted', cloudflareSandboxId: name };
    },
    async backupSession(session) {
      return createBackup(session);
    },
    async suspendSession(session) {
      const backup = await createBackup(session);
      await this.destroySession(session);
      return { ...backup, status: 'suspended', runStatus: 'suspended', cloudflareSandboxId: session.name };
    },
    async resumeSession(session, imageSettings = {}) {
      return this.createSession(session, imageSettings);
    },
    async deleteSessionWithBackup(session) {
      const backup = await createBackup(session);
      await this.destroySession(session);
      return { ...backup, cloudflareSandboxId: session.cloudflareSandboxId || session.name };
    },
    async runRemoteScript(sessionOrName, script, opts = {}) {
      return exec(sessionOrName, commandForScript(script, opts.cwd), opts);
    },
    async readRemoteFile(sessionOrName, filePath, opts = {}) {
      const name = sandboxName(sessionOrName);
      const params = new URLSearchParams({ path: filePath });
      if (opts.encoding === 'base64') params.set('encoding', 'base64');
      const result = await request(`/sessions/${encodeURIComponent(name)}/files?${params}`);
      if (result.encoding === 'base64') return Buffer.from(String(result.content || ''), 'base64');
      return result.content || '';
    },
    async writeRemoteFile(sessionOrName, filePath, content) {
      const name = sandboxName(sessionOrName);
      await request(`/sessions/${encodeURIComponent(name)}/files`, {
        method: 'PUT',
        body: JSON.stringify({ path: filePath, content: String(content) }),
      });
    },
    async remoteAccess(sessionOrName) {
      const name = sandboxName(sessionOrName);
      await exec(name, 'true');
      return { ok: true };
    },
    async setShare(sessionOrName, options = {}) {
      const name = sandboxName(sessionOrName);
      const port = Number(options.sharePort || config.bridgePort || 4310);
      return request(`/sessions/${encodeURIComponent(name)}/ports/${port}`, { method: 'POST' });
    },
    bridgeHeaders(session = {}) {
      return session.bridgeToken ? { authorization: `Bearer ${session.bridgeToken}` } : {};
    },
  };
}
