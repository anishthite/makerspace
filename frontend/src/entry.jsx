import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { Toaster } from './components/ui/sonner.jsx';
import { pages } from './pages.jsx';
import { initSpannerAnalytics } from './lib/posthog.js';
import { applyAppearance } from './runtime/appearance.js';
import { startAgentToastWatcher } from './runtime/agent-toasts.js';

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

function loadStyles(...loaders) {
  return loaders.reduce((ready, loadStyle) => ready.then(loadStyle), Promise.resolve());
}

const appBaseStyles = () => import('./styles/app.css');
const appCompatStyles = () => import('./styles/app-compat.css');
const fluidUiStyles = () => import('./styles/fluid-ui.css');
const workspaceStyles = () => import('./styles/workspace.css');

function loadCoreStyles(...routeStyles) {
  return loadStyles(appBaseStyles, ...routeStyles, appCompatStyles, fluidUiStyles);
}

function loadDemoStyles(routeStyles) {
  return loadStyles(appBaseStyles, appCompatStyles, fluidUiStyles, routeStyles);
}

const routeStyleLoaders = {
  project: () => loadCoreStyles(workspaceStyles),
  workspace: () => loadCoreStyles(workspaceStyles),
  thread: () => loadCoreStyles(workspaceStyles, () => import('./styles/thread.css')),
  traceComponents: () => loadCoreStyles(workspaceStyles, () => import('./styles/thread.css')),
  settings: () => loadCoreStyles(workspaceStyles, () => import('./styles/settings.css')),
  history: () => loadCoreStyles(workspaceStyles, () => import('./styles/history.css')),
  changelog: () => loadCoreStyles(workspaceStyles),
  performance: () => loadCoreStyles(workspaceStyles, () => import('./styles/performance.css')),
  desktop: () => loadCoreStyles(workspaceStyles),
  onboardingEditor: () => loadCoreStyles(workspaceStyles),
  agentElementsDemo: () => loadDemoStyles(() => import('./styles/agent-elements-demo.css')),
  assistantUiComponents: () => loadDemoStyles(() => import('./styles/assistant-ui-components.css')),
};

const sidebarRuntimePages = new Set(['settings', 'history', 'changelog', 'performance']);
const threadPollingRuntimePages = new Set(['project', 'workspace', 'thread', ...sidebarRuntimePages]);

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

  useEffect(() => {
    if (!sidebarRuntimePages.has(page)) return undefined;
    let cancelled = false;
    import('./runtime/global-sidebar.js')
      .then(({ startGlobalSidebar }) => {
        if (!cancelled) startGlobalSidebar();
      })
      .catch((error) => {
        if (!cancelled) console.error('Could not load global sidebar behavior.', error);
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
const routeStylesReady = (routeStyleLoaders[page] || routeStyleLoaders.project)().catch((error) => {
  console.error(`Could not load ${page} route styles.`, error);
});
void initSpannerAnalytics({ page });
document.addEventListener('click', openMainPageFromToast);
document.addEventListener('keydown', openMainPageFromToastKey);
if (!threadPollingRuntimePages.has(page)) startAgentToastWatcher();
const reactRoot = root.__spannerRoot || createRoot(root);
root.__spannerRoot = reactRoot;

routeStylesReady.finally(() => {
  reactRoot.render(<App page={page} />);
});
