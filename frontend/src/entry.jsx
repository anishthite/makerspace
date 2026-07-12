import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { pages } from './pages.jsx';
import { Toaster } from '#components/ui/sonner';
import { applyAppearance } from './runtime/appearance.js';
import { startAgentToastWatcher } from './runtime/agent-toasts.js';
import './styles/fluid-ui.css';

const HOMEPAGE_PATH = '/homepage';
const API_BASE = String(import.meta.env?.VITE_SPANNER_API_BASE || '').trim().replace(/\/+$/, '');

const runtimeLoaders = {
  project: () => import('./runtime/project.js'),
  workspace: () => import('./runtime/app.js'),
  thread: () => import('./runtime/thread.js'),
  settings: () => import('./runtime/settings.js'),
  history: () => import('./runtime/history.js'),
  performance: () => import('./runtime/performance.js'),
};

function homepageRedirectUrl() {
  const returnTo = location.href;
  return `${HOMEPAGE_PATH}?${new URLSearchParams({ returnTo })}`;
}

async function redirectUnsignedHostedUsers() {
  try {
    const response = await fetch(`${API_BASE}/api/me`, { credentials: 'include', cache: 'no-store' });
    const me = await response.json();
    if (me.authRequired && !me.authenticated && me.githubConfigured) location.replace(homepageRedirectUrl());
  } catch {}
}

function App({ page }) {
  const Page = pages[page] || pages.project;

  useEffect(() => {
    const loadRuntime = runtimeLoaders[page];
    if (!loadRuntime) return undefined;
    let cancelled = false;
    loadRuntime().catch((error) => {
      if (!cancelled) console.error(`Could not load ${page} behavior.`, error);
    });
    return () => {
      cancelled = true;
    };
  }, [page]);

  return (
    <>
      <Page />
      <Toaster
        theme="dark"
        position="bottom-right"
        richColors
        closeButton
        offset={{ right: '18px', bottom: 'var(--thread-composer-clearance,18px)' }}
      />
    </>
  );
}

applyAppearance();
void redirectUnsignedHostedUsers();

const root = document.querySelector('#root');
const page = document.body?.dataset?.reactPage || 'project';
if (page !== 'workspace') startAgentToastWatcher();
const reactRoot = root.__spannerRoot || createRoot(root);
root.__spannerRoot = reactRoot;

reactRoot.render(<App page={page} />);
