import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Renderer } from '@openuidev/react-lang';
import { openuiChatLibrary } from '@openuidev/react-ui/genui-lib';
import '@openuidev/react-ui/components.css';

import { openSafeLink } from './link-rendering.js';
import { extractOpenUIArtifacts, openUIActionPrompt } from './openui-artifacts.js';

function unmountOpenUIRoots(node) {
  node.querySelectorAll('[data-openui-root]').forEach((host) => {
    host.__spannerOpenUIRoot?.unmount?.();
    delete host.__spannerOpenUIRoot;
  });
}

function OpenUIArtifact({ source, onAction }) {
  const [errors, setErrors] = useState([]);
  return (
    <div className="openui-artifact-rendered">
      <Renderer
        response={source}
        library={openuiChatLibrary}
        isStreaming={false}
        toolProvider={null}
        onAction={(event) => {
          if (event?.type === 'open_url') {
            void openSafeLink(event.params?.url);
            return;
          }
          const prompt = openUIActionPrompt(event);
          if (prompt) onAction?.({ prompt, delivery: 'followUp' });
        }}
        onError={(nextErrors) => setErrors(Array.isArray(nextErrors) ? nextErrors : [])}
      />
      {errors.length ? <p className="openui-artifact-error">OpenUI issue: {errors[0].message}</p> : null}
    </div>
  );
}

export function renderOpenUIArtifacts(node, rawText, onAction) {
  unmountOpenUIRoots(node);
  node.querySelector('.openui-artifacts')?.remove();

  const artifacts = extractOpenUIArtifacts(rawText);
  if (!artifacts.length) return;

  const section = document.createElement('section');
  section.className = 'openui-artifacts';
  section.setAttribute('aria-label', 'OpenUI assistant components');

  artifacts.forEach(({ source }, index) => {
    const card = document.createElement('article');
    card.className = 'openui-artifact-card';

    const host = document.createElement('div');
    host.className = 'openui-artifact-host';
    host.dataset.openuiRoot = String(index + 1);

    card.append(host);
    section.append(card);

    const root = createRoot(host);
    host.__spannerOpenUIRoot = root;
    root.render(<OpenUIArtifact source={source} onAction={onAction} />);
  });

  node.append(section);
}
