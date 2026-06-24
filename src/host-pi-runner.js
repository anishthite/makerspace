import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isTransientSandboxError } from './provider.js';

let sdkPromise = null;
let toolDefinitionsPromise = null;

function shellQuote(value) {
  const escaped = String(value).replace(/'/g, `'\\''`);
  return `'${escaped}'`;
}

function splitLines(text) {
  return String(text || '').split(/\r?\n/);
}

function textFromContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      if (part.type === 'text') return String(part.text || '');
      return '';
    })
    .join('');
}

function resultText(result) {
  return textFromContent(result?.content);
}

function formatToolLabel(event) {
  if (event.toolName === 'bash' && event.args && typeof event.args.command === 'string') {
    const firstLine = event.args.command.split(/\r?\n/)[0]?.trim() || 'bash';
    return `bash: ${firstLine.slice(0, 120)}`;
  }

  return String(event.toolName || 'tool');
}

function getDefaultPiPackageDir() {
  const nodePrefix = path.resolve(path.dirname(process.execPath), '..');
  return path.join(nodePrefix, 'lib', 'node_modules', '@earendil-works', 'pi-coding-agent');
}

function getPiPackageDir(config = {}) {
  return config.piSdkPackageDir || process.env.PI_SDK_PACKAGE_DIR || getDefaultPiPackageDir();
}

async function loadSdk(config = {}) {
  if (!sdkPromise) {
    sdkPromise = import(pathToFileURL(path.join(getPiPackageDir(config), 'dist', 'index.js')).href);
  }

  return sdkPromise;
}

async function loadToolDefinitions(config = {}) {
  if (!toolDefinitionsPromise) {
    toolDefinitionsPromise = import(pathToFileURL(path.join(getPiPackageDir(config), 'dist', 'core', 'tools', 'index.js')).href);
  }

  return toolDefinitionsPromise;
}

export async function preloadHostPiRunner(config) {
  await Promise.all([loadSdk(config), loadToolDefinitions(config)]);
}

function createRemoteControl(config, remoteReadyPromise, provider) {
  let remoteSession = null;

  async function getRemoteSession() {
    if (!remoteSession) {
      remoteSession = await remoteReadyPromise;
    }
    return remoteSession;
  }

  async function runRemoteScript(script, options = {}) {
    const startedAt = Date.now();

    while (true) {
      const remote = await getRemoteSession();

      try {
        return await provider.runRemoteScript(remote, script, {
          timeoutMs: options.timeoutMs || 120_000,
          signal: options.signal,
          onData: options.onData,
        });
      } catch (error) {
        if (!isTransientSandboxError(error) || Date.now() - startedAt > config.bridgeReadyTimeoutMs) {
          throw error;
        }
      }
    }
  }

  async function readRemoteFile(absolutePath) {
    return provider.readRemoteFile(await getRemoteSession(), absolutePath);
  }

  async function writeRemoteFile(absolutePath, content) {
    await provider.writeRemoteFile(await getRemoteSession(), absolutePath, content);
  }

  async function remoteAccess(absolutePath, mode = 'read') {
    await provider.remoteAccess(await getRemoteSession(), absolutePath, mode);
  }

  return {
    getRemoteSession,
    runRemoteScript,
    readRemoteFile,
    writeRemoteFile,
    remoteAccess,
  };
}

async function createRemoteToolDefinitions(config, remoteReadyPromise, provider) {
  const tools = await loadToolDefinitions(config);
  const remote = createRemoteControl(config, remoteReadyPromise, provider);
  const cwd = config.remoteWorkspaceDir;
  const readOps = {
    readFile: remote.readRemoteFile,
    access: (absolutePath) => remote.remoteAccess(absolutePath, 'read'),
    detectImageMimeType: async () => null,
  };
  const writeOps = {
    writeFile: remote.writeRemoteFile,
    mkdir: (dir) => remote.runRemoteScript(`mkdir -p ${shellQuote(dir)}\n`, { timeoutMs: 45_000 }).then(() => undefined),
  };
  const editOps = {
    readFile: remote.readRemoteFile,
    writeFile: remote.writeRemoteFile,
    access: (absolutePath) => remote.remoteAccess(absolutePath, 'read-write'),
  };

  return [
    tools.createReadToolDefinition(cwd, { operations: readOps }),
    tools.createBashToolDefinition(cwd, {
      operations: {
        exec: async (command, workingDirectory, options = {}) => {
          const script = [
            `cd ${shellQuote(workingDirectory || cwd)}`,
            command,
          ].join('\n');
          const timeoutMs = options.timeout ? Math.max(1, Number(options.timeout)) * 1000 : 120_000;
          await remote.runRemoteScript(script, {
            timeoutMs,
            signal: options.signal,
            onData: options.onData,
          });
          return { exitCode: 0 };
        },
      },
    }),
    tools.createEditToolDefinition(cwd, { operations: editOps }),
    tools.createWriteToolDefinition(cwd, { operations: writeOps }),
  ];
}

async function createHostPiSession(config, remoteReadyPromise, provider) {
  const sdk = await loadSdk(config);
  const customTools = await createRemoteToolDefinitions(config, remoteReadyPromise, provider);
  return sdk.createAgentSession({
    cwd: config.rootDir,
    sessionManager: sdk.SessionManager.inMemory(config.rootDir),
    tools: ['read', 'bash', 'edit', 'write'],
    customTools,
  });
}

export async function runHostPiSession({ session, config, provider, remoteReadyPromise, emitOutput, emitMetric, emitStatus, emitEvent }) {
  const submittedAtMs = Number(session.submittedAtMs) || Date.now();
  let piSession = null;
  let unsubscribe = null;
  let firstProviderCallPublished = false;
  const toolOutput = new Map();

  try {
    const created = await createHostPiSession(config, remoteReadyPromise, provider);
    piSession = created.session;
    const originalStreamFn = piSession.agent.streamFn;
    piSession.agent.streamFn = async (...args) => {
      if (!firstProviderCallPublished) {
        firstProviderCallPublished = true;
        const nowMs = Date.now();
        await emitMetric({
          type: 'metric',
          metric: 'first_llm_call_start',
          runStatus: 'running',
          latencyMs: nowMs - submittedAtMs,
          submittedAtMs,
          firstLlmCallStartedAtMs: nowMs,
        });
      }

      return originalStreamFn(...args);
    };

    unsubscribe = piSession.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        emitOutput(event.assistantMessageEvent.delta, 'running');
        return;
      }

      if (event.type === 'tool_execution_start') {
        emitEvent?.({
          type: 'tool',
          phase: 'start',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          label: formatToolLabel(event),
          args: event.args || null,
          runStatus: 'running',
        });
        return;
      }

      if (event.type === 'tool_execution_update') {
        const nextText = resultText(event.partialResult);
        const previousText = toolOutput.get(event.toolCallId) || '';
        const delta = nextText.startsWith(previousText) ? nextText.slice(previousText.length) : nextText;
        toolOutput.set(event.toolCallId, nextText);
        if (delta) {
          emitEvent?.({
            type: 'tool',
            phase: 'update',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            label: formatToolLabel(event),
            delta,
            runStatus: 'running',
          });
        }
        return;
      }

      if (event.type === 'tool_execution_end') {
        emitEvent?.({
          type: 'tool',
          phase: 'end',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          label: formatToolLabel(event),
          output: resultText(event.result).trim(),
          isError: Boolean(event.isError),
          runStatus: 'running',
        });
      }
    });

    await emitStatus('running');
    await piSession.prompt(session.taskPrompt);
    await emitStatus('completed', { done: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitOutput(`[system] Host Pi dispatch failed: ${message}\n`, 'failed');
    await emitStatus('failed', { warning: message, done: true });
  } finally {
    unsubscribe?.();
    piSession?.dispose?.();
  }
}

export function summarizeHostDispatchSession(session) {
  return splitLines([
    `[system] Starting host Pi dispatch for ${session.name}.`,
    '[system] Provisioning the sandbox in parallel; remote tools wait until it is ready.',
  ].join('\n')).join('\n');
}
