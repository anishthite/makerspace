import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFinalAnswerSummaryPrompt,
  buildFinalTurnStatusPrompt,
  cleanFinalAnswerSummary,
  cleanFinalTurnStatus,
  cleanThreadTitle,
  fallbackThreadTitle,
  generateFinalAnswerSummary,
  generateFinalTurnStatus,
  generateThreadTitle,
  parseThreadTitleModelRef,
  resolveThreadTitleModel,
} from '../src/thread-title.js';

test('cleanThreadTitle strips labels, quotes, punctuation, and extra lines', () => {
  assert.equal(cleanThreadTitle('Title: "Polish Settings Panel."\nextra'), 'Polish Settings Panel');
  assert.equal(cleanThreadTitle('{"title":"Fix Login Flow"}'), 'Fix Login Flow');
});

test('cleanThreadTitle trims long titles on a word boundary', () => {
  assert.equal(
    cleanThreadTitle('This title is definitely too long to fit in the tiny thread title header', 42),
    'This title is definitely too long to fit',
  );
});

test('cleanFinalAnswerSummary strips labels and keeps one line', () => {
  assert.equal(cleanFinalAnswerSummary('Summary: Shipped the dashboard fix.\nextra'), 'Shipped the dashboard fix');
  assert.equal(cleanFinalAnswerSummary('{"summary":"Updated home rows"}'), 'Updated home rows');
});

test('buildFinalAnswerSummaryPrompt caps output to the tail', () => {
  const prompt = buildFinalAnswerSummaryPrompt({ taskPrompt: 'Fix UI' }, `start${'x'.repeat(9000)}end`);
  assert.match(prompt, /Fix UI/);
  assert.doesNotMatch(prompt, /start/);
  assert.match(prompt, /end$/);
});

const turnStatusCases = [
  ['{"status":"done","color":"green","reason":"shipped"}', { status: 'done', color: 'green', reason: 'shipped' }],
  ['```json\n{"status":"waiting-on-human","reason":"needs login"}\n```', { status: 'waiting_on_human', color: 'amber', reason: 'needs login' }],
  ['not json', { status: 'unknown', color: 'gray', reason: 'unknown' }],
];

test('cleanFinalTurnStatus parses JSON and owns color mapping', () => {
  for (const [raw, expected] of turnStatusCases) assert.deepEqual(cleanFinalTurnStatus(raw), expected);
});

test('buildFinalTurnStatusPrompt includes prior user and latest assistant turns', () => {
  const prompt = buildFinalTurnStatusPrompt('Please fix it', 'Done. Tests pass.');
  assert.match(prompt, /tiny status classifier/);
  assert.match(prompt, /Previous user turn:\nPlease fix it/);
  assert.match(prompt, /Latest assistant turn:\nDone\. Tests pass\./);
});

test('fallbackThreadTitle uses the first useful prompt sentence', () => {
  assert.equal(
    fallbackThreadTitle({ taskPrompt: 'Polish the dashboard layout. Keep it tiny.', name: 'demo-20260624120000-abcdef' }),
    'Polish the dashboard layout',
  );
});

test('parseThreadTitleModelRef defaults bare model ids to openai-codex', () => {
  assert.deepEqual(parseThreadTitleModelRef('gpt-5.4-mini'), { provider: 'openai-codex', id: 'gpt-5.4-mini' });
  assert.deepEqual(parseThreadTitleModelRef('openai-codex/gpt-5.4-mini'), { provider: 'openai-codex', id: 'gpt-5.4-mini' });
});

test('resolveThreadTitleModel uses the registry model', () => {
  const model = { provider: 'openai-codex', id: 'gpt-5.4-mini' };
  assert.equal(resolveThreadTitleModel({ find: () => model }, 'openai-codex/gpt-5.4-mini'), model);
});

