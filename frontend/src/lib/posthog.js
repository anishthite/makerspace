const SESSION_KEY = 'spannerBrowserSession';
const REPLAY_CONSENT_KEY = 'spannerPosthogReplayConsent';
const DEFAULT_HOST = 'https://us.i.posthog.com';
const DESKTOP_ORIGIN = 'https://desktop.spanner.local';
const WEB_FALLBACK_ORIGIN = 'https://spanner.local';
const SENSITIVE_KEY_RE = /(prompt|repo|path|url|diff|output|text|message|secret|token|key|password|authorization|cookie|credential)/i;
const DENIED_POSTHOG_KEYS = new Set(['$initial_current_url', '$initial_pathname', '$referrer', '$initial_referrer']);
const ROUTE_ALIASES = new Map([
  ['/', '/'],
  ['/index.html', '/'],
  ['/landing', '/landing'],
  ['/desktop', '/desktop'],
  ['/desktop.html', '/desktop'],
  ['/workspace', '/workspace'],
  ['/workspace.html', '/workspace'],
  ['/thread', '/thread'],
  ['/thread.html', '/thread'],
  ['/settings', '/settings'],
  ['/settings.html', '/settings'],
  ['/history', '/history'],
  ['/history.html', '/history'],
  ['/telemetry', '/telemetry'],
  ['/telemetry.html', '/telemetry'],
  ['/local-telemetry', '/local-telemetry'],
  ['/local-telemetry.html', '/local-telemetry'],
]);

let posthogPromise = null;
let pageviewCaptured = false;

