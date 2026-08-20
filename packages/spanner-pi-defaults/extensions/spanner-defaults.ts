import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function readOptional(relativePath: string): string {
  try {
    return readFileSync(path.join(root, relativePath), 'utf8').trim();
  } catch {
    return '';
  }
}

const agents = readOptional('context/AGENTS.md');
const rules = readOptional('context/RULES.md');

function contextHasAgents(event: any): boolean {
  const files = event?.systemPromptOptions?.contextFiles;
  return Array.isArray(files) && files.some((file: any) => String(file?.content || '').trim() === agents);
}

function promptBlock(event: any): string {
  return [
    agents && !contextHasAgents(event) && `<spanner-instructions>\n${agents}\n</spanner-instructions>`,
    rules && `<spanner-rules>\n${rules}\n</spanner-rules>`,
  ].filter(Boolean).join('\n\n');
}

export default function spannerDefaults(pi: any) {
  pi.registerProvider('inference', {
    name: 'Inference.net',
    baseUrl: 'https://api.inference.net/v1',
    api: 'openai-completions',
    authHeader: true,
    apiKey: '$INFERENCE_API_KEY',
    models: [
      { id: 'glm-5.2', name: 'glm-5.2', input: ['text'], contextWindow: 200000, maxTokens: 131072, reasoning: true, cost: { input: 1.3, output: 4.4, cacheRead: 0, cacheWrite: 0 } },
      { id: 'kimi-k3', name: 'kimi-k3', input: ['text'], contextWindow: 1048576, maxTokens: 131072, reasoning: true, cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 } },
      { id: 'kimi-k3-fast', name: 'kimi-k3-fast', input: ['text'], contextWindow: 1048576, maxTokens: 131072, reasoning: true, cost: { input: 4.5, output: 22.5, cacheRead: 0, cacheWrite: 0 } },
      { id: 'deepseek-v4-flash-0731', name: 'deepseek-v4-flash-0731', input: ['text'], contextWindow: 1048575, maxTokens: 384000, reasoning: true, cost: { input: 0.168, output: 0.336, cacheRead: 0, cacheWrite: 0 } },
    ],
  });

  if (!agents && !rules) return;

  pi.on('before_agent_start', (event: any) => {
    const block = promptBlock(event);
    if (!block) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
  });
}