test('generateFinalAnswerSummary uses a minimal no-tool completion and cleans the response', async () => {
  const model = { provider: 'openai-codex', id: 'gpt-5.4-mini' };
  const summary = await generateFinalAnswerSummary(
    { taskPrompt: 'Fix the checkout flow.', repoUrl: 'https://github.com/acme/shop.git' },
    '<html><p>Done: fixed checkout totals and added a smoke test.</p></html>',
    {
      modelRef: 'openai-codex/gpt-5.4-mini',
      loadPiSdk: async () => ({
        AuthStorage: {
          create: () => ({
            getApiKey: async () => 'fake-token',
            getProviderEnv: () => ({ FOO: 'bar' }),
          }),
        },
        ModelRegistry: { create: () => ({ find: () => model }) },
      }),
      loadPiAi: async () => ({
        completeSimple: async (receivedModel, context, options) => {
          assert.equal(receivedModel, model);
          assert.equal(context.systemPrompt, 'Return only the one-line summary text.');
          assert.match(context.messages[0].content, /checkout totals/);
          assert.equal(options.apiKey, 'fake-token');
          assert.equal(options.reasoning, 'minimal');
          assert.equal(options.maxTokens, 48);
          return { stopReason: 'stop', content: [{ type: 'text', text: 'Summary: Fixed checkout totals and added a smoke test.' }] };
        },
      }),
    },
  );

  assert.equal(summary, 'Fixed checkout totals and added a smoke test');
});

test('generateFinalTurnStatus uses a no-thinking JSON classifier completion', async () => {
  const model = { provider: 'openai-codex', id: 'gpt-5.4-mini' };
  const status = await generateFinalTurnStatus(
    'Please add the button.',
    'Done. Added it and ran the focused test.',
    {
      modelRef: 'openai-codex/gpt-5.4-mini',
      loadPiSdk: async () => ({
        AuthStorage: {
          create: () => ({
            getApiKey: async () => 'fake-token',
            getProviderEnv: () => ({ FOO: 'bar' }),
          }),
        },
        ModelRegistry: { create: () => ({ find: () => model }) },
      }),
      loadPiAi: async () => ({
        completeSimple: async (receivedModel, context, options) => {
          assert.equal(receivedModel, model);
          assert.equal(context.systemPrompt, 'Return only the JSON object.');
          assert.match(context.messages[0].content, /Previous user turn:\nPlease add the button\./);
          assert.match(context.messages[0].content, /Latest assistant turn:\nDone\. Added it/);
          assert.equal(options.apiKey, 'fake-token');
          assert.equal(options.temperature, undefined);
          assert.equal(options.reasoning, 'off');
          assert.equal(options.maxTokens, 96);
          return { stopReason: 'stop', content: [{ type: 'text', text: '{"status":"done","color":"green","reason":"completed"}' }] };
        },
      }),
    },
  );

  assert.deepEqual(status, { status: 'done', color: 'green', reason: 'completed' });
});

test('generateThreadTitle uses a minimal no-tool completion and cleans the response', async () => {
  const model = { provider: 'openai-codex', id: 'gpt-5.4-mini' };
  const title = await generateThreadTitle(
    { taskPrompt: 'Fix the checkout flow.', repoUrl: 'https://github.com/acme/shop.git' },
    {
      modelRef: 'openai-codex/gpt-5.4-mini',
      loadPiSdk: async () => ({
        AuthStorage: {
          create: () => ({
            getApiKey: async () => 'fake-token',
            getProviderEnv: () => ({ FOO: 'bar' }),
          }),
        },
        ModelRegistry: { create: () => ({ find: () => model }) },
      }),
      loadPiAi: async () => ({
        completeSimple: async (receivedModel, context, options) => {
          assert.equal(receivedModel, model);
          assert.equal(context.systemPrompt, 'Return only the title text.');
          assert.match(context.messages[0].content, /Fix the checkout flow/);
          assert.equal(options.apiKey, 'fake-token');
          assert.equal(options.reasoning, 'minimal');
          assert.equal(options.maxTokens, 32);
          return { stopReason: 'stop', content: [{ type: 'text', text: 'Title: "Fix Checkout Flow"' }] };
        },
      }),
    },
  );

  assert.equal(title, 'Fix Checkout Flow');
});
