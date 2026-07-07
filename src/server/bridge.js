import { randomBytes, randomUUID } from 'node:crypto';

import { createDraftPullRequestForThread } from '../git-delivery.js';
import { buildThreadResumeEntries } from '../host-pi-runner.js';
import { buildPiProfileSyncPayload } from '../pi-profile.js';
import { readSavedSettings } from '../settings.js';
import { normalizeChatRequest } from '../session.js';
import { getStoredSession, listStoredSessions, removeStoredSession, upsertSession } from '../store.js';
import {
  buildWorkspaceIdentity,
  buildWorkspaceSession,
  buildWorktreeScript,
  findWorkspaceSession,
  saveWorkspaceIndex,
  workspacePaths,
  workspaceRemotePatch,
} from '../workspaces.js';
import { normalizeBridgeClientId, normalizeSubmittedAtMs, sleep, trimTrailingSlash } from './utils.js';

const MAX_BRIDGE_LAUNCH_LOG_ENTRIES = 40;

export function createBridgeService({ config, provider, auth, runState }) {
  const readPiAuthForSession = auth.readPiAuthForSession || auth.readLocalPiAuth || (async () => null);
  const readGitHubAuthForSession = auth.readGitHubAuthForSession || (async () => null);
  const { readLocalPiSettings } = auth;
  const {
    activeRuns,
    ensureRunState,
    setRunState,
    resetRunState,
    appendRunOutput,
    appendRunStatus,
    activeRunResetPatch,
    performancePatchForSession,
    persistRunStatus,
    persistThreadAssistantMessage,
    recordRunEvent,
    mergeTrackedChanges,
  } = runState;
  const warmLaunches = new Set();

  function safeLaunchLogDetails(details = {}) {
    const redactedKeys = new Set(['authorization', 'authText', 'bridgeToken', 'github', 'previewToken', 'repoAuthHeader', 'settingsText', 'token']);
    const safe = {};
    for (const [key, value] of Object.entries(details || {})) {
      if (redactedKeys.has(key)) continue;
      if (value == null || typeof value === 'boolean' || typeof value === 'number') {
        safe[key] = value;
      } else {
        safe[key] = String(value).slice(0, 240);
      }
    }
    return safe;
  }

  async function recordBridgeLaunchLog(sessionOrName, phase, details = {}) {
    const name = typeof sessionOrName === 'string' ? sessionOrName : sessionOrName?.name;
    const entry = { at: new Date().toISOString(), phase, ...safeLaunchLogDetails(details) };
    console.info('[workbench][bridge]', JSON.stringify({ session: name || '', ...entry }));
    if (!name || !config.sessionFile) return entry;

    try {
      const current = await getStoredSession(config.sessionFile, name);
      if (!current) return entry;
      const bridgeLaunchLog = [...(Array.isArray(current.bridgeLaunchLog) ? current.bridgeLaunchLog : []), entry].slice(-MAX_BRIDGE_LAUNCH_LOG_ENTRIES);
      await upsertSession(config.sessionFile, {
        name,
        bridgeLaunchLog,
        bridgeLaunchStage: phase,
        bridgeLaunchUpdatedAt: entry.at,
        updatedAt: entry.at,
      });
    } catch (error) {
      console.warn(`[workbench][bridge] failed to persist launch log for ${name}: ${error.message}`);
    }
    return entry;
  }

  function bridgeLaunchSettings(session, imageSettings = {}) {
    return {
      ...imageSettings,
      onLaunchLog: (phase, details) => recordBridgeLaunchLog(session, phase, details),
    };
  }

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

  async function consumeSse(response, onEvent, onActivity) {
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of response.body) {
      onActivity?.();
      buffer += decoder.decode(chunk, { stream: true });

      while (true) {
        const boundary = buffer.search(/\r?\n\r?\n/);
        if (boundary === -1) break;

        const rawEvent = buffer.slice(0, boundary);
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || '\n\n';
        buffer = buffer.slice(boundary + separator.length);
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
      console.warn(`[workbench] failed to list sessions for idle bridge pruning: ${error.message}`);
      return;
    }

    for (const session of sessions.filter(isExpiredIdleBridge)) {
      try {
        await provider.destroySession(session.name);
        await removeStoredSession(config.sessionFile, session.name);
        activeRuns.delete(session.name);
      } catch (error) {
        console.warn(`[workbench] failed to destroy expired idle sandbox ${session.name}: ${error.message}`);
      }
    }
  }

  function isUserOwnedBridge(session, user = null) {
    return !session?.ownerUserId || (user?.id && session.ownerUserId === user.id);
  }

  function isClientOwnedBridge(session, clientId, user = null) {
    return Boolean(clientId && session?.bridgeOwnerId === clientId && isUserOwnedBridge(session, user));
  }

  function isLaunchingIntentBridge(session, clientId, user = null) {
    return Boolean(
      session?.intentBridge &&
        isClientOwnedBridge(session, clientId, user) &&
        !session.bridgeClaimed &&
        session.status === 'launching' &&
        session.runStatus !== 'failed',
    );
  }

  function isReusableIntentBridge(session, clientId, user = null) {
    return isIdleReusableBridge(session) && isClientOwnedBridge(session, clientId, user);
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

  function pullRequestPatch(result, existing = {}) {
    return {
      prStatus: result.noChanges && !existing.prUrl ? 'no-changes' : 'created',
      prUrl: result.pullRequest?.url || existing.prUrl || '',
      prNumber: result.pullRequest?.number || existing.prNumber || null,
      prBranch: result.branch || existing.prBranch || '',
      prCommit: result.commit || existing.prCommit || '',
      prFiles: result.files || existing.prFiles || [],
      prUpdatedAt: new Date().toISOString(),
      prError: '',
    };
  }

  async function maybeCreateCompletedPullRequest(sessionName) {
    const session = await getStoredSession(config.sessionFile, sessionName);
    if (session?.deliveryMode !== 'draft-pr' || session.prStatus === 'creating') return;

    appendRunOutput(sessionName, '[system] Creating draft pull request from tracked changes.\n', 'completed');
    await upsertSession(config.sessionFile, {
      ...session,
      prStatus: 'creating',
      prError: '',
      updatedAt: new Date().toISOString(),
    });

    try {
      const token = await auth.githubTokenForUser?.(session.ownerUserId ? { id: session.ownerUserId } : null)
        || auth.readBrowserSession?.(session.githubOwnerSessionId)?.githubToken
        || '';
      const run = ensureRunState(sessionName);
      const changes = mergeTrackedChanges(session.trackedChanges, run.trackedChanges || []);
      const result = await createDraftPullRequestForThread({ session, provider, token, changes });
      const updated = await upsertSession(config.sessionFile, {
        ...((await getStoredSession(config.sessionFile, sessionName)) || session),
        ...pullRequestPatch(result, session),
        updatedAt: new Date().toISOString(),
      });
      appendRunOutput(
        sessionName,
        result.noChanges
          ? '[system] No tracked Git changes to put in a pull request.\n'
          : `[system] Draft pull request created: ${updated.prUrl}\n`,
        'completed',
      );
    } catch (error) {
      await upsertSession(config.sessionFile, {
        ...((await getStoredSession(config.sessionFile, sessionName)) || session),
        prStatus: 'failed',
        prError: error.message,
        prUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      appendRunOutput(sessionName, `[system] Draft pull request failed: ${error.message}\n`, 'completed');
    }
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

        const stallController = new AbortController();
        let stallTimer = null;
        const stallMs = Number(config.bridgeStreamStallMs) > 0 ? Number(config.bridgeStreamStallMs) : 60_000;
        const resetStallTimer = () => {
          clearTimeout(stallTimer);
          stallTimer = setTimeout(() => stallController.abort(), stallMs);
        };

        try {
          resetStallTimer();
          const response = await fetch(
            `${getBridgeBaseUrl(session)}/runs/${encodeURIComponent(session.bridgeRunId)}/stream?after=${after}`,
            {
              headers: bridgeHeaders(session, { accept: 'text/event-stream' }),
              signal: stallController.signal,
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

            if (event.type === 'tool' || event.type === 'thinking' || event.type === 'usage' || event.type === 'queue' || event.type === 'workflow_status' || event.type === 'workflow_result') {
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
                const terminalSession = current || session;
                await syncBridgeAuthBack(terminalSession).catch((error) => recordBridgeLaunchLog(terminalSession || sessionName, 'auth_back_sync:failed', { error: error.message }));
                await persistThreadAssistantMessage(sessionName);
                if (runStatus === 'completed') {
                  await maybeCreateCompletedPullRequest(sessionName);
                  scheduleBridgeRelease(sessionName);
                }
                done = true;
              }
            }
          }, resetStallTimer);

          if (!done) {
            await sleep(500);
          }
        } catch (error) {
          if (!stallController.signal.aborted) {
            setRunState(sessionName, { warning: error.message });
          }
          if (!done) {
            await sleep(1000);
          }
        } finally {
          clearTimeout(stallTimer);
        }
      }
    } finally {
      run.bridgeFollowing = false;
    }
  }

  async function pushBridgeAuth(session, authText) {
    const settingsText = await readLocalPiSettings();
    const piProfile = await buildPiProfileSyncPayload(config, session?.ownerUserId ? { id: session.ownerUserId } : null);
    const github = await readGitHubAuthForSession(session).catch(() => null);
    if (!authText && !settingsText && !piProfile?.files?.length && !github?.token) return false;

    await fetchBridgeJson(session, '/auth', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        authText: authText || '',
        settingsText: settingsText || '',
        piProfile,
        github: github?.token ? github : null,
      }),
    });

    return true;
  }

  async function syncBridgeAuth(session) {
    return pushBridgeAuth(session, await readPiAuthForSession(session));
  }

  async function syncBridgeAuthBack(session) {
    if (!session?.ownerUserId || typeof auth.syncPiAuthForSession !== 'function') return false;
    const payload = await fetchBridgeJson(session, '/auth');
    const updated = await auth.syncPiAuthForSession(session, payload?.authText || '');
    if (updated) await recordBridgeLaunchLog(session, 'auth_back_sync:done', { providers: updated });
    return Boolean(updated);
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
        cwd: session.remoteWorkspaceDir || config.remoteWorkspaceDir,
        r: buildThreadResumeEntries(session, session.remoteWorkspaceDir || config.remoteWorkspaceDir),
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

  function makeIntentBridgeSession(clientId, user = null) {
    return makeBridgeSession('intent', {
      intentBridge: true,
      bridgeOwnerId: clientId,
      ...(user?.id ? { ownerUserId: user.id } : {}),
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
    await recordBridgeLaunchLog(name, 'launch:failed', { error: message });
  }

  async function startClaimedBridgeRun(name, current, readyMessage) {
    if (!current.bridgeClaimed || !current.taskPrompt) return false;
    appendRunOutput(name, readyMessage, 'launching');
    await recordBridgeLaunchLog(current, 'auth_sync:start', { hasBridgeUrl: Boolean(current.bridgeUrl) });
    await syncBridgeAuth(current);
    await recordBridgeLaunchLog(current, 'auth_sync:done');
    await recordBridgeLaunchLog(current, 'run:start', { runId: current.bridgeRunId || '' });
    await startBridgeRun(current);
    await recordBridgeLaunchLog(current, 'run:sent', { runId: current.bridgeRunId || '' });
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
        await recordBridgeLaunchLog(session, 'warm_launch:worker_start');
        const piAuthText = await readPiAuthForSession(session);
        const remote = await provider.createSession(session, bridgeLaunchSettings(session, imageSettings));
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
        if (await pushBridgeAuth(updated, piAuthText)) {
          appendRunOutput(session.name, '[system] Loaded Pi auth/profile into the warm bridge.\n', 'launching');
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

  async function startIntentBridgeLaunch(clientId, imageSettings, user = null) {
    const session = makeIntentBridgeSession(clientId, user);
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
        await recordBridgeLaunchLog(session, 'intent_launch:worker_start');
        const piAuthText = await readPiAuthForSession(session);
        const remote = await provider.createSession(session, bridgeLaunchSettings(session, imageSettings));
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
        if (await pushBridgeAuth(updated, piAuthText)) {
          appendRunOutput(session.name, '[system] Loaded Pi auth/profile into the on-demand bridge.\n', 'launching');
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
    const ready = sessions.filter((session) => session.warmBridge && !session.ownerUserId && !session.bridgeClaimed && session.status === 'ready').length;
    const needed = Math.max(0, config.warmBridgePoolSize - ready - warmLaunches.size);

    for (let index = 0; index < needed; index += 1) {
      await startWarmBridgeLaunch(imageSettings);
    }
  }

  async function claimReadyBridgeSession(reusable, normalized, submittedAtMs, user = null) {
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
      ...(user?.id ? { ownerUserId: user.id } : {}),
      firstLlmLatencyMs: null,
      status: 'launching',
      runStatus: 'launching',
      updatedAt: new Date(submittedAtMs).toISOString(),
    });

    resetRunState(claimed.name, 'launching');
    appendRunOutput(claimed.name, '[system] Using a prepared idle bridge sandbox.\n', 'launching');
    await syncBridgeAuth(claimed);
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

  async function claimLaunchingIntentBridgeSession(reusable, normalized, submittedAtMs, user = null) {
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
      ...(user?.id ? { ownerUserId: user.id } : {}),
      firstLlmLatencyMs: null,
      status: 'launching',
      runStatus: 'launching',
      updatedAt: new Date(submittedAtMs).toISOString(),
    });

    ensureRunState(claimed.name);
    appendRunOutput(claimed.name, '[system] Attached the prompt to the preparing bridge.\n', 'launching');
    return claimed;
  }

  async function claimReusableBridgeSession(body, user = null) {
    const normalized = normalizeChatRequest(body, config);
    const sessions = (await listStoredSessions(config.sessionFile)).filter((session) => isUserOwnedBridge(session, user));
    const submittedAtMs = normalizeSubmittedAtMs(body.submittedAtMs);
    const ownedReady = normalized.clientId
      ? sessions.find((session) => isReusableIntentBridge(session, normalized.clientId, user))
      : null;

    if (ownedReady) {
      return claimReadyBridgeSession(ownedReady, normalized, submittedAtMs, user);
    }

    const launching = normalized.clientId
      ? sessions.find((session) => isLaunchingIntentBridge(session, normalized.clientId, user))
      : null;

    if (launching) {
      return claimLaunchingIntentBridgeSession(launching, normalized, submittedAtMs, user);
    }

    const unownedReady = sessions.find((session) => isIdleReusableBridge(session) && !session.bridgeOwnerId && !session.ownerUserId);
    const reusable = unownedReady || sessions.find((session) => isIdleReusableBridge(session) && isUserOwnedBridge(session, user));

    if (reusable) {
      return claimReadyBridgeSession(reusable, normalized, submittedAtMs, user);
    }

    void ensureWarmBridgePool();
    return null;
  }

  async function prepareIntentBridgeSession(body = {}, user = null) {
    const clientId = normalizeBridgeClientId(body.clientId);
    const sessions = await listStoredSessions(config.sessionFile);
    const existing = sessions.find((session) => {
      if (!session?.intentBridge || !isClientOwnedBridge(session, clientId, user) || session.runStatus === 'failed') return false;
      if (isReusableIntentBridge(session, clientId, user) || isLaunchingIntentBridge(session, clientId, user)) return true;
      return session.bridgeClaimed && (session.status === 'launching' || session.status === 'running');
    });

    if (existing) {
      return { clientId, session: existing };
    }

    const imageSettings = await readSavedSettings(config.settingsFile);
    const session = await startIntentBridgeLaunch(clientId, imageSettings, user);
    return { clientId, session };
  }

  async function ensureWorkspaceBridge(threadSession, imageSettings, identity, repoAuthHeader = '') {
    const now = new Date().toISOString();
    const existing = await findWorkspaceSession(config, identity);
    const base = existing || buildWorkspaceSession(threadSession, config, identity);
    const workspace = await upsertSession(config.sessionFile, {
      ...base,
      bridgeToken: base.bridgeToken || randomBytes(24).toString('hex'),
      bridgeRunId: base.bridgeRunId || randomUUID(),
      provider: provider.kind,
      imageRef: imageSettings.imageRef || config.image || base.imageRef || '',
      status: 'launching',
      runStatus: 'launching',
      createdAt: base.createdAt || now,
      updatedAt: now,
      lastUsedAt: now,
    });

    await saveWorkspaceIndex(identity, workspace);
    const launchSession = repoAuthHeader ? { ...workspace, repoAuthHeader } : workspace;
    await recordBridgeLaunchLog(workspace, 'workspace_launch:create_session');
    const remote = await provider.createSession(launchSession, bridgeLaunchSettings(workspace, imageSettings));
    const bridgeUrl = trimTrailingSlash(remote.bridgeUrl || remote.httpsUrl || workspace.bridgeUrl || '');
    const updated = await upsertSession(config.sessionFile, {
      ...workspace,
      ...remote,
      bridgeUrl,
      workspaceBridge: true,
      workspaceKey: identity.workspaceKey,
      ownerUserId: identity.ownerUserId,
      repoAuthHeader: '',
      status: 'launching',
      runStatus: 'launching',
      updatedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    });

    await waitForBridge(updated);
    await syncBridgeAuth(updated);
    const ready = await upsertSession(config.sessionFile, {
      ...updated,
      status: 'ready',
      runStatus: 'ready',
      updatedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    });
    await saveWorkspaceIndex(identity, ready);
    return ready;
  }

  async function startWorkspaceThreadBridgeLaunch(session, imageSettings) {
    if (!provider.runRemoteScript) throw new Error('Workspace mode requires remote script execution support.');
    const identity = buildWorkspaceIdentity(session);
    const repoAuthHeader = session.repoAuthHeader || '';
    const paths = workspacePaths(config, session.name);
    const now = new Date().toISOString();
    const stored = await upsertSession(config.sessionFile, {
      ...session,
      repoAuthHeader: '',
      provider: provider.kind,
      imageRef: imageSettings.imageRef || config.image || '',
      workspaceKey: identity.workspaceKey,
      workspaceSessionName: '',
      remoteWorkspaceRoot: paths.root,
      remoteWorkspaceMainDir: paths.main,
      remoteWorkspaceDir: paths.task,
      status: 'launching',
      runStatus: 'launching',
      createdAt: now,
      updatedAt: now,
    });

    resetRunState(stored.name, 'launching');
    appendRunOutput(stored.name, `[system] Preparing durable workspace for ${stored.repoUrl}.\n`, 'launching');

    void (async () => {
      try {
        const workspace = await ensureWorkspaceBridge(stored, imageSettings, identity, repoAuthHeader);
        appendRunOutput(stored.name, `[system] Workspace ready: ${workspace.name}.\n`, 'launching');
        await provider.runRemoteScript(
          workspace,
          buildWorktreeScript({ ...stored, repoAuthHeader }, config),
          { timeoutMs: 5 * 60 * 1000 },
        );
        appendRunOutput(stored.name, `[system] Thread worktree ready: ${paths.task}.\n`, 'launching');

        const current = (await getStoredSession(config.sessionFile, stored.name)) || stored;
        const runnable = await upsertSession(config.sessionFile, {
          ...current,
          ...workspaceRemotePatch(workspace),
          bridgeMode: true,
          bridgeClaimed: true,
          workspaceSessionName: workspace.name,
          workspaceKey: identity.workspaceKey,
          remoteWorkspaceRoot: paths.root,
          remoteWorkspaceMainDir: paths.main,
          remoteWorkspaceDir: paths.task,
          status: 'launching',
          runStatus: 'launching',
          updatedAt: new Date().toISOString(),
        });
        await startBridgeRun(runnable);
        const running = await upsertSession(config.sessionFile, {
          ...runnable,
          ...activeRunResetPatch(),
          status: 'running',
          runStatus: 'running',
          images: [],
          updatedAt: new Date().toISOString(),
        });
        setRunState(stored.name, { runStatus: 'running', warning: null });
        await persistRunStatus(running, 'running');
        await upsertSession(config.sessionFile, {
          ...workspace,
          lastUsedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        appendRunOutput(stored.name, `[system] Workspace launch failed: ${error.message}\n`, 'failed');
        await markBridgeLaunchFailed(stored.name, error.message);
      }
    })();

    return stored;
  }

  async function startThreadBridgeLaunch(session, imageSettings) {
    if (config.workspaceMode) return startWorkspaceThreadBridgeLaunch(session, imageSettings);

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
    await recordBridgeLaunchLog(stored, 'thread_launch:queued', {
      bridgeClaimed: Boolean(stored.bridgeClaimed),
      hasImage: Boolean(imageSettings.imageRef || config.image),
      repoMode: stored.repoMode || '',
    });

    void (async () => {
      try {
        if (imageSettings.imageRef) {
          appendRunOutput(stored.name, `[system] Using image ${imageSettings.imageRef}.\n`, 'launching');
        } else if (config.image) {
          appendRunOutput(stored.name, `[system] Using image ${config.image}.\n`, 'launching');
        } else {
          appendRunOutput(stored.name, '[system] Using the default image.\n', 'launching');
        }
        await recordBridgeLaunchLog(prepared, 'thread_launch:worker_start', { hasRepoAuth: Boolean(repoAuthHeader) });

        const piAuthText = await readPiAuthForSession(prepared);
        const launchSession = repoAuthHeader ? { ...prepared, repoAuthHeader } : prepared;
        const remote = await provider.createSession(launchSession, bridgeLaunchSettings(prepared, imageSettings));
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
        if (await pushBridgeAuth(updated, piAuthText)) {
          appendRunOutput(prepared.name, '[system] Loaded Pi auth/profile into the main agent bridge.\n', 'launching');
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
    if (!provider.shouldRefreshSession?.(refreshReference)) {
      await syncBridgeAuth(session);
      return session;
    }

    appendRunOutput(session.name, '[system] Waking the idle main agent sandbox...\n', 'launching');
    const imageSettings = await readSavedSettings(config.settingsFile);
    await recordBridgeLaunchLog(session, 'refresh:create_session');
    const remote = await provider.createSession(session, bridgeLaunchSettings(session, imageSettings));
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
    await syncBridgeAuth(updated);
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
    syncBridgeAuth,
    syncBridgeAuthBack,
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
