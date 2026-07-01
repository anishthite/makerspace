import React, { useEffect, useState } from 'react';
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

const UPDATE_DISMISS_PREFIX = 'makerspaceUpdateDismissed:';

function updateDismissKey(info = {}) {
  return `${UPDATE_DISMISS_PREFIX}${info.releaseName || info.updateURL || info.releaseDate || 'latest'}`;
}

function DesktopUpdateBanner() {
  const [update, setUpdate] = useState(null);

  useEffect(() => {
    const desktop = window.makerspaceDesktop;
    if (!desktop?.onUpdateDownloaded && !desktop?.getPendingUpdate) return undefined;
    const showUpdate = (info) => {
      if (!info || localStorage.getItem(updateDismissKey(info)) === '1') return;
      setUpdate(info || {});
    };
    const unsubscribe = desktop.onUpdateDownloaded?.(showUpdate);
    desktop.getPendingUpdate?.().then(showUpdate).catch(() => {});
    return unsubscribe;
  }, []);

  if (!update) return null;

  const dismiss = () => {
    localStorage.setItem(updateDismissKey(update), '1');
    setUpdate(null);
  };

  return <div className="desktop-update-banner" role="status" aria-live="polite">
    <span>restart to update</span>
    <button type="button" onClick={() => window.makerspaceDesktop?.restartToUpdate?.()}>restart</button>
    <button type="button" onClick={dismiss}>dismiss</button>
  </div>;
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

  return <>
    <DesktopUpdateBanner />
    <Page />
  </>;
}

applyAppearance();

const root = document.querySelector('#root');
const page = document.body?.dataset?.reactPage || 'project';
if (page !== 'workspace') startAgentToastWatcher();
const reactRoot = root.__makerspaceRoot || createRoot(root);
root.__makerspaceRoot = reactRoot;

reactRoot.render(<App page={page} />);
