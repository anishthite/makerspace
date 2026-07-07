import { randomBytes, randomUUID } from 'node:crypto';

import { buildAndPushImage } from '../image-builder.js';
import { runHostPiSession } from '../host-pi-runner.js';
import { appendRetainedOutput } from '../resource-utils.js';
import { normalizeChatRequest, normalizeCreateRequest } from '../session.js';
import { readSavedSettings } from '../settings.js';
import { getStoredSession, upsertSession } from '../store.js';
import { trimTrailingSlash } from './utils.js';

export function createSessionService({ config, provider, auth, runState, bridge }) {
  const { readLocalPiAuth, enrichGitHubRepoSession = async (session) => session } = auth;
  const { claimReusableBridgeSession, waitForBridge, pushBridgeAuth, startBridgeRun, followBridgeRun } = bridge;
  const {
    activeRuns,
    ensureRunState,
    setRunState,
    resetRunState,
    appendRunOutput,
    appendRunStatus,
    activeRunResetPatch,
    persistRunStatus,
    persistHostDispatchMetric,
    persistHostDispatchStatus,
    recordRunEvent,
    isActiveRunStatus,
  } = runState;

  async function startSessionLaunch(session, imageSettings) {
    const submittedAtMs = Number(session.submittedAtMs) || Date.now();
    const now = new Date(submittedAtMs).toISOString();
    const preparedSession = session.bridgeMode
      ? {
          ...session,
          submittedAtMs,
          bridgeClaimed: true,
          bridgeOwnerId: session.clientId || session.bridgeOwnerId || null,
          bridgeToken: randomBytes(24).toString('hex'),
          bridgeRunId: randomUUID(),
        }
      : { ...session, submittedAtMs };

    const persistedSession = preparedSession.repoAuthHeader ? { ...preparedSession, repoAuthHeader: '' } : preparedSession;
    const stored = await upsertSession(config.sessionFile, {
      ...persistedSession,
      provider: provider.kind,
      imageRef: imageSettings.imageRef || config.image || '',
      status: 'launching',
      runStatus: 'launching',
      createdAt: now,
      updatedAt: now,
    });

    resetRunState(session.name, 'launching');

    appendRunOutput(session.name, '[system] Starting a fresh cloud sandbox...\n', 'launching');

    void (async () => {
      try {
        if (imageSettings.autoBuildImage && imageSettings.imageRef) {
          appendRunOutput(session.name, `[system] Building and pushing ${imageSettings.imageRef}...\n`, 'launching');
          await buildAndPushImage(config, imageSettings);
          appendRunOutput(session.name, '[system] Image pushed.\n', 'launching');
        } else if (imageSettings.imageRef) {
          appendRunOutput(session.name, `[system] Using image ${imageSettings.imageRef}.\n`, 'launching');
        } else {
          appendRunOutput(session.name, '[system] Using the default image.\n', 'launching');
        }

        appendRunOutput(session.name, '[system] Provisioning the cloud sandbox...\n', 'launching');
        const piAuthText = preparedSession.bridgeMode ? await readLocalPiAuth() : null;
        const remote = await provider.createSession(preparedSession, imageSettings);
        const bridgeUrl = preparedSession.bridgeMode
          ? trimTrailingSlash(remote.bridgeUrl || remote.httpsUrl || '')
          : null;
        const updated = await upsertSession(config.sessionFile, {
          ...stored,
          ...remote,
          bridgeUrl,
          status: preparedSession.bridgeMode ? 'ready' : preparedSession.autoRunAgent ? 'running' : 'ready',
          runStatus: preparedSession.bridgeMode ? 'ready' : preparedSession.autoRunAgent ? 'running' : 'ready',
          updatedAt: new Date().toISOString(),
        });

        setRunState(session.name, {
          runStatus: preparedSession.bridgeMode ? 'ready' : preparedSession.autoRunAgent ? 'running' : 'ready',
          warning: null,
        });

        appendRunOutput(session.name, `[system] Sandbox ready: ${updated.name}.\n`, preparedSession.bridgeMode ? 'ready' : 'running');

        if (updated.connectCommand) {
          appendRunOutput(session.name, `[system] Connect: ${updated.connectCommand}\n`, preparedSession.bridgeMode ? 'ready' : 'running');
        }

        if (preparedSession.bridgeMode) {
          appendRunOutput(session.name, '[system] Waiting for the bridge...\n', 'launching');
          await waitForBridge(updated);
          if (await pushBridgeAuth(updated, piAuthText)) {
            appendRunOutput(session.name, '[system] Loaded Pi auth/profile into the bridge.\n', 'launching');
          }
          appendRunOutput(session.name, '[system] Bridge ready. Starting main agent...\n\n', 'launching');
          await startBridgeRun(updated);
          const running = await upsertSession(config.sessionFile, {
            ...updated,
            status: 'running',
            runStatus: 'running',
            images: [],
            updatedAt: new Date().toISOString(),
          });
          setRunState(session.name, { runStatus: 'running', warning: null });
          await persistRunStatus(running, 'running');
          return;
        }

        if (preparedSession.autoRunAgent) {
          appendRunOutput(session.name, '[system] Main agent is running. Streaming output...\n\n', 'running');
        } else {
          appendRunOutput(session.name, '[system] Sandbox is ready. Start the main agent from the session table below.\n', 'ready');
        }
      } catch (error) {
        setRunState(session.name, {
          runStatus: 'failed',
          warning: error.message,
        });
        appendRunOutput(session.name, `[system] Launch failed: ${error.message}\n`, 'failed');
        appendRunStatus(session.name, 'failed', {
          warning: error.message,
          done: true,
        });
        const existing = await getStoredSession(config.sessionFile, session.name);

        if (existing) {
          await upsertSession(config.sessionFile, {
            ...existing,
            status: 'failed',
            runStatus: 'failed',
            updatedAt: new Date().toISOString(),
          });
        }
      }
    })();

    return stored;
  }

  async function provisionHostDispatchRemote(session, imageSettings, stored) {
    try {
      if (imageSettings.autoBuildImage && imageSettings.imageRef) {
        appendRunOutput(session.name, `[system] Building and pushing ${imageSettings.imageRef} for remote tools...\n`, 'launching');
        await buildAndPushImage(config, imageSettings);
        appendRunOutput(session.name, '[system] Image pushed for remote tools.\n', 'launching');
      } else if (imageSettings.imageRef) {
        appendRunOutput(session.name, `[system] Provisioning remote tools with image ${imageSettings.imageRef}.\n`, 'launching');
      } else {
        appendRunOutput(session.name, '[system] Provisioning remote tools with the default image.\n', 'launching');
      }

      const remote = await provider.createSession(session, imageSettings);
      const updated = await upsertSession(config.sessionFile, {
        name: session.name,
        ...remote,
        bridgeUrl: null,
        remoteProvisionStatus: 'ready',
        remoteReadyAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      appendRunOutput(session.name, `[system] Remote tool sandbox ready: ${updated.name}.\n`, ensureRunState(session.name).runStatus);
      if (updated.connectCommand) {
        appendRunOutput(session.name, `[system] Connect: ${updated.connectCommand}\n`, ensureRunState(session.name).runStatus);
      }

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRunState(session.name, { warning: message });
      appendRunOutput(session.name, `[system] Remote tool sandbox failed: ${message}\n`, ensureRunState(session.name).runStatus);
      await upsertSession(config.sessionFile, {
        name: session.name,
        remoteProvisionStatus: 'failed',
        remoteProvisionWarning: message,
        warning: message,
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async function startHostDispatchSession(session, imageSettings) {
    const submittedAtMs = Number(session.submittedAtMs) || Date.now();
    const now = new Date(submittedAtMs).toISOString();
    const preparedSession = {
      ...session,
      submittedAtMs,
      bridgeMode: false,
      bridgeClaimed: false,
      warmClaimed: false,
      autoRunAgent: false,
      sharePort: null,
      visibility: 'private',
      hostDispatchMode: true,
      firstLlmLatencyMs: null,
    };
    const stored = await upsertSession(config.sessionFile, {
      ...preparedSession,
      provider: provider.kind,
      imageRef: imageSettings.imageRef || config.image || '',
      status: 'launching',
      runStatus: 'launching',
      remoteProvisionStatus: 'launching',
      createdAt: now,
      updatedAt: now,
    });

    resetRunState(session.name, 'launching');
    appendRunOutput(session.name, '[system] Starting host main agent dispatch for the cold prompt.\n', 'launching');
    appendRunOutput(session.name, '[system] Provisioning the remote tool sandbox in parallel.\n', 'launching');

    const remoteReadyPromise = provisionHostDispatchRemote(preparedSession, imageSettings, stored);
    remoteReadyPromise.catch(() => {});

    void runHostPiSession({
      session: stored,
      config,
      provider,
      remoteReadyPromise,
      emitOutput: (text, runStatus) => appendRunOutput(session.name, text, runStatus),
      emitMetric: (event) => persistHostDispatchMetric(session.name, event),
      emitStatus: (runStatus, extra) => persistHostDispatchStatus(session.name, runStatus, extra),
      emitEvent: (event) => recordRunEvent(session.name, event),
    });

    return stored;
  }

  function shouldFollowBridgeRun(session) {
    return Boolean(
      session?.bridgeMode &&
        session.bridgeClaimed &&
        session.bridgeUrl &&
        session.bridgeRunId &&
        session.bridgeToken &&
        isActiveRunStatus(session.runStatus || session.status),
    );
  }

  function inactiveRunSnapshot(session) {
    const runStatus = String(session?.runStatus || session?.status || 'unknown').toLowerCase();
    const message = session?.bridgeMode && isActiveRunStatus(runStatus) && !session.bridgeUrl
      ? 'waiting for remote bridge'
      : '';
    return {
      output: '',
      outputBaseOffset: 0,
      remoteLogOffset: 0,
      runStatus,
      warning: session?.warning || null,
      events: [{
        id: 0,
        timestamp: session?.updatedAt || session?.createdAt || new Date().toISOString(),
        type: 'status',
        runStatus,
        ...(message ? { message } : {}),
        ...(session?.warning ? { warning: session.warning } : {}),
        session,
      }],
      nextEventId: 1,
    };
  }

  async function syncRunOutput(session) {
    let run = activeRuns.get(session.name);

    if (shouldFollowBridgeRun(session)) {
      run = ensureRunState(session.name);
      void followBridgeRun(session.name);
      return run;
    }

    if (session.bridgeMode || session.hostDispatchMode || !provider.readOutput) {
      return run || inactiveRunSnapshot(session);
    }

    run = ensureRunState(session.name);

    try {
      const remote = await provider.readOutput(session, {
        offset: run.remoteLogOffset,
      });

      if (remote.chunk) {
        appendRetainedOutput(run, remote.chunk);
      }

      if (typeof remote.nextOffset === 'number') {
        run.remoteLogOffset = remote.nextOffset;
      }

      if (remote.runStatus) {
        const previousStatus = run.runStatus;
        run.runStatus = remote.runStatus;

        if (previousStatus !== remote.runStatus) {
          await persistRunStatus(session, remote.runStatus);
        }
      }

      run.warning = remote.warning || null;
    } catch (error) {
      run.warning = error.message;
    }

    return run;
  }

  async function createChatSession(body, user = null) {
    if (!config.hostDispatchEnabled) {
      const warmSession = await claimReusableBridgeSession(body, user);
      if (warmSession) return warmSession;
    }

    const session = {
      ...normalizeChatRequest(body, config),
      ...(user?.id ? { ownerUserId: user.id } : {}),
      submittedAtMs: normalizeSubmittedAtMs(body.submittedAtMs),
    };
    const existing = await getStoredSession(config.sessionFile, session.name);

    if (existing) {
      throw new Error(`A session named ${session.name} already exists in data/sessions.json.`);
    }

    const imageSettings = await readSavedSettings(config.settingsFile);
    return config.hostDispatchEnabled
      ? startHostDispatchSession(session, imageSettings)
      : startSessionLaunch(session, imageSettings);
  }

  async function createManualSession(body, browserSession = null, browserSessionIdValue = '', user = null) {
    const session = await enrichGitHubRepoSession({
      ...normalizeCreateRequest(body, config),
      ...(user?.id ? { ownerUserId: user.id } : browserSessionIdValue ? { githubOwnerSessionId: browserSessionIdValue } : {}),
    }, browserSession, user);
    const existing = await getStoredSession(config.sessionFile, session.name);

    if (existing) {
      throw new Error(`A session named ${session.name} already exists in data/sessions.json.`);
    }

    const imageSettings = await readSavedSettings(config.settingsFile);
    return startSessionLaunch(session, imageSettings);
  }

  return {
    startSessionLaunch,
    provisionHostDispatchRemote,
    startHostDispatchSession,
    syncRunOutput,
    createChatSession,
    createManualSession,
  };
}
