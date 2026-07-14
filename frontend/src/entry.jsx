import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { Toaster } from './components/ui/sonner.jsx';
import { pages } from './pages.jsx';
import { initSpannerAnalytics } from './lib/posthog.js';
import { applyAppearance } from './runtime/appearance.js';
import { startAgentToastWatcher } from './runtime/agent-toasts.js';
import './styles/app.css';
import './styles/fluid-ui.css';

const MAIN_PAGE_PATH = '/workspace.html';

const runtimeLoaders = {
  project: () => import('./runtime/project.js'),
  workspace: () => import('./runtime/app.js'),
  thread: () => import('./runtime/thread.js'),
  settings: () => import('./runtime/settings.js'),
  history: () => import('./runtime/history.js'),
  performance: () => import('./runtime/performance.js'),
  desktop: () => import('./runtime/desktop.js'),
};

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
const root = document.querySelector('#root');
const page = document.body?.dataset?.reactPage || 'project';
void initSpannerAnalytics({ page });
document.addEventListener('click', openMainPageFromToast);
document.addEventListener('keydown', openMainPageFromToastKey);
if (page !== 'workspace') startAgentToastWatcher();
const reactRoot = root.__spannerRoot || createRoot(root);
root.__spannerRoot = reactRoot;

reactRoot.render(<App page={page} />);
