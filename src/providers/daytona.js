import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { collectForwardedEnv } from '../config.js';
import { buildSetupScript } from '../setup-script.js';

const APP_LABEL_KEY = 'spanner';
const APP_LABEL_VALUE = '1';
const SESSION_LABEL_KEY = 'spannerSession';
const OWNER_LABEL_KEY = 'spannerOwner';
const DEFAULT_SETUP_PATH = '/tmp/spanner-setup.sh';

function shellQuote(value) {
  const escaped = String(value).replace(/'/g, `'\\''`);
  return `'${escaped}'`;
}

function parseResourceNumber(value) {
  const match = String(value || '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function buildResources(config) {
  const cpu = parseResourceNumber(config.defaultCpu);
  const memory = parseResourceNumber(config.defaultMemory);
  const disk = parseResourceNumber(config.defaultDisk);
  const resources = {};

  if (Number.isFinite(cpu) && cpu > 0) resources.cpu = cpu;
  if (Number.isFinite(memory) && memory > 0) resources.memory = memory;
  if (Number.isFinite(disk) && disk > 0) resources.disk = disk;

  return Object.keys(resources).length ? resources : undefined;
}

function statusFromSandbox(sandbox) {
  const state = String(sandbox?.state || sandbox?.status || '').toLowerCase();

  if (['started', 'running'].includes(state)) return 'ready';
  if (['starting', 'creating', 'pulling_snapshot', 'pending_build', 'building_snapshot', 'restoring'].includes(state)) return 'launching';
  if (['error', 'build_failed'].includes(state)) return 'failed';
  if (['stopped', 'archived'].includes(state)) return 'stopped';
  if (['stopping', 'archiving'].includes(state)) return 'stopping';
  return state || 'unknown';
}

function normalizeSandbox(raw, fallbackName, extra = {}) {
  const sandbox = raw?.sandbox || raw || {};
  const name = sandbox.name || sandbox.id || fallbackName;
  const connectTarget = sandbox.id || sandbox.name || name;

  return {
    name,
    status: statusFromSandbox(sandbox),
    sshDest: null,
    httpsUrl: extra.httpsUrl || extra.bridgeUrl || null,
    bridgeUrl: extra.bridgeUrl || extra.httpsUrl || null,
    previewToken: extra.previewToken || null,
    connectCommand: connectTarget ? `daytona ssh ${connectTarget}` : null,
    runAgentCommand: connectTarget ? `daytona ssh ${connectTarget} -- bash ${extra.remoteControlDir || '/srv/spanner'}/run-pi.sh` : null,
    tailLogCommand: connectTarget ? `daytona ssh ${connectTarget} -- tail -n 120 ${extra.remoteControlDir || '/srv/spanner'}/pi.log` : null,
    daytonaSandboxId: sandbox.id || null,
    daytonaSandboxName: sandbox.name || name || null,
    daytonaState: sandbox.state || null,
  };
}

function isMissingSandboxError(error) {
  return /not found|404|deleted|destroyed|does not exist|No Daytona sandbox found/i.test(String(error?.message || error || ''));
}

function isDuplicateSandboxError(error) {
  return /already exists|conflict|409/i.test(String(error?.message || error || ''));
}

function ensureOk(result, command) {
  const exitCode = Number(result?.exitCode ?? 0);
  const stdout = String(result?.artifacts?.stdout ?? result?.stdout ?? result?.result ?? '');
  const stderr = String(result?.artifacts?.stderr ?? result?.stderr ?? '');
  const output = result?.output ?? stdout + (stderr ? `\n${stderr}` : '');

  if (exitCode !== 0) {
    throw new Error(String(output || `${command} exited with code ${exitCode}`).trim());
  }

  return { stdout, stderr, output, exitCode };
}

async function collectSandboxes(value) {
  value = await value;
  if (!value) return [];
  if (Array.isArray(value)) return value;
  const sandboxes = [];
  if (typeof value[Symbol.asyncIterator] === 'function') {
    for await (const sandbox of value) sandboxes.push(sandbox);
    return sandboxes;
  }
  if (typeof value[Symbol.iterator] === 'function') return [...value];
  return [];
}

function safeSnapshotName(sessionOrName) {
  const raw = typeof sessionOrName === 'string' ? sessionOrName : sessionOrName?.name;
  const slug = String(raw || 'sandbox')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'sandbox';
  return `spanner-${slug}-${randomUUID().slice(0, 8)}`;
}

async function loadDaytonaClass() {
  const sdk = await import('@daytona/sdk');
  return sdk.Daytona;
}

async function safeCreateFolder(sandbox, dir) {
  await sandbox.process.executeCommand(`mkdir -p ${shellQuote(dir)}`, '/', undefined, 60);
}

async function safeUploadFile(sandbox, filePath, content) {
  await safeCreateFolder(sandbox, path.posix.dirname(filePath));
  await sandbox.fs.uploadFile(Buffer.from(content, 'utf8'), filePath);
}

function buildCommand(script, cwd = '/') {
  return `cd ${shellQuote(cwd)} && bash -lc ${shellQuote(script)}`;
}

async function emitLaunchLog(session, imageSettings, phase, details = {}) {
  const payload = { session: session?.name || '', phase, ...details };
  console.info('[spanner][daytona]', JSON.stringify(payload));
  if (typeof imageSettings?.onLaunchLog !== 'function') return;
  try {
    await imageSettings.onLaunchLog(phase, details);
  } catch (error) {
    console.warn(`[spanner][daytona] launch log callback failed for ${session?.name || 'session'}: ${error.message}`);
  }
}

export function createDaytonaProvider(config, options = {}) {
  let clientPromise = null;
  const sandboxCache = new Map();

  async function getClient() {
    if (options.daytonaClient) return options.daytonaClient;
    if (!clientPromise) {
      clientPromise = loadDaytonaClass().then((Daytona) => new Daytona({
        apiKey: config.daytonaApiKey || process.env.DAYTONA_API_KEY,
        apiUrl: config.daytonaApiUrl || undefined,
        target: config.daytonaTarget || undefined,
      }));
    }
    return clientPromise;
  }

  async function listSandboxesForSession(name) {
    const client = await getClient();
    const labels = { [APP_LABEL_KEY]: APP_LABEL_VALUE, [SESSION_LABEL_KEY]: name };
    return collectSandboxes(client.list({ labels }));
  }

  async function getSandboxBySession(sessionOrName) {
    const name = typeof sessionOrName === 'string' ? sessionOrName : sessionOrName?.name;
    const id = typeof sessionOrName === 'object'
      ? sessionOrName.daytonaSandboxId || sessionOrName.sandboxId || sessionOrName.daytonaSandboxName
      : null;
    const cacheKey = id || name;

    if (cacheKey && sandboxCache.has(cacheKey)) {
      return sandboxCache.get(cacheKey);
    }

    const client = await getClient();
    let sandbox = null;

    if (id && client.get) {
      try {
        sandbox = await client.get(id);
      } catch (error) {
        if (!isMissingSandboxError(error)) throw error;
      }
    }

    if (!sandbox && name) {
      const matches = await listSandboxesForSession(name).catch(() => []);
      sandbox = matches[0] || null;
    }

    if (!sandbox && name && client.get) {
      try {
        sandbox = await client.get(name);
      } catch (error) {
        if (!isMissingSandboxError(error)) throw error;
      }
    }

    if (!sandbox) {
      throw new Error(`No Daytona sandbox found for ${name || id || 'session'}.`);
    }

    if (cacheKey) sandboxCache.set(cacheKey, sandbox);
    return sandbox;
  }

  async function ensureStarted(sandbox) {
    if (sandbox.refreshData) await sandbox.refreshData().catch(() => {});
    const state = String(sandbox.state || '').toLowerCase();

    if (state === 'started' || state === 'running') return sandbox;

    if (state === 'stopped' || state === 'archived') {
      await sandbox.start?.();
    }

    if (sandbox.waitUntilStarted) {
      await sandbox.waitUntilStarted();
    }

    if (sandbox.refreshData) await sandbox.refreshData().catch(() => {});
    return sandbox;
  }

  async function applyLifecycle(sandbox) {
    const autostop = Number(config.daytonaAutostopMinutes);
    const autodelete = Number(config.daytonaAutodeleteMinutes);

    if (Number.isFinite(autostop) && autostop >= 0) {
      const fn = sandbox.setAutostopInterval || sandbox.setAutoStopInterval;
      await fn?.call(sandbox, autostop).catch(() => {});
    }

    if (Number.isFinite(autodelete) && autodelete >= -1) {
      await sandbox.setAutoDeleteInterval?.(autodelete).catch(() => {});
    }
  }

  async function previewFor(sandbox, port) {
    const normalizedPort = Number(port);
    if (!Number.isFinite(normalizedPort) || normalizedPort <= 0 || !sandbox.getPreviewLink) {
      return {};
    }

    const preview = await sandbox.getPreviewLink(normalizedPort);
    return {
      bridgeUrl: preview?.url || null,
      httpsUrl: preview?.url || null,
      previewToken: preview?.token || null,
    };
  }

  async function setSuspendAutodelete(sandbox) {
    const interval = Number(config.daytonaSuspendAutodeleteMinutes ?? -1);
    if (Number.isFinite(interval) && interval >= -1) {
      await sandbox.setAutoDeleteInterval?.(interval);
    }
  }

  async function scrubSandboxForSnapshot(sandbox) {
    const remoteUser = config.remoteUser || 'daytona';
    const remoteHomeDir = config.remoteHomeDir || `/home/${remoteUser}`;
    const controlDir = config.remoteControlDir || '/srv/spanner';
    const script = [
      'set -euo pipefail',
      `rm -f ${shellQuote(`${controlDir}/bridge-env.sh`)} ${shellQuote(`${controlDir}/TASK.md`)}`,
      `rm -f ${shellQuote(`${remoteHomeDir}/.git-credentials`)} ${shellQuote(`${remoteHomeDir}/.config/gh/hosts.yml`)}`,
      `rm -f ${shellQuote(`${remoteHomeDir}/.pi/agent/auth.json`)} ${shellQuote(`${remoteHomeDir}/.pi/agent/settings.json`)}`,
    ].join('\n');
    await executeScriptInSandbox(sandbox, script, { timeoutMs: 30_000 });
  }

  async function snapshotSandboxBeforeDelete(sandbox, sessionOrName, options = {}) {
    const snapshotName = options.snapshotName || safeSnapshotName(sessionOrName);
    if (typeof sandbox._experimental_createSnapshot !== 'function') {
      throw new Error('Installed Daytona SDK does not expose sandbox snapshot creation.');
    }
    await scrubSandboxForSnapshot(sandbox);
    await sandbox._experimental_createSnapshot(snapshotName, Math.max(1, Math.ceil((options.timeoutMs || 10 * 60_000) / 1000)));
    return snapshotName;
  }

  async function createSandbox(session, imageSettings = {}) {
    const client = await getClient();
    const hasStoredRef = Boolean(session.daytonaSandboxId || session.sandboxId || session.daytonaSandboxName);

    if (hasStoredRef) {
      try {
        return ensureStarted(await getSandboxBySession(session));
      } catch (error) {
        if (!isMissingSandboxError(error)) throw error;
      }
    }

    const existing = await listSandboxesForSession(session.name).catch(() => []);
    if (existing[0]) {
      return ensureStarted(existing[0]);
    }

    const selectedImage = imageSettings.imageRef || config.image;
    const forwardedEnv = collectForwardedEnv(config, imageSettings);
    const envVars = Object.fromEntries(forwardedEnv.map(({ key, value }) => [key, value]));
    const resources = buildResources(config);
    const createParams = {
      name: session.name,
      labels: {
        [APP_LABEL_KEY]: APP_LABEL_VALUE,
        [SESSION_LABEL_KEY]: session.name,
        ...(session.ownerUserId ? { [OWNER_LABEL_KEY]: session.ownerUserId } : {}),
      },
      envVars: {
        ...envVars,
        SPANNER_SESSION_NAME: session.name,
        ...(session.ownerUserId ? { SPANNER_OWNER_USER_ID: session.ownerUserId } : {}),
      },
      user: config.remoteUser || 'daytona',
      public: false,
      autoStopInterval: Number(config.daytonaAutostopMinutes),
      autoDeleteInterval: Number(config.daytonaAutodeleteMinutes),
      ...(selectedImage
        ? { image: selectedImage, ...(resources ? { resources } : {}) }
        : { ...(config.daytonaSnapshot ? { snapshot: config.daytonaSnapshot } : {}) }),
    };

    let sandbox;
    try {
      sandbox = await client.create(createParams, { timeout: config.bridgeReadyTimeoutMs / 1000 });
    } catch (error) {
      if (!isDuplicateSandboxError(error)) throw error;
      sandbox = await getSandboxBySession(session);
    }
    sandboxCache.set(session.name, sandbox);
    if (sandbox.id) sandboxCache.set(sandbox.id, sandbox);
    await applyLifecycle(sandbox);
    return ensureStarted(sandbox);
  }

  async function waitForSessionCommandExit(processApi, sessionId, cmdId, deadline) {
    if (!processApi.getSessionCommand) {
      throw new Error('Command did not report exit code');
    }

    let info = null;
    while (true) {
      if (Date.now() > deadline) break;
      info = await processApi.getSessionCommand(sessionId, cmdId);
      if (info?.exitCode != null) {
        const exitCode = Number(info.exitCode);
        if (Number.isFinite(exitCode)) return { ...info, exitCode };
      }
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Command did not report exit code');
  }

  async function executeScriptInSandbox(sandbox, script, options = {}) {
    const cwd = options.cwd || '/';
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 120_000;
    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    const commandStartTimeoutSec = Math.min(timeoutSec, 60);
    const command = buildCommand(script, cwd);
    const processApi = sandbox.process;
    const canStream = Boolean(
      options.onData &&
      processApi.createSession &&
      processApi.executeSessionCommand &&
      processApi.getSessionCommandLogs,
    );

    if (canStream) {
      if (options.signal?.aborted) {
        throw new Error('Script aborted');
      }

      const sessionId = `spanner-${randomUUID()}`;
      const deadline = Date.now() + timeoutMs;
      let deleteSessionPromise = null;
      async function closeSession() {
        if (deleteSessionPromise) return deleteSessionPromise;
        deleteSessionPromise = (processApi.deleteSession?.(sessionId) || Promise.resolve()).catch(() => {});
        return deleteSessionPromise;
      }
      const cleanup = [];
      function clearCleanup() {
        cleanup.forEach((fn) => fn());
        cleanup.length = 0;
      }
      try {
        await processApi.createSession(sessionId).catch((error) => {
          if (!/already exists/i.test(String(error?.message || error))) throw error;
        });
        if (options.signal?.aborted) {
          throw new Error('Script aborted');
        }

        const started = await processApi.executeSessionCommand(
          sessionId,
          { command, runAsync: true },
          commandStartTimeoutSec,
        );
        const cmdId = started?.cmdId || started?.id;
        if (!cmdId) {
          throw new Error(`Daytona did not return a command id for: ${command}`);
        }

        let stdout = '';
        let stderr = '';
        const logPromise = processApi.getSessionCommandLogs(
          sessionId,
          cmdId,
          (chunk) => {
            stdout += chunk;
            options.onData(Buffer.from(String(chunk)));
          },
          (chunk) => {
            stderr += chunk;
            options.onData(Buffer.from(String(chunk)));
          },
        );
        logPromise.catch(() => {});

        const remaining = Math.max(0, deadline - Date.now());
        if (remaining <= 0) {
          throw new Error(`Command timeout after ${timeoutMs}ms`);
        }

        const timeoutPromise = new Promise((_, reject) => {
          const id = setTimeout(() => {
            closeSession().catch(() => {});
            reject(new Error(`Command timeout after ${timeoutMs}ms`));
          }, remaining);
          cleanup.push(() => clearTimeout(id));
        });

        let signalPromise = null;
        if (options.signal) {
          signalPromise = new Promise((_, reject) => {
            if (options.signal.aborted) {
              reject(new Error('Script aborted'));
              return;
            }
            const handler = () => {
              closeSession().catch(() => {});
              reject(new Error('Script aborted'));
            };
            options.signal.addEventListener('abort', handler, { once: true });
            cleanup.push(() => options.signal.removeEventListener('abort', handler));
          });
        }

        const race = signalPromise ? [logPromise, timeoutPromise, signalPromise] : [logPromise, timeoutPromise];
        await Promise.race(race);
        clearCleanup();

        const final = await waitForSessionCommandExit(processApi, sessionId, cmdId, deadline);
        return ensureOk({ ...final, stdout, stderr, output: stdout + (stderr ? `\n${stderr}` : '') }, command);
      } finally {
        clearCleanup();
        await closeSession();
      }
    }

    const result = await processApi.executeCommand(command, cwd, undefined, timeoutSec);
    const normalized = ensureOk(result, command);
    if (normalized.output && options.onData) options.onData(Buffer.from(normalized.output));
    return normalized;
  }

  return {
    kind: 'daytona',
    info() {
      return {
        kind: 'daytona',
        transport: '@daytona/sdk',
        ready: Boolean(config.daytonaApiKey || process.env.DAYTONA_API_KEY),
        note: 'Requires DAYTONA_API_KEY on the control backend.',
        env: {
          apiKey: Boolean(config.daytonaApiKey || process.env.DAYTONA_API_KEY),
          apiUrl: Boolean(config.daytonaApiUrl || process.env.DAYTONA_API_URL),
          target: Boolean(config.daytonaTarget || process.env.DAYTONA_TARGET),
          snapshot: Boolean(config.daytonaSnapshot || process.env.DAYTONA_SNAPSHOT),
          autostopMinutes: config.daytonaAutostopMinutes,
          autodeleteMinutes: config.daytonaAutodeleteMinutes,
        },
      };
    },
    bridgeHeaders(session) {
      return session?.previewToken ? { 'x-daytona-preview-token': session.previewToken } : {};
    },
    shouldRefreshSession(session) {
      const autostop = Number(config.daytonaAutostopMinutes);
      if (!Number.isFinite(autostop) || autostop <= 0) return false;
      const updatedAtMs = Date.parse(session?.updatedAt || session?.createdAt || '');
      return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs >= autostop * 60 * 1000;
    },
    async listSessions() {
      const client = await getClient();
      const sandboxes = await collectSandboxes(client.list({ labels: { [APP_LABEL_KEY]: APP_LABEL_VALUE } }));
      return sandboxes.map((sandbox) => normalizeSandbox(sandbox, sandbox.name || sandbox.id, {
        remoteControlDir: config.remoteControlDir,
      }));
    },
    async createSession(session, imageSettings = {}) {
      try {
        await emitLaunchLog(session, imageSettings, 'daytona:create:start', {
          bridgeMode: Boolean(session.bridgeMode),
          hasImage: Boolean(imageSettings.imageRef || config.image),
          sharePort: session.sharePort || null,
        });
        const sandbox = await createSandbox(session, imageSettings);
        await emitLaunchLog(session, imageSettings, 'daytona:create:done', {
          sandboxId: sandbox.id || null,
          state: sandbox.state || null,
        });
        await emitLaunchLog(session, imageSettings, 'daytona:setup:upload', { path: DEFAULT_SETUP_PATH });
        await safeUploadFile(sandbox, DEFAULT_SETUP_PATH, buildSetupScript(session, {
          ...config,
          forwardedEnv: collectForwardedEnv(config, imageSettings),
        }));
        await emitLaunchLog(session, imageSettings, 'daytona:setup:run', { timeoutMs: 15 * 60 * 1000 });
        await executeScriptInSandbox(sandbox, `chmod +x ${shellQuote(DEFAULT_SETUP_PATH)} && ${shellQuote(DEFAULT_SETUP_PATH)}`, {
          timeoutMs: 15 * 60 * 1000,
        });
        await emitLaunchLog(session, imageSettings, 'daytona:setup:done');

        const previewPort = session.bridgeMode ? config.bridgePort : session.sharePort;
        let preview = {};
        if (session.bridgeMode || session.sharePort) {
          await emitLaunchLog(session, imageSettings, 'daytona:preview:start', { port: previewPort });
          preview = await previewFor(sandbox, previewPort);
          await emitLaunchLog(session, imageSettings, 'daytona:preview:done', {
            hasPreviewUrl: Boolean(preview.bridgeUrl || preview.httpsUrl),
            hasPreviewToken: Boolean(preview.previewToken),
            port: previewPort,
          });
        }

        const normalized = normalizeSandbox(sandbox, session.name, {
          ...preview,
          remoteControlDir: config.remoteControlDir,
        });
        await emitLaunchLog(session, imageSettings, 'daytona:session:ready', {
          daytonaState: normalized.daytonaState || '',
          hasBridgeUrl: Boolean(normalized.bridgeUrl),
        });
        return normalized;
      } catch (error) {
        await emitLaunchLog(session, imageSettings, 'daytona:error', { error: error.message });
        throw error;
      }
    },
    async setShare(name, options = {}) {
      const sandbox = await ensureStarted(await getSandboxBySession(name));
      const preview = await previewFor(sandbox, options.sharePort || config.bridgePort);
      return normalizeSandbox(sandbox, name, {
        ...preview,
        remoteControlDir: config.remoteControlDir,
      });
    },
    async suspendSession(session) {
      const sandbox = await getSandboxBySession(session);
      await setSuspendAutodelete(sandbox);
      if (sandbox.stop) {
        await sandbox.stop(60, false);
      } else {
        const client = await getClient();
        await client.stop?.(sandbox);
      }
      if (sandbox.refreshData) await sandbox.refreshData().catch(() => {});
      return normalizeSandbox(sandbox, typeof session === 'string' ? session : session?.name, {
        remoteControlDir: config.remoteControlDir,
      });
    },
    async resumeSession(session, imageSettings = {}) {
      return this.createSession(session, imageSettings);
    },
    async deleteSessionWithSnapshot(session, options = {}) {
      const sandbox = await ensureStarted(await getSandboxBySession(session));
      const snapshotName = await snapshotSandboxBeforeDelete(sandbox, session, options);
      if (sandbox.delete) {
        await sandbox.delete(60);
      } else {
        const client = await getClient();
        await client.delete(sandbox, 60);
      }
      const name = typeof session === 'string' ? session : session?.name;
      sandboxCache.delete(name);
      if (sandbox.id) sandboxCache.delete(sandbox.id);
      return {
        snapshotName,
        snapshotCreatedAt: new Date().toISOString(),
        daytonaSandboxId: sandbox.id || null,
        daytonaSandboxName: sandbox.name || name || null,
      };
    },
    async destroySession(name) {
      const sandbox = await getSandboxBySession(name);
      if (sandbox.delete) {
        await sandbox.delete(60);
      } else {
        const client = await getClient();
        await client.delete(sandbox, 60);
      }
      sandboxCache.delete(name);
      if (sandbox.id) sandboxCache.delete(sandbox.id);
    },
    async readOutput(session, options = {}) {
      const offset = Number.isFinite(options.offset) && options.offset > 0 ? options.offset : 0;
      const sandboxId = session?.daytonaSandboxId || session?.sandboxId || session?.daytonaSandboxName || session?.name;

      if (!sandboxId) {
        return {
          chunk: '',
          nextOffset: offset,
          runStatus: 'launching',
        };
      }

      try {
        const sandbox = await ensureStarted(await getSandboxBySession(session));
        const result = await executeScriptInSandbox(sandbox, buildOutputCommand(config, offset), {
          timeoutMs: 8_000,
        });
        return parseOutputEnvelope(result.stdout || result.output, offset);
      } catch (error) {
        if (isTransientSandboxError(error)) {
          return {
            chunk: '',
            nextOffset: offset,
            runStatus: session.runStatus || session.status || 'launching',
          };
        }
        throw error;
      }
    },
    async runRemoteScript(session, script, options = {}) {
      const sandbox = await ensureStarted(await getSandboxBySession(session));
      return executeScriptInSandbox(sandbox, script, options);
    },
    async readRemoteFile(session, absolutePath) {
      const sandbox = await ensureStarted(await getSandboxBySession(session));
      return sandbox.fs.downloadFile(absolutePath);
    },
    async writeRemoteFile(session, absolutePath, content) {
      const sandbox = await ensureStarted(await getSandboxBySession(session));
      await safeUploadFile(sandbox, absolutePath, content);
    },
    async remoteAccess(session, absolutePath, mode = 'read') {
      const test = mode === 'read-write'
        ? `test -r ${shellQuote(absolutePath)} && test -w ${shellQuote(absolutePath)}`
        : `test -r ${shellQuote(absolutePath)}`;
      await this.runRemoteScript(session, test, { timeoutMs: 45_000 });
    },
  };
}

function buildOutputCommand(config, offset) {
  const logPath = `${config.remoteControlDir}/pi.log`;
  const statusPath = `${config.remoteControlDir}/STATUS`;
  const normalizedOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;

  return [
    'set -eu',
    `LOG_PATH=${shellQuote(logPath)}`,
    `STATUS_PATH=${shellQuote(statusPath)}`,
    `OFFSET=${normalizedOffset}`,
    'SIZE="$OFFSET"',
    'CHUNK=""',
    'if [ -f "$LOG_PATH" ]; then',
    '  SIZE=$(wc -c < "$LOG_PATH" | tr -d " ")',
    '  if [ "$SIZE" -gt "$OFFSET" ]; then',
    '    CHUNK=$(tail -c "+$((OFFSET + 1))" "$LOG_PATH" | base64 | tr -d "\\n")',
    '  fi',
    'fi',
    'printf "__MC_CHUNK__%s\\n" "$CHUNK"',
    'printf "__MC_OFFSET__%s\\n" "$SIZE"',
    'printf "__MC_STATUS__"',
    'if [ -f "$STATUS_PATH" ]; then',
    '  cat "$STATUS_PATH"',
    'else',
    '  printf "unknown"',
    'fi',
    'printf "\\n"',
  ].join('\n');
}

function parseOutputEnvelope(text, fallbackOffset) {
  const chunkMatch = String(text || '').match(/__MC_CHUNK__(.*)\n__MC_OFFSET__/s);
  const offsetMatch = String(text || '').match(/__MC_OFFSET__(\d+)\n/);
  const statusMatch = String(text || '').match(/__MC_STATUS__(.*)$/s);
  const chunk = chunkMatch?.[1]
    ? Buffer.from(chunkMatch[1].trim(), 'base64').toString('utf8')
    : '';

  return {
    chunk,
    nextOffset: Number(offsetMatch?.[1] || fallbackOffset || 0),
    runStatus: statusMatch?.[1]?.trim() || 'unknown',
  };
}

export function isTransientSandboxError(error) {
  const message = String(error?.message || error?.code || error || '');

  return [
    'timed out after',
    'timeout of',
    'did not reach',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ECONNABORTED',
    'EAI_AGAIN',
    'ENOTFOUND',
    'UND_ERR_SOCKET',
    'not started',
    'starting',
    'temporarily unavailable',
  ].some((part) => message.includes(part));
}
