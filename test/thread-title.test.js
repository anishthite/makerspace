import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFinalAnswerSummaryPrompt,
  buildFinalTurnStatusPrompt,
  buildSuggestedNextStepsPrompt,
  buildWorkspaceLaunchSuggestionsPrompt,
  cleanFinalAnswerSummary,
  cleanFinalTurnStatus,
  cleanSuggestedNextSteps,
  cleanThreadTitle,
  fallbackThreadTitle,
  generateFinalAnswerSummary,
  generateFinalTurnStatus,
  generateSuggestedNextSteps,
  generateThreadTitle,
  generateWorkspaceLaunchSuggestions,
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

test('cleanSuggestedNextSteps parses JSON steps and caps to three', () => {
  assert.deepEqual(
    cleanSuggestedNextSteps('{"steps":[{"label":"Run tests","prompt":"Run the focused tests."},{"label":"Open PR","prompt":"Open a draft PR."},{"label":"Polish UI","prompt":"Polish the spacing."},{"label":"Ignored","prompt":"Ignored."}]}'),
    [
      { label: 'Run tests', prompt: 'Run the focused tests' },
      { label: 'Open PR', prompt: 'Open a draft PR' },
      { label: 'Polish UI', prompt: 'Polish the spacing' },
    ],
  );
});

test('buildSuggestedNextStepsPrompt asks for button labels and exact prompts', () => {
  const prompt = buildSuggestedNextStepsPrompt({ taskPrompt: 'Fix UI' }, 'Done. Tests pass.');
  assert.match(prompt, /Return only JSON shaped exactly like/);
  assert.match(prompt, /"label":"short button label"/);
  assert.match(prompt, /"prompt":"exact prompt to send"/);
  assert.match(prompt, /Latest answer:\nDone\. Tests pass\./);
});

const workspaceThreads = [{
  title: 'Sidebar cleanup',
  taskPrompt: 'Polish the workspace sidebar.',
  finalAnswerSummary: 'Moved clear controls into the finished lane.',
  finalTurnStatus: 'done',
}];

test('buildWorkspaceLaunchSuggestionsPrompt uses thread outcomes, not thread suggestions', () => {
  const prompt = buildWorkspaceLaunchSuggestionsPrompt(workspaceThreads);
  assert.match(prompt, /workspace dashboard/);
  assert.match(prompt, /Sidebar cleanup/);
  assert.match(prompt, /Moved clear controls/);
  assert.match(prompt, /Do not rely on or copy existing thread suggestions/);
  assert.doesNotMatch(prompt, /suggestedNextSteps/);
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

test('generateSuggestedNextSteps uses a JSON completion and cleans prompts', async () => {
  const model = { provider: 'openai-codex', id: 'gpt-5.4-mini' };
  const steps = await generateSuggestedNextSteps(
    { taskPrompt: 'Fix the checkout flow.' },
    'Done. Fixed totals and added a smoke test.',
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
          assert.match(context.messages[0].content, /Suggested useful next-step prompts|Suggest useful next-step prompts/);
          assert.equal(options.apiKey, 'fake-token');
          assert.equal(options.reasoning, 'minimal');
          assert.equal(options.maxTokens, 512);
          return { stopReason: 'stop', content: [{ type: 'text', text: '{"steps":[{"label":"Run tests","prompt":"Run the focused tests."}]}' }] };
        },
      }),
    },
  );

  assert.deepEqual(steps, [{ label: 'Run tests', prompt: 'Run the focused tests' }]);
});

test('generateWorkspaceLaunchSuggestions uses a JSON completion and cleans prompts', async () => {
  const model = { provider: 'openai-codex', id: 'gpt-5.4-mini' };
  const steps = await generateWorkspaceLaunchSuggestions(
    workspaceThreads,
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
          assert.match(context.messages[0].content, /workspace dashboard/);
          assert.equal(options.apiKey, 'fake-token');
          assert.equal(options.reasoning, 'minimal');
          assert.equal(options.maxTokens, 512);
          return { stopReason: 'stop', content: [{ type: 'text', text: '{"steps":[{"label":"Review sidebar","prompt":"Review the sidebar cleanup and run one broader UI check."}]}' }] };
        },
      }),
    },
  );

  assert.deepEqual(steps, [{ label: 'Review sidebar', prompt: 'Review the sidebar cleanup and run one broader UI check' }]);
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
