import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { pages } from './pages.jsx';
import { applyAppearance } from './runtime/appearance.js';
import { startAgentToastWatcher } from './runtime/agent-toasts.js';
import './styles/fluid-ui.css';

const runtimeLoaders = {
  project: () => import('./runtime/project.js'),
  workspace: () => import('./runtime/app.js'),
  thread: () => import('./runtime/thread.js'),
  settings: () => import('./runtime/settings.js'),
  history: () => import('./runtime/history.js'),
  performance: () => import('./runtime/performance.js'),
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

  return <Page />;
}

applyAppearance();

const root = document.querySelector('#root');
const page = document.body?.dataset?.reactPage || 'project';
if (page !== 'workspace') startAgentToastWatcher();
const reactRoot = root.__workbenchRoot || createRoot(root);
root.__workbenchRoot = reactRoot;

reactRoot.render(<App page={page} />);
