import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasSpannerReplayConsent,
  sanitizeAnalyticsProperties,
  sanitizePostHogUrl,
  sanitizeSpannerRoute,
  setSpannerReplayConsent,
  spannerDistinctId,
} from '../frontend/src/lib/posthog.js';

function withLocation(href, fn) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(href) });
  try {
    fn();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else delete globalThis.location;
  }
}

test('sanitizes Spanner routes without query strings', () => {
  assert.equal(sanitizeSpannerRoute('/thread.html?name=secret'), '/thread');
  assert.equal(sanitizeSpannerRoute('/settings.html#github'), '/settings');
  assert.equal(sanitizeSpannerRoute('/not-a-route?repo=secret'), '/unknown');
});

test('sanitizes localhost desktop replay URLs', () => {
  globalThis.spannerDesktop = {};
  try {
    assert.equal(
      sanitizePostHogUrl('http://127.0.0.1:49201/thread.html?name=private-thread'),
      'https://desktop.spanner.local/thread',
    );
  } finally {
    delete globalThis.spannerDesktop;
  }
});

test('keeps hosted origin but drops sensitive URL parts', () => {
  assert.equal(
    sanitizePostHogUrl('https://spanner.example.com/workspace.html?repo=https://github.com/private/repo'),
    'https://spanner.example.com/workspace',
  );
});

test('uses mode-prefixed distinct ids', () => {
  assert.equal(spannerDistinctId('abc-123', false), 'web:abc-123');
  assert.equal(spannerDistinctId('abc 123', true), 'desktop:abc123');
});

test('drops sensitive analytics properties', () => {
  withLocation('https://spanner.example.com/thread.html?name=secret', () => {
    const props = sanitizeAnalyticsProperties({ status: 'completed', prompt: 'secret', repoPath: '/private/repo', duration_ms: 42 });
    assert.equal(props.status, 'completed');
    assert.equal(props.duration_ms, 42);
    assert.equal(props.prompt, undefined);
    assert.equal(props.repoPath, undefined);
    assert.equal(props.$current_url, 'https://spanner.example.com/thread');
  });
});

test('stores replay opt-out explicitly', () => {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  };
  try {
    setSpannerReplayConsent(true);
    assert.equal(hasSpannerReplayConsent(), true);
    setSpannerReplayConsent(false);
    assert.equal(store.get('spannerPosthogReplayConsent'), '0');
    assert.equal(hasSpannerReplayConsent(), false);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
