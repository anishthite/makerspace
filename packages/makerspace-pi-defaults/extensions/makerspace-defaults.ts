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
const block = [
  agents && `<makerspace-instructions>\n${agents}\n</makerspace-instructions>`,
  rules && `<makerspace-rules>\n${rules}\n</makerspace-rules>`,
].filter(Boolean).join('\n\n');

function registerInferenceProvider(pi: any) {
  pi.registerProvider('inference', {
    name: 'Inference.net',
    baseUrl: 'https://api.inference.net/v1',
    api: 'openai-completions',
    apiKey: '$INFERENCE_API_KEY',
    models: [{
      id: 'nvidia/nemotron3-super',
      name: 'NVIDIA Nemotron 3 Super',
      reasoning: false,
      input: ['text'],
      contextWindow: 128000,
      maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: false,
        maxTokensField: 'max_tokens',
        supportsStrictMode: false,
      },
    }],
  });
}

export default function makerspaceDefaults(pi: any) {
  registerInferenceProvider(pi);

  if (!block) return;

  pi.on('before_agent_start', (event: any) => ({
    systemPrompt: `${event.systemPrompt}\n\n${block}`,
  }));
}