function envValue(key, fallback = '') {
  return String(import.meta.env?.[key] ?? fallback).trim();
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function analyticsDisabled() {
  return truthy(envValue('VITE_POSTHOG_DISABLED')) || truthy(envValue('VITE_SPANNER_ANALYTICS_DISABLED'));
}

function analyticsKey() {
  return envValue('VITE_POSTHOG_KEY');
}

function analyticsHost() {
  return envValue('VITE_POSTHOG_HOST', DEFAULT_HOST) || DEFAULT_HOST;
}

function replayEnabledByDefault() {
  return truthy(envValue('VITE_POSTHOG_REPLAY_ENABLED')) || truthy(envValue('VITE_POSTHOG_REPLAY_DEFAULT'));
}

function isDesktopApp() {
  return Boolean(globalThis.spannerDesktop);
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function browserSessionId() {
  try {
    let value = globalThis.localStorage?.getItem(SESSION_KEY) || '';
    if (!value) {
      value = randomId();
      globalThis.localStorage?.setItem(SESSION_KEY, value);
    }
    return value;
  } catch {
    return randomId();
  }
}

export function spannerDistinctId(sessionId = browserSessionId(), desktop = isDesktopApp()) {
  return `${desktop ? 'desktop' : 'web'}:${String(sessionId || '').replace(/[^a-zA-Z0-9:._-]/g, '') || randomId()}`;
}

export function sanitizeSpannerRoute(pathname = '/') {
  const raw = `/${String(pathname || '/')}`.replace(/^\/+/g, '/').replace(/\?.*$/, '').replace(/#.*$/, '');
  const clean = raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
  return ROUTE_ALIASES.get(clean) || '/unknown';
}

export function sanitizePostHogUrl(value = globalThis.location?.href || '/') {
  let url;
  try {
    url = new URL(String(value || '/'), globalThis.location?.origin || WEB_FALLBACK_ORIGIN);
  } catch {
    url = new URL('/', WEB_FALLBACK_ORIGIN);
  }
  const origin = isDesktopApp() || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(url.origin)
    ? DESKTOP_ORIGIN
    : url.origin;
  return `${origin}${sanitizeSpannerRoute(url.pathname)}`;
}

export function hasSpannerReplayConsent() {
  try {
    const stored = globalThis.localStorage?.getItem(REPLAY_CONSENT_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {}
  return replayEnabledByDefault();
}

export function isSpannerAnalyticsConfigured() {
  return Boolean(analyticsKey()) && !analyticsDisabled();
}

function primitive(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

export function sanitizeAnalyticsProperties(properties = {}) {
  const safe = {
    app: 'spanner',
    app_mode: isDesktopApp() ? 'desktop' : 'web',
    $current_url: sanitizePostHogUrl(),
    $pathname: sanitizeSpannerRoute(globalThis.location?.pathname || '/'),
  };

  for (const [key, value] of Object.entries(properties || {})) {
    if (DENIED_POSTHOG_KEYS.has(key) || SENSITIVE_KEY_RE.test(key)) continue;
    if (!primitive(value)) continue;
    if (typeof value === 'string') safe[key] = value.slice(0, 120);
    else if (Number.isFinite(value) || typeof value === 'boolean' || value === null) safe[key] = value;
  }
  return safe;
}

export function sanitizeBeforeSend(event) {
  if (!event || typeof event !== 'object') return event;
  const properties = event.properties || {};
  const internal = Object.fromEntries(Object.entries(properties).filter(([key]) => key === 'token' || key === 'distinct_id' || (key.startsWith('$') && !DENIED_POSTHOG_KEYS.has(key))));
  if (event.event === '$snapshot' || event.event === '$snapshot_items') {
    return {
      ...event,
      properties: {
        ...internal,
        $snapshot_data: properties.$snapshot_data,
        $current_url: sanitizePostHogUrl(),
        $pathname: sanitizeSpannerRoute(globalThis.location?.pathname || '/'),
      },
    };
  }
  return {
    ...event,
    properties: {
      ...internal,
      ...sanitizeAnalyticsProperties(properties),
    },
  };
}

function redactReplayRequest(request = {}) {
  return { ...request, url: sanitizePostHogUrl(request.url || globalThis.location?.href || '/') };
}

async function loadPostHog() {
  if (!isSpannerAnalyticsConfigured()) return null;
  try {
    const module = await import('posthog-js/dist/module.full.no-external');
    return module.default || module;
  } catch (error) {
    console.warn('PostHog disabled:', error?.message || error);
    return null;
  }
}

async function posthogClient() {
  if (!posthogPromise) {
    posthogPromise = (async () => {
      const posthog = await loadPostHog();
      if (!posthog) return null;
      posthog.init(analyticsKey(), {
        api_host: analyticsHost(),
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: !hasSpannerReplayConsent(),
        disable_surveys: true,
        disable_external_dependency_loading: true,
        disable_capture_url_hashes: true,
        get_current_url: () => sanitizePostHogUrl(),
        before_send: sanitizeBeforeSend,
        property_denylist: ['$initial_current_url', '$initial_pathname', '$referrer', '$initial_referrer'],
        mask_all_element_attributes: true,
        session_recording: {
          blockClass: 'ph-no-capture',
          ignoreClass: 'ph-ignore-input',
          maskTextClass: 'ph-mask',
          maskAllInputs: true,
          blockSelector: '.ph-no-capture, .message-body, .tool-card pre, .thinking-body, .diff-dialog-body, iframe.html-preview, iframe.note-html-preview, .resource-list, .settings-code-field',
          maskTextSelector: '.ph-mask, .history-prompt, .answer-preview, .next-step-btn span, .launch-suggestions span, .tool-target, .diff-file, .action-thread .inbox-main, #repo-hint, #project-label, #workspace-label, #thread-title, #thread-meta',
          maskCapturedNetworkRequestFn: redactReplayRequest,
        },
        persistence: 'localStorage',
        person_profiles: 'identified_only',
      });
      posthog.identify(spannerDistinctId());
      if (hasSpannerReplayConsent()) posthog.startSessionRecording?.({ linked_flag: true, sampling: true });
      return posthog;
    })();
  }
  return posthogPromise;
}

export async function initSpannerAnalytics({ page = '' } = {}) {
  const posthog = await posthogClient();
  if (!posthog) return null;
  captureSpannerEvent('app_opened', { page: page || sanitizeSpannerRoute(globalThis.location?.pathname || '/') });
  if (!pageviewCaptured) {
    pageviewCaptured = true;
    captureSpannerPageView(page);
  }
  return posthog;
}

export function captureSpannerPageView(page = '') {
  void posthogClient().then((posthog) => {
    if (!posthog) return;
    posthog.capture('$pageview', sanitizeAnalyticsProperties({ page: page || sanitizeSpannerRoute(globalThis.location?.pathname || '/') }));
  });
}

export function captureSpannerEvent(eventName, properties = {}) {
  const event = String(eventName || '').trim().replace(/[^a-zA-Z0-9_:-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!event) return;
  void posthogClient().then((posthog) => {
    if (!posthog) return;
    posthog.capture(event.startsWith('spanner_') ? event : `spanner_${event}`, sanitizeAnalyticsProperties(properties));
  });
}

export function setSpannerReplayConsent(enabled) {
  try {
    globalThis.localStorage?.setItem(REPLAY_CONSENT_KEY, enabled ? '1' : '0');
  } catch {}
  captureSpannerEvent(enabled ? 'replay_enabled' : 'replay_disabled');
  void posthogClient().then((posthog) => {
    if (!posthog) return;
    if (enabled) posthog.startSessionRecording?.({ linked_flag: true, sampling: true });
    else posthog.stopSessionRecording?.();
  });
}
