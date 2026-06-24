#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

function parseArgs(argv) {
  const options = {
    runs: 1,
    url: process.env.MICRO_CLOUD_URL || 'http://127.0.0.1:8787',
    prompt: 'Reply with exactly: bootup measurement ok',
    timeoutMs: 180_000,
    prepTimeoutMs: null,
    targetMs: 1000,
    gapMs: 0,
    requirePass: false,
    intentPrep: false,
    clientId: '',
    requireEmptySessions: false,
    requireColdPath: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--runs') {
      options.runs = Number(next);
      index += 1;
    } else if (arg === '--url') {
      options.url = next;
      index += 1;
    } else if (arg === '--prompt') {
      options.prompt = next;
      index += 1;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(next);
      index += 1;
    } else if (arg === '--prep-timeout-ms') {
      options.prepTimeoutMs = Number(next);
      index += 1;
    } else if (arg === '--target-ms') {
      options.targetMs = Number(next);
      index += 1;
    } else if (arg === '--gap-ms') {
      options.gapMs = Number(next);
      index += 1;
    } else if (arg === '--client-id') {
      options.clientId = next;
      index += 1;
    } else if (arg === '--intent-prep') {
      options.intentPrep = true;
    } else if (arg === '--require-empty-sessions') {
      options.requireEmptySessions = true;
    } else if (arg === '--require-cold-path') {
      options.requireColdPath = true;
    } else if (arg === '--require-pass') {
      options.requirePass = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new Error('--runs must be a positive integer.');
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number.');
  }

  if (options.prepTimeoutMs !== null && (!Number.isFinite(options.prepTimeoutMs) || options.prepTimeoutMs <= 0)) {
    throw new Error('--prep-timeout-ms must be a positive number.');
  }

  if (options.requireColdPath && options.intentPrep) {
    throw new Error('--require-cold-path cannot be combined with --intent-prep.');
  }

  return {
    ...options,
    prepTimeoutMs: options.prepTimeoutMs || options.timeoutMs,
    url: options.url.replace(/\/+$/, ''),
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const payload = text.trim() ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return payload;
}

function buildRunIdentity(options, index) {
  const suffix = `${Date.now()}-${index}-${randomBytes(3).toString('hex')}`;
  return {
    name: `bootup-measure-${suffix}`,
    clientId: options.clientId || `bootup-measure-client-${suffix}`,
  };
}

async function assertEmptySessions(options) {
  const payload = await fetchJson(`${options.url}/api/sessions`);
  const storedSessions = (payload.sessions || []).filter((session) => session.source !== 'provider');

  if (storedSessions.length > 0) {
    throw new Error(`Expected an empty stored session file, found ${storedSessions.length} stored session(s).`);
  }
}

function readSessionStatus(payload) {
  const session = payload.session || {};
  const runStatus = session.runStatus || payload.runStatus || session.status || 'unknown';
  const status = session.status || runStatus;
  return { session, status, runStatus };
}

async function prepareIntentBridge(options, clientId, index) {
  const prepStartedAtMs = Date.now();
  const firstPayload = await fetchJson(`${options.url}/api/bridge-intents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId, reason: 'measure-bootup' }),
  });
  const firstSession = firstPayload.session || {};
  const sessionName = firstSession.name;

  if (!sessionName) {
    throw new Error('POST /api/bridge-intents did not return a session name.');
  }

  const createdAtMs = Date.parse(firstSession.createdAt || '');
  const wasCreatedForThisRun = !Number.isFinite(createdAtMs) || createdAtMs >= prepStartedAtMs - 1000;

  while (Date.now() - prepStartedAtMs < options.prepTimeoutMs) {
    const output = await fetchJson(`${options.url}/api/sessions/${encodeURIComponent(sessionName)}/output`);
    const { session, status, runStatus } = readSessionStatus(output);

    if (status === 'ready' || runStatus === 'ready') {
      const prepReadyAtMs = Date.now();
      const prepLatencyMs = prepReadyAtMs - prepStartedAtMs;
      console.log(`run ${index + 1}: intent bridge ready in ${prepLatencyMs}ms (${sessionName})`);
      return {
        clientId,
        name: sessionName,
        status,
        runStatus,
        createdAt: session.createdAt || firstSession.createdAt || null,
        readyAt: session.updatedAt || null,
        prepLatencyMs,
        wasCreatedForThisRun,
      };
    }

    if (status === 'failed' || runStatus === 'failed') {
      throw new Error(`Intent bridge ${sessionName} failed before submit: ${output.warning || session.warning || 'unknown error'}`);
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for intent bridge ${sessionName} to become ready.`);
}

async function measureOne(options, index) {
  const identity = buildRunIdentity(options, index);
  const intent = options.intentPrep ? await prepareIntentBridge(options, identity.clientId, index) : null;
  const submittedAtMs = Date.now();
  const startedAt = submittedAtMs;
  const body = {
    prompt: options.prompt,
    submittedAtMs,
    ...(intent ? { clientId: identity.clientId } : { name: identity.name }),
    ...(!intent && options.clientId ? { clientId: identity.clientId } : {}),
  };

  const posted = await fetchJson(`${options.url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const sessionName = posted.session?.name || identity.name;

  while (Date.now() - startedAt < options.timeoutMs) {
    const payload = await fetchJson(`${options.url}/api/sessions/${encodeURIComponent(sessionName)}/output`);
    const latencyMs = payload.session?.firstLlmLatencyMs;
    const runStatus = payload.session?.runStatus || payload.runStatus;

    if (typeof latencyMs === 'number') {
      const session = payload.session || {};
      const coldPath = Boolean(session.hostDispatchMode && !session.intentBridge && !session.warmBridge && !session.warmClaimed);
      console.log(`run ${index + 1}: first_llm_call_start ${latencyMs}ms (${sessionName})`);
      return {
        name: sessionName,
        clientId: intent ? identity.clientId : body.clientId || null,
        latencyMs,
        bridgeLatencyMs: null,
        runStatus,
        passed: latencyMs < options.targetMs && (!options.requireColdPath || coldPath),
        coldPath,
        hostDispatchMode: Boolean(session.hostDispatchMode),
        bridgeMode: Boolean(session.bridgeMode),
        warmBridge: Boolean(session.warmBridge),
        warmClaimed: Boolean(session.warmClaimed),
        intentBridge: Boolean(session.intentBridge),
        remoteProvisionStatus: session.remoteProvisionStatus || null,
        intentPrep: intent
          ? {
              ...intent,
              usedForSubmit: intent.name === sessionName,
            }
          : null,
      };
    }

    if (runStatus === 'failed') {
      throw new Error(`Run ${sessionName} failed before first_llm_call_start: ${payload.warning || payload.session?.warning || 'unknown error'}`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for first_llm_call_start for ${sessionName}.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = [];

  if (options.requireEmptySessions) {
    await assertEmptySessions(options);
  }

  for (let index = 0; index < options.runs; index += 1) {
    results.push(await measureOne(options, index));
    if (index < options.runs - 1 && options.gapMs > 0) {
      await sleep(options.gapMs);
    }
  }

  const pass = results.length === options.runs && results.every((result) => result.passed);
  const summary = {
    mode: options.intentPrep ? 'intent-prep' : 'direct-chat',
    targetMs: options.targetMs,
    runs: options.runs,
    requireColdPath: options.requireColdPath,
    pass,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (options.requirePass && !pass) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
