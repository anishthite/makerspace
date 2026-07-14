import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../frontend/src/runtime/thread.js', import.meta.url), 'utf8');

test('thread SSE errors are delayed and backed by output polling', () => {
  assert.match(js, /const STREAM_RECONNECT_NOTICE_MS = 2500/);
  assert.match(js, /const STREAM_FALLBACK_INITIAL_POLL_MS = 800/);
  assert.match(js, /function scheduleStreamRecovery\(\)/);
  assert.match(js, /setTimeout\(\(\) => \{ void pollStreamFallback\(\); \}, STREAM_FALLBACK_INITIAL_POLL_MS\)/);
  assert.match(js, /const payload = await loadOutput\(\)/);
  assert.match(js, /activeStream\.onerror = \(\) => \{\n\s*if \(!activeStream\) return;\n\s*streamConnected = false;\n\s*scheduleStreamRecovery\(\);\n\s*\};/);
  assert.doesNotMatch(js, /stream lost; retrying/);
});

test('thread SSE terminal handling uses the shared stream cleanup path', () => {
  assert.match(js, /function finishStreamStatus\(runStatus, session = null\)/);
  assert.match(js, /if \(payload\.done \|\| isClosedRunStatus\(payload\.runStatus\)\) \{\n\s*const doneStatus = payload\.runStatus \|\| \(payload\.done \? 'failed' : ''\);\n\s*finishStreamStatus\(doneStatus, payload\.session\);\n\s*\}/);
});
