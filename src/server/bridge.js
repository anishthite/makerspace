import { randomBytes, randomUUID } from 'node:crypto';

import { buildThreadResumeEntries } from '../host-pi-runner.js';
import { buildPiProfileSyncPayload } from '../pi-profile.js';
import { readSavedSettings } from '../settings.js';
import { normalizeChatRequest } from '../session.js';
import { getStoredSession, listStoredSessions, removeStoredSession, upsertSession } from '../store.js';
import { normalizeBridgeClientId, normalizeSubmittedAtMs, sleep, trimTrailingSlash } from './utils.js';

export function createBridgeService({ config, provider, auth, runState }) {
  const { readLocalPiAuth, readLocalPiSettings } = auth;
  const {
    ensureRunState,
    setRunState,
    resetRunState,
    appendRunOutput,
    appendRunStatus,
    activeRunResetPatch,
    performancePatchForSession,
    persistRunStatus,
    persistThreadAssistantMessage,
  } = runState;
  const warmLaunches = new Set();

  function getBridgeBaseUrl(session) {
    const baseUrl = trimTrailingSlash(session.bridgeUrl || session.httpsUrl || '');
    if (!baseUrl) throw new Error(`No bridge URL is available for ${session.name || 'session'}.`);
    return baseUrl;
  }

  function bridgeHeaders(session, extra = {}) {
    return {
      authorization: `Bearer ${session.bridgeToken}`,
      ...(provider.bridgeHeaders?.(session) || {}),
      ...extra,
    };
  }

  async function fetchBridgeJson(session, pathname, options = {}) {
    const response = await fetch(`${getBridgeBaseUrl(session)}${pathname}`, {
      ...options,
      headers: bridgeHeaders(session, options.headers || {}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.trim() || `Bridge request failed: ${response.status}`);
    }

    return response.json();
  }

  async function waitForBridge(session) {
    const startedAt = Date.now();
    let attempts = 0;

    while (Date.now() - startedAt < config.bridgeReadyTimeoutMs) {
      attempts += 1;

      try {
        const response = await fetch(`${getBridgeBaseUrl(session)}/healthz`, {
          headers: provider.bridgeHeaders?.(session) || {},
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          return;
        }
      } catch {}

      if (attempts % 5 === 0) {
        appendRunOutput(session.name, '[system] Waiting for the bridge to come up...\n', 'launching');
      }

      await sleep(config.bridgeReadyPollMs);
    }

    throw new Error(`Timed out waiting for the bridge at ${getBridgeBaseUrl(session)}.`);
  }

  async function consumeSse(response, onEvent) {
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });

      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary === -1) break;

        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = rawEvent
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
          .trim();

        if (!data) continue;
        await onEvent(JSON.parse(data));
      }
    }
  }

  function isIdleReusableBridge(session) {
    if (session?.threadBridge) return false;
    if (!session?.bridgeMode || session.bridgeClaimed || session.status !== 'ready' || !session.bridgeUrl || !session.bridgeToken) return false;
    const ttlMs = Number(config.idleBridgeTtlMs);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;
    const updatedAtMs = Date.parse(session.updatedAt || session.createdAt || '');
    return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= ttlMs;
  }

  function isExpiredIdleBridge(session) {
    if (session?.threadBridge) return false;
    if (!session?.bridgeMode || session.bridgeClaimed || session.status !== 'ready') return false;
    const ttlMs = Number(config.idleBridgeTtlMs);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;
    const updatedAtMs = Date.parse(session.updatedAt || session.createdAt || '');
    return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs > ttlMs;
  }

  async function pruneExpiredIdleBridges() {
    let sessions = [];
    try {
      sessions = await listStoredSessions(config.sessionFile);
    } catch (error) {
      console.warn(`[micro-cloud] failed to list sessions for idle bridge pruning: ${error.message}`);
      return;
    }

    for (const session of sessions.filter(isExpiredIdleBridge)) {
      try {
        await provider.destroySession(session.name);
        await removeStoredSession(config.sessionFile, session.name);
        activeRuns.delete(session.name);
      } catch (error) {
        console.warn(`[micro-cloud] failed to destroy expired idle sandbox ${session.name}: ${error.message}`);
      }
    }
  }

  function isClientOwnedBridge(session, clientId) {
    return Boolean(clientId && session?.bridgeOwnerId === clientId);
  }

  function isLaunchingIntentBridge(session, clientId) {
    return Boolean(
      session?.intentBridge &&
        isClientOwnedBridge(session, clientId) &&
        !session.bridgeClaimed &&
        session.status === 'launching' &&
        session.runStatus !== 'failed',
    );
  }

  function isReusableIntentBridge(session, clientId) {
    return isIdleReusableBridge(session) && isClientOwnedBridge(session, clientId);
  }

  function scheduleBridgeRelease(sessionName) {
    setTimeout(async () => {
      const session = await getStoredSession(config.sessionFile, sessionName);
      if (!session?.bridgeMode || !session.bridgeClaimed || session.runStatus !== 'completed') return;

      await upsertSession(config.sessionFile, {
        ...session,
        taskPrompt: '',
        images: [],
        bridgeClaimed: false,
        warmClaimed: false,
        status: 'ready',
        runStatus: 'ready',
        updatedAt: new Date().toISOString(),
      });
      setRunState(sessionName, { runStatus: 'ready', warning: null });
    }, 5000);
  }

  async function followBridgeRun(sessionName) {
    const run = ensureRunState(sessionName);
    if (run.bridgeFollowing) return;
    run.bridgeFollowing = true;

    let after = 0;
    let done = false;

    try {
      while (!done) {
        const session = await getStoredSession(config.sessionFile, sessionName);
        if (!session?.bridgeUrl || !session?.bridgeRunId || !session?.bridgeToken) {
          return;
        }

        try {
          const response = await fetch(
            `${getBridgeBaseUrl(session)}/runs/${encodeURIComponent(session.bridgeRunId)}/stream?after=${after}`,
            {
              headers: bridgeHeaders(session, { accept: 'text/event-stream' }),
            },
          );

          if (!response.ok || !response.body) {
            const text = await response.text();
            throw new Error(text.trim() || `Bridge stream failed: ${response.status}`);
          }

          await consumeSse(response, async (event) => {
            after = Math.max(after, Number(event.index) || after);

            if (event.type === 'metric') {
              const current = await getStoredSession(config.sessionFile, sessionName);
              const submittedAtMs = Number(current?.submittedAtMs || event.submittedAtMs);
              const hostLatencyMs = Number.isFinite(submittedAtMs) && submittedAtMs > 0 ? Date.now() - submittedAtMs : null;
              const runStatus = event.runStatus || ensureRunState(sessionName).runStatus || 'running';
              recordRunEvent(sessionName, {
                ...event,
                type: 'metric',
                runStatus,
                bridgeLatencyMs: event.latencyMs ?? null,
                latencyMs: hostLatencyMs ?? event.latencyMs ?? null,
              });
              setRunState(sessionName, { warning: event.warning || null });
              if (current && event.metric === 'first_llm_call_start') {
                await upsertSession(config.sessionFile, {
                  ...current,
                  ...performancePatchForSession(current, runStatus),
                  runStatus,
                  firstLlmLatencyMs: hostLatencyMs ?? event.latencyMs ?? null,
                  updatedAt: new Date().toISOString(),
                });
              }
              return;
            }

            if (event.type === 'tool' || event.type === 'thinking' || event.type === 'usage' || event.type === 'workflow_status' || event.type === 'workflow_result') {
              recordRunEvent(sessionName, {
                ...event,
                type: event.type,
                runStatus: event.runStatus || ensureRunState(sessionName).runStatus || 'running',
              });
              if (event.type === 'workflow_status' || event.type === 'workflow_result') {
                setRunState(sessionName, { warning: event.warning || null });
              }
              return;
            }

            if (event.chunk) {
              appendRunOutput(sessionName, String(event.chunk), event.runStatus || ensureRunState(sessionName).runStatus || 'running');
            }

            if (event.type === 'status' || event.runStatus || event.done || event.warning) {
              const runStatus = event.runStatus || ensureRunState(sessionName).runStatus || 'running';
              appendRunStatus(sessionName, runStatus, {
                warning: event.warning || null,
                exitCode: Object.prototype.hasOwnProperty.call(event, 'exitCode') ? event.exitCode : null,
                done: Boolean(event.done),
              });
              setRunState(sessionName, { warning: event.warning || null });
              const current = await getStoredSession(config.sessionFile, sessionName);
              if (current) {
                await persistRunStatus(current, runStatus);
              }
              if (event.done || runStatus === 'completed' || runStatus === 'failed') {
                await persistThreadAssistantMessage(sessionName);
                if (runStatus === 'completed') {
                  scheduleBridgeRelease(sessionName);
                }
                done = true;
              }
            }
          });

          if (!done) {
            await sleep(500);
          }
        } catch (error) {
          setRunState(sessionName, { warning: error.message });
          if (!done) {
            await sleep(1000);
          }
        }
      }
    } finally {
      run.bridgeFollowing = false;
    }
  }

  async function pushBridgeAuth(session, authText) {
    const settingsText = await readLocalPiSettings();
    const piProfile = await buildPiProfileSyncPayload(config);
    if (!authText && !settingsText && !piProfile?.files?.length) return false;

    await fetchBridgeJson(session, '/auth', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ authText: authText || '', settingsText: settingsText || '', piProfile }),
    });

    return true;
  }

  async function startBridgeRun(session) {
    await fetchBridgeJson(session, '/runs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: session.bridgeRunId,
        name: session.name,
        prompt: session.taskPrompt,
        submittedAtMs: session.submittedAtMs,
        modelRef: session.modelRef || '',
        thinkingLevel: session.thinkingLevel || '',
        images: session.images || [],
        r: buildThreadResumeEntries(session, config.remoteWorkspaceDir),
      }),
    });

    ensureRunState(session.name);
    void followBridgeRun(session.name);
  }

  function makeBridgeSession(prefix, patch = {}) {
    const timestamp = new Date().toISOString();
    const suffix = `${timestamp.replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
    return {
      name: `${prefix}-bridge-${suffix}`,
      repoUrl: '',
      repoMode: 'empty',
      branch: '',
      taskPrompt: '',
      visibility: 'public',
      sharePort: config.bridgePort,
      autoRunAgent: false,
      bridgeMode: true,
      bridgeToken: randomBytes(24).toString('hex'),
      bridgeRunId: randomUUID(),
      ...patch,
    };
  }

  function makeWarmBridgeSession() {
    return makeBridgeSession('warm', { warmBridge: true });
  }

  function makeIntentBridgeSession(clientId) {
    return makeBridgeSession('intent', {
      intentBridge: true,
      bridgeOwnerId: clientId,
      preparedAt: new Date().toISOString(),
    });
  }

  async function markBridgeLaunchFailed(name, message) {
    setRunState(name, { runStatus: 'failed', warning: message });
    appendRunStatus(name, 'failed', { warning: message, done: true });
    const existing = await getStoredSession(config.sessionFile, name);
    if (!existing) return;
    await upsertSession(config.sessionFile, {
      ...existing,
      status: 'failed',
      runStatus: 'failed',
      warning: message,
      updatedAt: new Date().toISOString(),
    });
  }

  async function startClaimedBridgeRun(name, current, readyMessage) {
    if (!current.bridgeClaimed || !current.taskPrompt) return false;
    appendRunOutput(name, readyMessage, 'launching');
    await startBridgeRun(current);
    const running = await upsertSession(config.sessionFile, {
      ...current,
      ...activeRunResetPatch(),
      status: 'running',
      runStatus: 'running',
      images: [],
      updatedAt: new Date().toISOString(),
    });
    setRunState(name, { runStatus: 'running', warning: null });
    await persistRunStatus(running, 'running');
    return true;
  }

  async function startWarmBridgeLaunch(imageSettings) {
    const session = makeWarmBridgeSession();
    warmLaunches.add(session.name);
    const now = new Date().toISOString();

    await upsertSession(config.sessionFile, {
      ...session,
      provider: provider.kind,
      imageRef: imageSettings.imageRef || config.image || '',
      status: 'launching',
      runStatus: 'launching',
      createdAt: now,
      updatedAt: now,
    });

    resetRunState(session.name, 'launching');
    appendRunOutput(session.name, '[system] Prewarming a bridge sandbox...\n', 'launching');

    void (async () => {
      try {
        const piAuthText = await readLocalPiAuth();
        const remote = await provider.createSession(session, imageSettings);
        const bridgeUrl = trimTrailingSlash(remote.bridgeUrl || remote.httpsUrl || '');
        const updated = await upsertSession(config.sessionFile, {
          ...session,
          ...remote,
          bridgeUrl,
          status: 'launching',
          runStatus: 'launching',
          updatedAt: new Date().toISOString(),
        });
        appendRunOutput(session.name, `[system] Warm sandbox ready: ${updated.name}.\n`, 'launching');
        await waitForBridge(updated);
        if (piAuthText) {
          await pushBridgeAuth(updated, piAuthText);
          appendRunOutput(session.name, '[system] Loaded local main agent auth into the warm bridge.\n', 'launching');
        }
        await upsertSession(config.sessionFile, {
          ...updated,
          warmBridge: true,
          bridgeClaimed: false,
          warmClaimed: false,
          status: 'ready',
          runStatus: 'ready',
          updatedAt: new Date().toISOString(),
        });
        setRunState(session.name, { runStatus: 'ready', warning: null });
        appendRunOutput(session.name, '[system] Warm bridge ready for the next prompt.\n', 'ready');
      } catch (error) {
        appendRunOutput(session.name, `[system] Warm bridge failed: ${error.message}\n`, 'failed');
        await markBridgeLaunchFailed(session.name, error.message);
      } finally {
        warmLaunches.delete(session.name);
      }
    })();
  }

  async function startIntentBridgeLaunch(clientId, imageSettings) {
    const session = makeIntentBridgeSession(clientId);
    const now = new Date().toISOString();
    const stored = await upsertSession(config.sessionFile, {
      ...session,
      provider: provider.kind,
      imageRef: imageSettings.imageRef || config.image || '',
      status: 'launching',
      runStatus: 'launching',
      createdAt: now,
      updatedAt: now,
    });

    resetRunState(session.name, 'launching');
    appendRunOutput(session.name, '[system] Preparing an on-demand bridge for this browser.\n', 'launching');

    void (async () => {
      try {
        const piAuthText = await readLocalPiAuth();
        const remote = await provider.createSession(session, imageSettings);
        const bridgeUrl = trimTrailingSlash(remote.bridgeUrl || remote.httpsUrl || '');
        const latest = (await getStoredSession(config.sessionFile, session.name)) || session;
        const updated = await upsertSession(config.sessionFile, {
          ...latest,
          ...remote,
          bridgeUrl,
          status: 'launching',
          runStatus: 'launching',
          updatedAt: new Date().toISOString(),
        });
        appendRunOutput(session.name, `[system] On-demand sandbox ready: ${updated.name}.\n`, 'launching');
        await waitForBridge(updated);
        if (piAuthText) {
          await pushBridgeAuth(updated, piAuthText);
          appendRunOutput(session.name, '[system] Loaded local main agent auth into the on-demand bridge.\n', 'launching');
        }

        const current = (await getStoredSession(config.sessionFile, session.name)) || updated;
        if (await startClaimedBridgeRun(session.name, current, '[system] On-demand bridge ready. Starting main agent.\n\n')) return;

        await upsertSession(config.sessionFile, {
          ...current,
          bridgeClaimed: false,
          warmClaimed: false,
          status: 'ready',
          runStatus: 'ready',
          updatedAt: new Date().toISOString(),
        });
        setRunState(session.name, { runStatus: 'ready', warning: null });
        appendRunOutput(session.name, '[system] On-demand bridge ready for the next prompt.\n', 'ready');
      } catch (error) {
        appendRunOutput(session.name, `[system] On-demand bridge failed: ${error.message}\n`, 'failed');
        await markBridgeLaunchFailed(session.name, error.message);
      }
    })();

    return stored;
  }

  async function ensureWarmBridgePool() {
    if (!config.warmBridgePoolSize || config.warmBridgePoolSize < 1) return;

    const imageSettings = await readSavedSettings(config.settingsFile);
    const sessions = await listStoredSessions(config.sessionFile);
    const ready = sessions.filter((session) => session.warmBridge && !session.bridgeClaimed && session.status === 'ready').length;
    const needed = Math.max(0, config.warmBridgePoolSize - ready - warmLaunches.size);

    for (let index = 0; index < needed; index += 1) {
      await startWarmBridgeLaunch(imageSettings);
    }
  }

  async function claimReadyBridgeSession(reusable, normalized, submittedAtMs) {
    const claimed = await upsertSession(config.sessionFile, {
      ...reusable,
      ...activeRunResetPatch(),
      taskPrompt: normalized.taskPrompt,
      submittedAtMs,
      modelRef: normalized.modelRef,
      thinkingLevel: normalized.thinkingLevel,
      images: normalized.images || [],
      bridgeRunId: randomUUID(),
      bridgeClaimed: true,
      warmClaimed: Boolean(reusable.warmBridge),
      bridgeOwnerId: reusable.bridgeOwnerId || normalized.clientId || null,
      firstLlmLatencyMs: null,
      status: 'launching',
      runStatus: 'launching',
      updatedAt: new Date(submittedAtMs).toISOString(),
    });

    resetRunState(claimed.name, 'launching');
    appendRunOutput(claimed.name, '[system] Using a prepared idle bridge sandbox.\n', 'launching');
    await startBridgeRun(claimed);
    const running = await upsertSession(config.sessionFile, {
      ...claimed,
      ...activeRunResetPatch(),
      status: 'running',
      runStatus: 'running',
      images: [],
      updatedAt: new Date().toISOString(),
    });
    setRunState(claimed.name, { runStatus: 'running', warning: null });
    void ensureWarmBridgePool();
    return running;
  }

  async function claimLaunchingIntentBridgeSession(reusable, normalized, submittedAtMs) {
    const claimed = await upsertSession(config.sessionFile, {
      ...reusable,
      ...activeRunResetPatch(),
      taskPrompt: normalized.taskPrompt,
      submittedAtMs,
      modelRef: normalized.modelRef,
      thinkingLevel: normalized.thinkingLevel,
      images: normalized.images || [],
      bridgeRunId: randomUUID(),
      bridgeClaimed: true,
      firstLlmLatencyMs: null,
      status: 'launching',
      runStatus: 'launching',
      updatedAt: new Date(submittedAtMs).toISOString(),
    });

    ensureRunState(claimed.name);
    appendRunOutput(claimed.name, '[system] Attached the prompt to the preparing bridge.\n', 'launching');
    return claimed;
  }

  async function claimReusableBridgeSession(body) {
    const normalized = normalizeChatRequest(body, config);
    const sessions = await listStoredSessions(config.sessionFile);
    const submittedAtMs = normalizeSubmittedAtMs(body.submittedAtMs);
    const ownedReady = normalized.clientId
      ? sessions.find((session) => isReusableIntentBridge(session, normalized.clientId))
      : null;

    if (ownedReady) {
      return claimReadyBridgeSession(ownedReady, normalized, submittedAtMs);
    }

    const launching = normalized.clientId
      ? sessions.find((session) => isLaunchingIntentBridge(session, normalized.clientId))
      : null;

    if (launching) {
      return claimLaunchingIntentBridgeSession(launching, normalized, submittedAtMs);
    }

    const unownedReady = sessions.find((session) => isIdleReusableBridge(session) && !session.bridgeOwnerId);
    const reusable = unownedReady || sessions.find(isIdleReusableBridge);

    if (reusable) {
      return claimReadyBridgeSession(reusable, normalized, submittedAtMs);
    }

    void ensureWarmBridgePool();
    return null;
  }

  async function prepareIntentBridgeSession(body = {}) {
    const clientId = normalizeBridgeClientId(body.clientId);
    const sessions = await listStoredSessions(config.sessionFile);
    const existing = sessions.find((session) => {
      if (!session?.intentBridge || !isClientOwnedBridge(session, clientId) || session.runStatus === 'failed') return false;
      if (isReusableIntentBridge(session, clientId) || isLaunchingIntentBridge(session, clientId)) return true;
      return session.bridgeClaimed && (session.status === 'launching' || session.status === 'running');
    });

    if (existing) {
      return { clientId, session: existing };
    }

    const imageSettings = await readSavedSettings(config.settingsFile);
    const session = await startIntentBridgeLaunch(clientId, imageSettings);
    return { clientId, session };
  }

  async function startThreadBridgeLaunch(session, imageSettings) {
    const repoAuthHeader = session.repoAuthHeader || '';
    const prepared = {
      ...session,
      bridgeToken: session.bridgeToken || randomBytes(24).toString('hex'),
      bridgeRunId: session.bridgeRunId || randomUUID(),
      bridgeClaimed: Boolean(session.taskPrompt),
    };
    const persisted = repoAuthHeader ? { ...prepared, repoAuthHeader: '' } : prepared;
    const now = new Date().toISOString();
    const stored = await upsertSession(config.sessionFile, {
      ...persisted,
      provider: provider.kind,
      imageRef: imageSettings.imageRef || config.image || '',
      status: 'launching',
      runStatus: 'launching',
      createdAt: now,
      updatedAt: now,
    });

    resetRunState(stored.name, 'launching');
    appendRunOutput(stored.name, `[system] Creating cloud main agent for ${stored.repoUrl}.\n`, 'launching');

    void (async () => {
      try {
        if (imageSettings.imageRef) {
          appendRunOutput(stored.name, `[system] Using image ${imageSettings.imageRef}.\n`, 'launching');
        } else if (config.image) {
          appendRunOutput(stored.name, `[system] Using image ${config.image}.\n`, 'launching');
        } else {
          appendRunOutput(stored.name, '[system] Using the default image.\n', 'launching');
        }

        const piAuthText = await readLocalPiAuth();
        const remote = await provider.createSession(repoAuthHeader ? { ...prepared, repoAuthHeader } : prepared, imageSettings);
        const bridgeUrl = trimTrailingSlash(remote.bridgeUrl || remote.httpsUrl || '');
        const latest = (await getStoredSession(config.sessionFile, prepared.name)) || prepared;
        const updated = await upsertSession(config.sessionFile, {
          ...latest,
          ...remote,
          bridgeUrl,
          status: 'launching',
          runStatus: 'launching',
          updatedAt: new Date().toISOString(),
        });
        appendRunOutput(prepared.name, `[system] Main agent sandbox ready: ${updated.name}.\n`, 'launching');
        await waitForBridge(updated);
        if (piAuthText) {
          await pushBridgeAuth(updated, piAuthText);
          appendRunOutput(prepared.name, '[system] Loaded local main agent auth into the main agent bridge.\n', 'launching');
        }

        const current = (await getStoredSession(config.sessionFile, prepared.name)) || updated;
        if (await startClaimedBridgeRun(prepared.name, current, '[system] Main agent bridge ready. Starting main agent.\n\n')) return;

        await upsertSession(config.sessionFile, {
          ...current,
          bridgeClaimed: false,
          warmClaimed: false,
          status: 'ready',
          runStatus: 'ready',
          updatedAt: new Date().toISOString(),
        });
        setRunState(prepared.name, { runStatus: 'ready', warning: null });
        appendRunOutput(prepared.name, '[system] Main agent bridge ready. Send a prompt.\n', 'ready');
      } catch (error) {
        appendRunOutput(prepared.name, `[system] Main agent bridge failed: ${error.message}\n`, 'failed');
        await markBridgeLaunchFailed(prepared.name, error.message);
      }
    })();

    return stored;
  }

  async function refreshBridgeSessionIfNeeded(session, refreshReference = session) {
    if (!provider.shouldRefreshSession?.(refreshReference)) return session;

    appendRunOutput(session.name, '[system] Waking the idle main agent sandbox...\n', 'launching');
    const imageSettings = await readSavedSettings(config.settingsFile);
    const piAuthText = await readLocalPiAuth();
    const remote = await provider.createSession(session, imageSettings);
    const bridgeUrl = trimTrailingSlash(remote.bridgeUrl || remote.httpsUrl || session.bridgeUrl || '');
    const updated = await upsertSession(config.sessionFile, {
      ...session,
      ...remote,
      bridgeUrl,
      status: 'launching',
      runStatus: 'launching',
      updatedAt: new Date().toISOString(),
    });

    await waitForBridge(updated);
    if (piAuthText) {
      await pushBridgeAuth(updated, piAuthText);
    }
    return updated;
  }

  return {
    getBridgeBaseUrl,
    bridgeHeaders,
    fetchBridgeJson,
    waitForBridge,
    consumeSse,
    isIdleReusableBridge,
    isExpiredIdleBridge,
    pruneExpiredIdleBridges,
    isClientOwnedBridge,
    isLaunchingIntentBridge,
    isReusableIntentBridge,
    scheduleBridgeRelease,
    followBridgeRun,
    pushBridgeAuth,
    startBridgeRun,
    makeWarmBridgeSession,
    makeIntentBridgeSession,
    startWarmBridgeLaunch,
    startIntentBridgeLaunch,
    ensureWarmBridgePool,
    claimReadyBridgeSession,
    claimLaunchingIntentBridgeSession,
    claimReusableBridgeSession,
    prepareIntentBridgeSession,
    startThreadBridgeLaunch,
    refreshBridgeSessionIfNeeded,
  };
}
