import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createPiResourceOptions, resolvePiDefaultsPackageDir } from './pi-defaults-package.js';
import { resolvePiSdkPackageDir } from './pi-sdk-package.js';
import { readPiProfile } from './pi-profile.js';
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

function messageText(message) {
  return typeof message?.content === 'string' ? message.content : textFromContent(message?.content);
}

export function assistantProviderErrorMessage(message = {}) {
  if (message?.role !== 'assistant' || (message.stopReason !== 'error' && !message.errorMessage)) return '';
  const raw = String(message.errorMessage || '').trim();
  if (!raw) return 'assistant stopped with a provider error';
  try {
    const parsed = JSON.parse(raw);
    return String(parsed.detail || parsed.error?.message || parsed.message || raw);
  } catch {
    return raw;
  }
}

export function workflowRunIdFromText(text) {
  const value = String(text || '');
  return value.match(/\brun-[a-z0-9-]+\b/i)?.[0] || value.match(/\bRun ID:\s*([a-z0-9][a-z0-9-]{2,100})\b/i)?.[1] || '';
}

export function isBackgroundWorkflowToolEnd(event = {}, output = resultText(event.result).trim()) {
  return !event.isError && (
    Boolean(event.result?.details?.background) ||
    (event.toolName === 'workflow' && /Workflow started in the background/i.test(output))
  );
}

function toolCallFromMessageEvent(messageEvent = {}) {
  const content = messageEvent.toolCall || messageEvent.partial?.content?.[messageEvent.contentIndex];
  return content?.type === 'toolCall' ? content : null;
}

function toolCallPlanningEvent(messageEvent) {
  const toolCall = toolCallFromMessageEvent(messageEvent);
  const args = toolCall?.arguments && typeof toolCall.arguments === 'object' ? toolCall.arguments : null;
  const toolName = toolCall?.name || 'tool';

  return {
    type: 'tool',
    phase: messageEvent.type === 'toolcall_end' ? 'planned' : 'planning',
    toolCallId: toolCall?.id || `toolcall-${messageEvent.contentIndex ?? 'unknown'}`,
    toolName,
    label: formatToolLabel({ toolName, args }),
    args,
    delta: messageEvent.type === 'toolcall_delta' ? messageEvent.delta : '',
    runStatus: 'running',
  };
}

function formatToolLabel(event) {
  if (event.toolName === 'bash' && event.args && typeof event.args.command === 'string') {
    const firstLine = event.args.command.split(/\r?\n/)[0]?.trim() || 'bash';
    return `bash: ${firstLine.slice(0, 120)}`;
  }

  return String(event.toolName || 'tool');
}

