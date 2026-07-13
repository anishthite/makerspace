import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { Toaster } from './components/ui/sonner.jsx';
import { pages } from './pages.jsx';
import { applyAppearance } from './runtime/appearance.js';
import { startAgentToastWatcher } from './runtime/agent-toasts.js';
import './styles/app.css';
import './styles/fluid-ui.css';

const HOMEPAGE_PATH = '/homepage';
const MAIN_PAGE_PATH = '/workspace.html';
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
        position="top-right"
        richColors
        closeButton
        duration={8000}
        offset={{ top: 18, right: 18 }}
        mobileOffset={{ top: 16, left: 16, right: 16 }}
      />
    </>
  );
}

function openMainPageFromToast(event) {
  const target = event.target;
  const toastNode = target?.closest?.('[data-sonner-toast].agent-main-link-toast');
  if (!toastNode || target.closest?.('button,a')) return;
  location.assign(MAIN_PAGE_PATH);
}

function openMainPageFromToastKey(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target;
  const toastNode = target?.closest?.('[data-sonner-toast].agent-main-link-toast');
  if (!toastNode || target.closest?.('button,a')) return;
  event.preventDefault();
  location.assign(MAIN_PAGE_PATH);
}

applyAppearance();
void redirectUnsignedHostedUsers();
document.addEventListener('click', openMainPageFromToast);
document.addEventListener('keydown', openMainPageFromToastKey);

const root = document.querySelector('#root');
const page = document.body?.dataset?.reactPage || 'project';
if (page !== 'workspace') startAgentToastWatcher();
const reactRoot = root.__spannerRoot || createRoot(root);
root.__spannerRoot = reactRoot;

reactRoot.render(<App page={page} />);
