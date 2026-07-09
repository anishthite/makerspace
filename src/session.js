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

const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 16 * 1024 * 1024;
// ponytail: cap chat history in the session JSON; move to per-agent logs if this gets huge.
const MAX_THREAD_MESSAGES = 80;
const MAX_THREAD_MESSAGE_CHARS = 60_000;

export function normalizeClientId(value) {
  return slugify(String(value || '').trim());
}

export function threadMessage(role, text, timestampMs = Date.now(), runId = '', images = []) {
  const normalizedRole = role === 'assistant' ? 'assistant' : 'user';
  const body = String(text || '').trim();
  const timestamp = Number.isFinite(Number(timestampMs)) && Number(timestampMs) > 0
    ? new Date(Number(timestampMs)).toISOString()
    : new Date().toISOString();
  const imageAttachments = normalizeImageAttachments(images);

  return body ? {
    role: normalizedRole,
    text: body.slice(-MAX_THREAD_MESSAGE_CHARS),
    timestamp,
    ...(runId ? { runId: String(runId) } : {}),
    ...(imageAttachments.length ? { images: imageAttachments } : {}),
  } : null;
}

export function appendThreadMessages(session = {}, entries = []) {
  const current = Array.isArray(session.threadMessages) ? session.threadMessages : [];
  return [...current, ...entries]
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && String(message.text || '').trim())
    .slice(-MAX_THREAD_MESSAGES);
}

export function normalizeModelOptions(body = {}) {
  const modelRef = String(body.modelRef || '').trim();
  const thinkingLevel = String(body.thinkingLevel || '').trim().toLowerCase();
  if (thinkingLevel && !THINKING_LEVELS.has(thinkingLevel)) {
    throw new Error('Thinking level must be off, minimal, low, medium, high, or xhigh.');
  }
  return { modelRef, thinkingLevel };
}

function imageMimeType(value) {
  const mimeType = String(value || '').trim().toLowerCase();
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
}

function imageData(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('data:')) return text;
  const comma = text.indexOf(',');
  return comma === -1 ? '' : text.slice(comma + 1);
}

export function normalizeImageAttachments(value = []) {
  if (!value) return [];
  if (!Array.isArray(value)) throw new Error('Images must be an array.');
  if (value.length > MAX_IMAGE_ATTACHMENTS) throw new Error(`Attach at most ${MAX_IMAGE_ATTACHMENTS} images.`);

  let totalBytes = 0;
  return value.map((image, index) => {
    const mimeType = imageMimeType(image?.mimeType || image?.mediaType || image?.type);
    if (!IMAGE_MIME_TYPES.has(mimeType)) throw new Error('Images must be PNG, JPEG, GIF, or WebP.');

    const data = imageData(image?.data || image?.source?.data).replace(/\s/g, '');
    if (!data || data.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw new Error(`Image ${index + 1} is not valid base64.`);
    }

    const byteLength = Buffer.from(data, 'base64').byteLength;
    if (byteLength > MAX_IMAGE_BYTES) throw new Error('Each image must be 8MB or smaller.');
    totalBytes += byteLength;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error('Image attachments must be 16MB or smaller total.');

    return { type: 'image', mimeType, data };
  });
}

function normalizeImageField(body = {}) {
  const images = normalizeImageAttachments(body.images);
  return images.length ? { images } : {};
}

function normalizeDeliveryMode(body = {}) {
  if (body.deliveryMode === 'none' || body.autoPullRequest === false || body.autoPr === false) return '';
  return body.deliveryMode === 'draft-pr' || body.autoPullRequest === true || body.autoPr === true || body.repoSource === 'github' ? 'draft-pr' : '';
}

export function normalizeCreateRequest(body, config) {
  const repoUrl = String(body.repoUrl || '').trim();
  const branch = String(body.branch || '').trim();
  const taskPrompt = String(body.taskPrompt || '').trim() || config.defaultTaskPrompt;
  const visibility = body.visibility === 'public' ? 'public' : 'private';
  const repoSource = body.repoSource === 'github' ? 'github' : '';
  const autoRunAgent = body.autoRunAgent !== false;
  const sharePort = Number(body.sharePort);
  const normalizedSharePort = Number.isFinite(sharePort) && sharePort > 0 ? sharePort : null;
  const requestedName = String(body.name || '').trim();
  const fallbackName = buildGeneratedName(inferBaseName(repoUrl));
  const name = slugify(requestedName || fallbackName) || buildGeneratedName('spanner');

  return {
    name,
    repoUrl,
    repoMode: repoUrl ? 'git' : 'empty',
    branch,
    taskPrompt,
    visibility,
    ...(repoSource ? { repoSource } : {}),
    sharePort: normalizedSharePort,
    autoRunAgent,
    ...normalizeModelOptions(body),
    ...normalizeImageField(body),
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
        modelRef: body.modelRef,
        thinkingLevel: body.thinkingLevel,
        images: body.images,
      },
      config,
    ),
    ...(clientId ? { clientId } : {}),
    bridgeMode: true,
  };
}

export function normalizeThreadRequest(body, config) {
  const repoUrl = String(body.repoUrl || '').trim();
  const repoPath = String(body.repoPath || '').trim();
  const prompt = String(body.prompt || body.taskPrompt || '').trim();
  const repoSource = body.repoSource === 'github' ? 'github' : '';
  const repoRef = repoPath || repoUrl;

  if (!repoRef) {
    throw new Error('Repo URL or local folder is required.');
  }

  if (!prompt) {
    throw new Error('Starting prompt is required.');
  }

  const modeFields = repoPath
    ? { repoPath, repoMode: 'local', localMode: true }
    : { bridgeClaimed: true, bridgeMode: true };

  return {
    ...normalizeCreateRequest(
      {
        name: body.name,
        repoUrl: repoRef,
        branch: body.branch,
        taskPrompt: prompt,
        visibility: 'public',
        sharePort: config.bridgePort,
        autoRunAgent: false,
        modelRef: body.modelRef,
        thinkingLevel: body.thinkingLevel,
        images: body.images,
      },
      config,
    ),
    repoUrl,
    initialPrompt: prompt,
    ...(normalizeDeliveryMode(body) ? { deliveryMode: normalizeDeliveryMode(body) } : {}),
    ...modeFields,
    ...(repoSource ? { repoSource } : {}),
    threadBridge: true,
  };
}

export function decorateSession(session, config) {
  const { bridgeToken, previewToken, repoAuthHeader, githubOwnerSessionId, ownerUserId, images, raw, ...publicSession } = session;
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