function getPiPackageDir(config = {}) {
  return config.piSdkPackageDir || process.env.PI_SDK_PACKAGE_DIR || resolvePiSdkPackageDir();
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

const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

function splitModelRef(value) {
  const text = String(value || '').trim();
  const colon = text.lastIndexOf(':');
  const suffix = colon > 0 ? text.slice(colon + 1).toLowerCase() : '';
  return colon > 0 && THINKING_LEVELS.has(suffix)
    ? { modelRef: text.slice(0, colon), thinkingLevel: suffix }
    : { modelRef: text, thinkingLevel: '' };
}

function findModel(modelRegistry, modelRef) {
  const text = String(modelRef || '').trim();
  if (!text) return null;
  const slash = text.indexOf('/');
  if (slash > 0) return modelRegistry.find(text.slice(0, slash), text.slice(slash + 1)) || null;
  return modelRegistry.getAll().find((model) => model.id === text) || null;
}

async function resolvePiOptions(config, session = {}, piOptions = {}) {
  const sdk = await loadSdk(config);
  const parsedModel = splitModelRef(session.modelRef);
  const thinkingLevel = String(session.thinkingLevel || parsedModel.thinkingLevel || '').trim().toLowerCase();
  const options = {};

  if (thinkingLevel) options.thinkingLevel = thinkingLevel;
  if (!parsedModel.modelRef) return { sdk, options };

  const authStorage = piOptions.authStorage || sdk.AuthStorage.create();
  const modelRegistry = piOptions.modelRegistry || sdk.ModelRegistry.create(authStorage);
  const model = findModel(modelRegistry, parsedModel.modelRef);
  if (!model) throw new Error(`Pi model not found: ${parsedModel.modelRef}`);

  return { sdk, options: { ...options, authStorage, modelRegistry, model } };
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

function safeSessionFileName(value) {
  return String(value || '').replace(/[^A-Za-z0-9._-]/g, '_') || 'thread';
}

function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

function isoTimestamp(value) {
  const ms = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

function resumeThreadMessages(session = {}) {
  const messages = Array.isArray(session.threadMessages) ? [...session.threadMessages] : [];
  const prompt = String(session.taskPrompt || '').trim();
  const runId = String(session.bridgeRunId || session.submittedAtMs || '');
  const tail = messages[messages.length - 1];
  if (tail?.role === 'user' && String(tail.text || '').trim() === prompt && (!runId || !tail.runId || String(tail.runId) === runId)) {
    messages.pop();
  }
  return messages.filter((message) => (
    (message?.role === 'user' || message?.role === 'assistant') &&
    String(message.text || '').trim()
  ));
}

function resumeMessageEntry(session, message, parentId, index) {
  const text = String(message.text || '').trim();
  const timestamp = isoTimestamp(message.timestamp);
  const id = `m${index}_${hashString(`${session.name || 'thread'}:${message.role}:${message.runId || ''}:${timestamp}:${text}`)}`;
  return {
    type: 'message',
    id,
    parentId,
    timestamp,
    message: message.role === 'assistant'
      ? {
          role: 'assistant',
          content: [{ type: 'text', text }],
          api: 'spanner-resume',
          provider: 'spanner',
          model: 'thread-history',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop',
          timestamp,
        }
      : { role: 'user', content: text, timestamp },
  };
}

export function buildThreadResumeEntries(session = {}, cwd = process.cwd()) {
  const entries = [{
    type: 'session',
    version: 3,
    id: safeSessionFileName(session.name),
    timestamp: isoTimestamp(session.createdAt),
    cwd,
  }];
  let parentId = null;
  resumeThreadMessages(session).forEach((message, index) => {
    const entry = resumeMessageEntry(session, message, parentId, index);
    entries.push(entry);
    parentId = entry.id;
  });
  return entries;
}

function hasRealSessionEntries(filePath) {
  if (!existsSync(filePath)) return false;
  return readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).some((line) => !line.includes('"type":"session"') && !line.includes('"type": "session"'));
}

function restoreThreadSessionFile(config, session, cwd) {
  if (!session?.threadBridge || !session.name) return null;
  const sessionDir = config.piSessionTraceDir;
  mkdirSync(sessionDir, { recursive: true });
  const filePath = path.join(sessionDir, `${safeSessionFileName(session.name)}.jsonl`);
  if (!hasRealSessionEntries(filePath)) {
    const entries = buildThreadResumeEntries(session, cwd);
    writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  }
  return filePath;
}

function spannerRuntimeAgentDir(config, session = {}) {
  if (!config.authRequired) return undefined;
  return path.join(config.localDataDir || path.join(config.rootDir || process.cwd(), 'data'), 'pi-agents', safeSessionFileName(session.ownerUserId || 'anonymous'));
}

async function createSpannerResourceOptions(config, sdk, cwd, session = {}) {
  return createPiResourceOptions(sdk, {
    cwd,
    agentDir: spannerRuntimeAgentDir(config, session),
    packageDir: resolvePiDefaultsPackageDir(config),
    piProfile: await readPiProfile(config, session.ownerUserId ? { id: session.ownerUserId } : null),
  });
}

async function createHostPiSession(config, session, remoteReadyPromise, provider) {
  const sdk = await loadSdk(config);
  const customTools = await createRemoteToolDefinitions(config, remoteReadyPromise, provider);
  const resourceOptions = await createSpannerResourceOptions(config, sdk, config.rootDir, session);
  const { options } = await resolvePiOptions(config, session, resourceOptions);
  const sessionFile = restoreThreadSessionFile(config, session, config.rootDir);
  return sdk.createAgentSession({
    cwd: config.rootDir,
    sessionManager: sessionFile ? sdk.SessionManager.open(sessionFile, config.piSessionTraceDir, config.rootDir) : sdk.SessionManager.create(config.rootDir, config.piSessionTraceDir),
    tools: ['read', 'bash', 'edit', 'write'],
    customTools,
    ...resourceOptions,
    ...options,
  });
}

async function createLocalPiSession(config, session) {
  const sdk = await loadSdk(config);
  const resourceOptions = await createSpannerResourceOptions(config, sdk, session.repoPath, session);
  const { options } = await resolvePiOptions(config, session, resourceOptions);
  const sessionFile = restoreThreadSessionFile(config, session, session.repoPath);
  return sdk.createAgentSession({
    cwd: session.repoPath,
    sessionManager: sessionFile ? sdk.SessionManager.open(sessionFile, config.piSessionTraceDir, session.repoPath) : sdk.SessionManager.create(session.repoPath, config.piSessionTraceDir),
    ...resourceOptions,
    ...options,
  });
}

async function runCreatedPiSession({ createSession, session, emitOutput, emitMetric, emitStatus, emitEvent, failureLabel, signal, onMessageControl }) {
  const submittedAtMs = Number(session.submittedAtMs) || Date.now();
  let piSession = null;
  let unsubscribe = null;
  let clearMessageControl = null;
  let firstProviderCallPublished = false;
  let streamedAssistantText = '';
  let lastProviderError = '';
  const toolOutput = new Map();
  let backgroundWorkflowCount = 0;
  let workflowResultCount = 0;
  let workflowResultEndTarget = 0;
  let agentEndCount = 0;
  let stopped = Boolean(signal?.aborted);
  let notifyWorkflowContinuation = () => {};
  let stopWorkflowWait = () => {};
  const stopRun = () => {
    stopped = true;
    notifyWorkflowContinuation();
    stopWorkflowWait();
    void piSession?.abort?.();
  };
  signal?.addEventListener('abort', stopRun, { once: true });
  const workflowContinuationDone = () => (
    stopped ||
    backgroundWorkflowCount === 0 ||
    (workflowResultCount >= backgroundWorkflowCount && workflowResultEndTarget > 0 && agentEndCount >= workflowResultEndTarget)
  );
  const waitForWorkflowContinuation = () => {
    if (workflowContinuationDone()) return Promise.resolve(!stopped);
    const timeoutMs = Number(process.env.PI_BACKGROUND_CONTINUATION_TIMEOUT_MS || process.env.PI_BRIDGE_BACKGROUND_CONTINUATION_TIMEOUT_MS || 1_800_000);
    return new Promise((resolve) => {
      const finish = (ok) => {
        clearTimeout(timer);
        notifyWorkflowContinuation = () => {};
        stopWorkflowWait = () => {};
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1_800_000);
      stopWorkflowWait = () => finish(false);
      notifyWorkflowContinuation = () => {
        if (workflowContinuationDone()) finish(!stopped);
      };
    });
  };

  try {
    const created = await createSession();
    piSession = created.session;
    clearMessageControl = onMessageControl?.({
      sendMessage: async (text, { delivery = 'steer', images = [] } = {}) => {
        const attachments = Array.isArray(images) && images.length ? images : undefined;
        if (delivery === 'followUp') await piSession.followUp(text, attachments);
        else await piSession.steer(text, attachments);
      },
    }) || null;
    if (stopped) throw new Error('Stopped by user.');
    if (piSession.sessionFile) {
      emitOutput('[system] Pi session trace: ' + piSession.sessionFile + '\n', 'running');
    }
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
      if (event.type === 'queue_update') {
        emitEvent?.({
          type: 'queue',
          steering: [...event.steering],
          followUp: [...event.followUp],
          runStatus: 'running',
        });
        return;
      }

      if (event.type === 'message_update') {
        const messageEvent = event.assistantMessageEvent;
        if (messageEvent.type === 'text_delta') {
          streamedAssistantText += messageEvent.delta;
          emitOutput(messageEvent.delta, 'running');
          return;
        }
        if (messageEvent.type === 'thinking_delta' && messageEvent.delta) {
          emitEvent?.({
            type: 'thinking',
            delta: messageEvent.delta,
            runStatus: 'running',
          });
          return;
        }
        if (['toolcall_start', 'toolcall_delta', 'toolcall_end'].includes(messageEvent.type)) {
          emitEvent?.(toolCallPlanningEvent(messageEvent));
          return;
        }
      }

      if (event.type === 'message_end') {
        lastProviderError = assistantProviderErrorMessage(event.message) || lastProviderError;
        if (event.message?.role === 'assistant' && event.message.usage) {
          emitEvent?.({
            type: 'usage',
            usage: event.message.usage,
            runStatus: 'running',
          });
          return;
        }
        if (event.message?.role === 'custom' && event.message.display) {
          const text = messageText(event.message).trim().slice(0, 8000);
          if (event.message.customType === 'workflow-result') {
            workflowResultCount += 1;
            workflowResultEndTarget = agentEndCount + 1;
            emitEvent?.({
              type: 'workflow_result',
              customType: event.message.customType,
              text,
              workflowRunId: workflowRunIdFromText(text),
              workflowResultCount,
              backgroundWorkflowCount,
              runStatus: 'running',
            });
            notifyWorkflowContinuation();
          } else if (text) {
            emitOutput(`\n${text}\n`, 'running');
          }
        }
        return;
      }

      if (event.type === 'agent_end') {
        agentEndCount += 1;
        notifyWorkflowContinuation();
        const messages = Array.isArray(event.messages) ? event.messages : Array.isArray(event.newMessages) ? event.newMessages : [];
        const assistant = [...messages].reverse().find((message) => message?.role === 'assistant');
        const finalText = textFromContent(assistant?.content);
        if (finalText && !streamedAssistantText.trim()) {
          streamedAssistantText = finalText;
          emitOutput(finalText, 'running');
        }
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
        const output = resultText(event.result).trim();
        const backgroundWorkflow = isBackgroundWorkflowToolEnd(event, output);
        if (backgroundWorkflow) {
          backgroundWorkflowCount += 1;
          emitEvent?.({
            type: 'workflow_status',
            phase: 'started',
            message: 'workflow running in background',
            workflowRunId: workflowRunIdFromText(output),
            backgroundWorkflowCount,
            workflowResultCount,
            runStatus: 'running',
          });
        }
        emitEvent?.({
          type: 'tool',
          phase: 'end',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          label: formatToolLabel(event),
          args: event.args || null,
          output,
          details: event.result?.details || null,
          backgroundWorkflow,
          isError: Boolean(event.isError),
          runStatus: 'running',
        });
      }
    });

    await emitStatus('running');
    if (stopped) throw new Error('Stopped by user.');
    await piSession.prompt(session.taskPrompt, session.images?.length ? { images: session.images } : undefined);
    if (stopped) throw new Error('Stopped by user.');
    if (backgroundWorkflowCount > workflowResultCount) {
      emitEvent?.({
        type: 'workflow_status',
        phase: 'waiting',
        message: 'waiting for workflow result',
        backgroundWorkflowCount,
        workflowResultCount,
        runStatus: 'running',
      });
    }
    const workflowContinued = await waitForWorkflowContinuation();
    if (!workflowContinued && backgroundWorkflowCount > workflowResultCount) {
      emitEvent?.({
        type: 'workflow_status',
        phase: 'timeout',
        message: 'background workflow still running; check /workflows',
        backgroundWorkflowCount,
        workflowResultCount,
        runStatus: 'running',
      });
    }
    if (stopped) throw new Error('Stopped by user.');
    const lastAssistantText = piSession.getLastAssistantText?.();
    if (lastAssistantText && !streamedAssistantText.trim()) {
      emitOutput(lastAssistantText, 'running');
    }
    if (!streamedAssistantText.trim() && !lastAssistantText) {
      throw new Error(lastProviderError || 'Main agent completed without assistant output. Check provider auth.');
    }
    await emitStatus('completed', { done: true });
  } catch (error) {
    const message = stopped ? 'Stopped by user.' : error instanceof Error ? error.message : String(error);
    emitOutput(stopped ? `[system] ${message}\n` : `[system] ${failureLabel} failed: ${message}\n`, 'failed');
    await emitStatus('failed', { warning: message, done: true, stopped });
  } finally {
    signal?.removeEventListener('abort', stopRun);
    clearMessageControl?.();
    unsubscribe?.();
    piSession?.dispose?.();
  }
}

export async function runHostPiSession({ session, config, provider, remoteReadyPromise, emitOutput, emitMetric, emitStatus, emitEvent, signal }) {
  return runCreatedPiSession({
    session,
    emitOutput,
    emitMetric,
    emitStatus,
    emitEvent,
    signal,
    failureLabel: 'Host Pi dispatch',
    createSession: () => createHostPiSession(config, session, remoteReadyPromise, provider),
  });
}

export async function runLocalPiSession({ session, config, emitOutput, emitMetric, emitStatus, emitEvent, signal, onMessageControl }) {
  return runCreatedPiSession({
    session,
    emitOutput,
    emitMetric,
    emitStatus,
    emitEvent,
    signal,
    onMessageControl,
    failureLabel: 'Local Pi run',
    createSession: () => createLocalPiSession(config, session),
  });
}

export function summarizeHostDispatchSession(session) {
  return splitLines([
    `[system] Starting host Pi dispatch for ${session.name}.`,
    '[system] Provisioning the sandbox in parallel; remote tools wait until it is ready.',
  ].join('\n')).join('\n');
}
