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
  if (!agents && !rules) return;

  pi.on('before_agent_start', (event: any) => {
    const block = promptBlock(event);
    if (!block) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
  });
}
