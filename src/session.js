import { randomBytes } from 'node:crypto';

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48);
}

function inferBaseName(repoUrl) {
  if (!repoUrl) {
    return 'blank-repo';
  }

  const trimmed = repoUrl.replace(/\/+$/, '');
  const leaf = trimmed.split('/').pop() || 'repo';
  return leaf.replace(/\.git$/, '');
}

function buildTimestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function buildGeneratedName(baseName) {
  return `${baseName}-${buildTimestamp()}-${randomBytes(3).toString('hex')}`;
}

export function normalizeClientId(value) {
  return slugify(String(value || '').trim());
}

export function normalizeCreateRequest(body, config) {
  const repoUrl = String(body.repoUrl || '').trim();
  const branch = String(body.branch || '').trim();
  const taskPrompt = String(body.taskPrompt || '').trim() || config.defaultTaskPrompt;
  const visibility = body.visibility === 'public' ? 'public' : 'private';
  const autoRunAgent = body.autoRunAgent !== false;
  const sharePort = Number(body.sharePort);
  const normalizedSharePort = Number.isFinite(sharePort) && sharePort > 0 ? sharePort : null;
  const requestedName = String(body.name || '').trim();
  const fallbackName = buildGeneratedName(inferBaseName(repoUrl));
  const name = slugify(requestedName || fallbackName) || buildGeneratedName('micro-cloud');

  return {
    name,
    repoUrl,
    repoMode: repoUrl ? 'git' : 'empty',
    branch,
    taskPrompt,
    visibility,
    sharePort: normalizedSharePort,
    autoRunAgent,
  };
}

export function normalizeChatRequest(body, config) {
  const prompt = String(body.prompt || '').trim();
  const clientId = normalizeClientId(body.clientId);

  if (!prompt) {
    throw new Error('Prompt is required.');
  }

  return {
    ...normalizeCreateRequest(
      {
        name: body.name,
        repoUrl: '',
        branch: '',
        taskPrompt: prompt,
        visibility: 'public',
        sharePort: config.bridgePort,
        autoRunAgent: true,
      },
      config,
    ),
    ...(clientId ? { clientId } : {}),
    bridgeMode: true,
  };
}

export function normalizeThreadRequest(body, config) {
  const repoUrl = String(body.repoUrl || '').trim();
  const prompt = String(body.prompt || body.taskPrompt || '').trim();
  const repoSource = body.repoSource === 'github' ? 'github' : '';

  if (!repoUrl) {
    throw new Error('Repo URL is required.');
  }

  if (!prompt) {
    throw new Error('Starting prompt is required.');
  }

  return {
    ...normalizeCreateRequest(
      {
        name: body.name,
        repoUrl,
        branch: body.branch,
        taskPrompt: prompt,
        visibility: 'public',
        sharePort: config.bridgePort,
        autoRunAgent: false,
      },
      config,
    ),
    ...(repoSource ? { repoSource } : {}),
    bridgeClaimed: true,
    bridgeMode: true,
    threadBridge: true,
  };
}

export function decorateSession(session, config) {
  const { bridgeToken, previewToken, repoAuthHeader, githubOwnerSessionId, raw, ...publicSession } = session;
  const sshDest = session.sshDest || null;
  const httpsUrl = session.httpsUrl || session.bridgeUrl || null;
  const bridgeUrl = session.bridgeUrl || (session.bridgeMode ? httpsUrl : null);
  const connectCommand = session.connectCommand || (sshDest ? `ssh ${sshDest}` : null);
  const controlDir = config.remoteControlDir;

  return {
    ...publicSession,
    sshDest,
    httpsUrl,
    bridgeUrl,
    hasBridgeToken: Boolean(bridgeToken),
    commands: {
      connect: connectCommand,
      ssh: sshDest ? `ssh ${sshDest}` : null,
      runAgent: session.runAgentCommand || (sshDest ? `ssh ${sshDest} 'bash ${controlDir}/run-pi.sh'` : null),
      tailLog: session.tailLogCommand || (sshDest ? `ssh ${sshDest} 'tail -n 120 ${controlDir}/pi.log'` : null),
    },
  };
}
