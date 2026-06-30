export const DEFAULT_THREAD_TITLE_MODEL = 'openai-codex/gpt-5.4-mini';
const MAX_TITLE_LENGTH = 64;
const MAX_SUMMARY_LENGTH = 140;
const SUMMARY_OUTPUT_CHARS = 8_000;

export function cleanThreadTitle(value, maxLength = MAX_TITLE_LENGTH) {
  let text = String(value ?? '').replaceAll('\r', '\n').trim();
  const jsonTitle = text.match(/"title"\s*:\s*"([^"]+)"/i);
  if (jsonTitle) text = jsonTitle[1];

  text = (text.split('\n').map((line) => line.trim()).find(Boolean) || '')
    .replace(/^[-*\d.)\s]+/, '')
    .replace(/^(?:(?:thread|agent)\s+title|title|name)\s*[:\-–—]\s*/i, '')
    .replace(/^[-–—:;,.\s"'`“”‘’]+|[-–—:;,.\s"'`“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > maxLength) {
    const slice = text.slice(0, maxLength + 1);
    const boundary = slice.lastIndexOf(' ');
    text = slice.slice(0, boundary >= 32 ? boundary : maxLength).trim();
  }

  return text;
}

function repoLabel(session) {
  const raw = String(session?.repoPath || session?.repoUrl || '').trim().replace(/\/+$/, '');
  const leaf = raw.split(/[/:]/).pop() || '';
  return leaf.replace(/\.git$/i, '') || String(session?.name || '').replace(/-\d{14}-[a-f0-9]{6}$/i, '');
}

export function fallbackThreadTitle(session) {
  const prompt = String(session?.taskPrompt || '').replace(/```[\s\S]*?```/g, ' ').trim();
  const sentence = prompt.split(/[.!?\n]/).map((part) => part.trim()).find(Boolean) || '';
  const title = cleanThreadTitle(sentence, 56);
  if (title.length >= 8) return title;
  return cleanThreadTitle(repoLabel(session) || session?.name || 'New agent');
}

export function parseThreadTitleModelRef(modelRef = DEFAULT_THREAD_TITLE_MODEL) {
  const text = String(modelRef || DEFAULT_THREAD_TITLE_MODEL).trim();
  const slash = text.indexOf('/');
  return slash === -1
    ? { provider: 'openai-codex', id: text }
    : { provider: text.slice(0, slash), id: text.slice(slash + 1) };
}

export function resolveThreadTitleModel(modelRegistry, modelRef = DEFAULT_THREAD_TITLE_MODEL) {
  const { provider, id } = parseThreadTitleModelRef(modelRef);
  return modelRegistry.find?.(provider, id) || modelRegistry.getAll?.().find((model) => model.provider === provider && model.id === id) || null;
}

function assistantText(message) {
  return (message?.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join('')
    .trim();
}

export function buildThreadTitlePrompt(session) {
  return [
    'Write a concise display title for this coding agent run.',
    'Rules: 2-6 words, no quotes, no emoji, no trailing punctuation, do not include the word "agent".',
    `Repo: ${repoLabel(session) || 'unknown'}`,
    `Task: ${String(session?.taskPrompt || '').trim().slice(0, 1200)}`,
  ].join('\n');
}

export function cleanFinalAnswerSummary(value, maxLength = MAX_SUMMARY_LENGTH) {
  let text = String(value ?? '').replaceAll('\r', '\n').trim();
  const jsonSummary = text.match(/"summary"\s*:\s*"([^"]+)"/i);
  if (jsonSummary) text = jsonSummary[1];

  text = (text.split('\n').map((line) => line.trim()).find(Boolean) || '')
    .replace(/^(?:(?:one[- ]line\s+)?(?:final\s+answer\s+)?summary|final\s+answer|answer)\s*[:\-–—]\s*/i, '')
    .replace(/^[-–—:;,\.\s"'`“”‘’]+|[-–—:;,\.\s"'`“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > maxLength) {
    const slice = text.slice(0, maxLength + 1);
    const boundary = slice.lastIndexOf(' ');
    text = slice.slice(0, boundary >= 60 ? boundary : maxLength).trim();
  }

  return text;
}

export function buildFinalAnswerSummaryPrompt(session, finalOutput) {
  return [
    'Summarize this finished coding agent output for a dashboard row.',
    'Rules: one line, 8-18 words, plain text, no quotes, no HTML, no Markdown, no "answer:" prefix.',
    'Say what was accomplished; ignore wrapper tags, tool logs, and formatting instructions.',
    `Task: ${String(session?.taskPrompt || '').trim().slice(0, 1200)}`,
    `Final output:\n${String(finalOutput || '').trim().slice(-SUMMARY_OUTPUT_CHARS)}`,
  ].join('\n');
}

async function generateShortText(options, settings) {
  const modelRef = String(options.modelRef || DEFAULT_THREAD_TITLE_MODEL).trim();
  if (!modelRef || modelRef.toLowerCase() === 'off') return '';
  if (!options.loadPiSdk || !options.loadPiAi) throw new Error('Pi SDK loaders are required.');

  const [{ AuthStorage, ModelRegistry }, { completeSimple }] = await Promise.all([
    options.loadPiSdk(),
    options.loadPiAi(),
  ]);
  const authStorage = options.authStorage || AuthStorage.create();
  const modelRegistry = options.modelRegistry || ModelRegistry.create(authStorage);
  const model = resolveThreadTitleModel(modelRegistry, modelRef);
  if (!model) throw new Error(`${settings.label} model not found: ${modelRef}`);

  const apiKey = await authStorage.getApiKey(model.provider, { includeFallback: true });
  if (!apiKey) throw new Error(`No auth configured for ${model.provider}.`);

  const response = await completeSimple(
    model,
    {
      systemPrompt: settings.systemPrompt,
      messages: [{ role: 'user', content: settings.prompt, timestamp: Date.now() }],
    },
    {
      apiKey,
      env: authStorage.getProviderEnv?.(model.provider),
      signal: options.signal,
      maxTokens: settings.maxTokens,
      reasoning: 'minimal',
      cacheRetention: 'none',
    },
  );

  if (response.stopReason === 'error') throw new Error(response.errorMessage || `${settings.label} generation failed.`);
  const text = settings.clean(assistantText(response));
  if (!text) throw new Error(`${settings.label} generation returned an empty ${settings.emptyNoun}.`);
  return text;
}

export function generateThreadTitle(session, options = {}) {
  return generateShortText(options, {
    label: 'Agent title',
    emptyNoun: 'title',
    systemPrompt: 'Return only the title text.',
    prompt: buildThreadTitlePrompt(session),
    maxTokens: 32,
    clean: cleanThreadTitle,
  });
}

export function generateFinalAnswerSummary(session, finalOutput, options = {}) {
  return generateShortText(options, {
    label: 'Answer summary',
    emptyNoun: 'summary',
    systemPrompt: 'Return only the one-line summary text.',
    prompt: buildFinalAnswerSummaryPrompt(session, finalOutput),
    maxTokens: 48,
    clean: cleanFinalAnswerSummary,
  });
}
