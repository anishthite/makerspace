import test from 'node:test';
import assert from 'node:assert/strict';

import { isBackgroundWorkflowToolEnd, workflowRunIdFromText } from '../src/host-pi-runner.js';

test('workflowRunIdFromText extracts workflow ids from completion text', () => {
  assert.equal(workflowRunIdFromText('Run ID: run-mqumvxu9-1\n'), 'run-mqumvxu9-1');
  assert.equal(workflowRunIdFromText('no run here'), '');
});

test('isBackgroundWorkflowToolEnd only flags real background workflow launches', () => {
  assert.equal(isBackgroundWorkflowToolEnd({ toolName: 'workflow', result: { details: { background: true } } }, ''), true);
  assert.equal(isBackgroundWorkflowToolEnd({ toolName: 'workflow', result: {} }, 'Workflow started in the background.'), true);
  assert.equal(isBackgroundWorkflowToolEnd({ toolName: 'workflow', isError: true, result: { details: { background: true } } }, ''), false);
  assert.equal(isBackgroundWorkflowToolEnd({ toolName: 'bash', result: {} }, 'Workflow started in the background.'), false);
});
