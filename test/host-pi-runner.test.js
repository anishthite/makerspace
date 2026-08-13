import test from 'node:test';
import assert from 'node:assert/strict';

import { assistantProviderErrorMessage, assistantTraceFields, runCreatedPiSession } from '../src/host-pi-runner.js';

test('assistantProviderErrorMessage extracts provider detail from empty assistant errors', () => {
  assert.equal(
    assistantProviderErrorMessage({
      role: 'assistant',
      stopReason: 'error',
      errorMessage: '{"detail":"Unable to fetch authentication verification keys."}',
      content: [],
    }),
    'Unable to fetch authentication verification keys.',
  );
});

test('assistantProviderErrorMessage ignores normal assistant messages', () => {
  assert.equal(
    assistantProviderErrorMessage({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Done' }] }),
    '',
  );
});

test('assistantTraceFields keeps thinking deltas tied to assistant messages', () => {
  assert.deepEqual(
    assistantTraceFields(
      { message: { timestamp: 1234 } },
      { type: 'thinking_delta', contentIndex: 2, partial: { timestamp: 9999 } },
    ),
    { messageTimestamp: 1234, contentIndex: 2 },
  );
  assert.deepEqual(assistantTraceFields({}, { partial: { timestamp: 4567 } }), { messageTimestamp: 4567 });
});

test('emits a non-streamed final response after an earlier streamed assistant turn', async () => {
  const chunks = [];
  let onEvent;
  const finalMessage = { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] };
  const piSession = {
    agent: { streamFn: async () => {} },
    subscribe(listener) {
      onEvent = listener;
      return () => {};
    },
    async prompt() {
      onEvent({ type: 'message_start', message: { role: 'assistant' } });
      onEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Working.' } });
      onEvent({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Working.' }] } });
      onEvent({ type: 'message_start', message: { role: 'assistant' } });
      onEvent({ type: 'message_end', message: finalMessage });
      onEvent({ type: 'agent_end', messages: [finalMessage] });
    },
    getLastAssistantText: () => 'Done.',
    dispose() {},
  };

  await runCreatedPiSession({
    createSession: async () => ({ session: piSession }),
    session: { taskPrompt: 'Test', submittedAtMs: 1 },
    emitOutput: () => {},
    emitMetric: async () => {},
    emitStatus: async () => {},
    emitEvent: (event) => {
      if (event.type === 'chunk') chunks.push(event.chunk);
    },
    failureLabel: 'Test run',
  });

  assert.deepEqual(chunks, ['Working.', 'Done.']);
});
