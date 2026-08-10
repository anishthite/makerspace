import test from 'node:test';
import assert from 'node:assert/strict';

import {
  artifactMediaOpenUISource,
  diagramImageArtifactPaths,
  excalidrawArtifactPaths,
  htmlArtifactPaths,
  htmlImageArtifactPaths,
  isRenderableHtmlArtifactPath,
  normalizeDiagramImageArtifactPath,
  normalizeExcalidrawArtifactPath,
} from '../frontend/src/runtime/excalidraw-artifacts.js';

test('excalidrawArtifactPaths finds unique safe relative drawings', () => {
  assert.deepEqual(
    excalidrawArtifactPaths('Created `diagrams/flow.excalidraw` and ./flow.excalidraw. diagrams/flow.excalidraw'),
    ['diagrams/flow.excalidraw', 'flow.excalidraw'],
  );
});

test('normalizeExcalidrawArtifactPath rejects traversal, URLs, and globs', () => {
  assert.equal(normalizeExcalidrawArtifactPath('../secret.excalidraw'), '');
  assert.equal(normalizeExcalidrawArtifactPath('/tmp/secret.excalidraw'), '');
  assert.equal(normalizeExcalidrawArtifactPath('https://example.com/a.excalidraw'), '');
  assert.equal(normalizeExcalidrawArtifactPath('*.excalidraw'), '');
  assert.equal(normalizeExcalidrawArtifactPath('diagrams/flow?.excalidraw'), '');
  assert.equal(normalizeExcalidrawArtifactPath('notes.txt'), '');
});

test('excalidrawArtifactPaths ignores fake or non-viewer references', () => {
  assert.deepEqual(
    excalidrawArtifactPaths('Because I mentioned fake example paths:\n```\nauth-flow.excalidraw\nremote-runtime.excalidraw\n```'),
    [],
  );
  assert.deepEqual(
    excalidrawArtifactPaths('Do not push: `codex-sign-in-flow.excalidraw`; it is an unrelated untracked artifact.'),
    [],
  );
  assert.deepEqual(
    excalidrawArtifactPaths('Created `codex-sign-in-flow.excalidraw` and rendered it inline.'),
    ['codex-sign-in-flow.excalidraw'],
  );
});

test('diagramImageArtifactPaths finds rendered diagram images with intent', () => {
  assert.deepEqual(
    diagramImageArtifactPaths('Inline chart: ![Infra options decision chart](infra-options-decision.png)\nFiles: `infra-options-decision.excalidraw` `infra-options-decision.png`'),
    ['infra-options-decision.png'],
  );
  assert.deepEqual(
    diagramImageArtifactPaths('<img src="workspace-save-lifecycle.png" alt="Persistent workspace save lifecycle diagram" />'),
    ['workspace-save-lifecycle.png'],
  );
  assert.deepEqual(
    diagramImageArtifactPaths('Saved rendered screenshot at `output/playwright/project-selector-layout.png`.'),
    ['output/playwright/project-selector-layout.png'],
  );
  assert.deepEqual(
    diagramImageArtifactPaths('```openui\nroot = TextContent("artifacts/flow.svg artifacts/flow.png artifacts/flow.webp artifacts/flow.gif artifacts/flow.jpg")\n```'),
    ['artifacts/flow.svg', 'artifacts/flow.png', 'artifacts/flow.webp', 'artifacts/flow.gif', 'artifacts/flow.jpg'],
  );
  assert.deepEqual(
    diagramImageArtifactPaths('```openui\nroot = TextContent("output/playwright/thread-preview.png")\n```'),
    ['output/playwright/thread-preview.png'],
  );
  assert.equal(normalizeDiagramImageArtifactPath('./output/playwright/demo.png'), 'output/playwright/demo.png');
});

test('diagramImageArtifactPaths ignores generic static asset mentions', () => {
  assert.deepEqual(diagramImageArtifactPaths('Added `public/logo.svg` and `public/favicon.svg`.'), []);
  assert.deepEqual(diagramImageArtifactPaths('```openui\nroot = TextContent("frontend/public/logo.svg")\n```'), []);
  assert.deepEqual(diagramImageArtifactPaths('Do not push `codex-sign-in-flow.png`; it is unrelated.'), []);
  assert.equal(normalizeDiagramImageArtifactPath('../secret.png'), '');
  assert.equal(normalizeDiagramImageArtifactPath('https://example.com/a.png'), '');
  assert.equal(normalizeDiagramImageArtifactPath('public/logos/*.svg'), '');
});

test('htmlImageArtifactPaths finds embedded relative image sources for duplicate suppression', () => {
  assert.deepEqual(
    htmlImageArtifactPaths('<section><img src="output/playwright/demo.png"><img src="https://example.com/demo.png"><img src="../secret.png"><img src="output/playwright/demo.png"></section>'),
    ['output/playwright/demo.png'],
  );
});

test('htmlArtifactPaths includes generated pages and implementation notes', () => {
  assert.deepEqual(
    htmlArtifactPaths('See output/playwright/demo.html and implementation-notes/2026-08-10-typography-standardization.html, not implementation-notes/INDEX.html.'),
    ['output/playwright/demo.html', 'implementation-notes/2026-08-10-typography-standardization.html'],
  );
  assert.equal(isRenderableHtmlArtifactPath('implementation-notes/2026-08-10-demo.html'), true);
  assert.equal(isRenderableHtmlArtifactPath('implementation-notes/INDEX.html'), false);
  assert.equal(isRenderableHtmlArtifactPath('frontend/public/demo.html'), false);
});

test('artifactMediaOpenUISource turns media paths into Spanner OpenUI', () => {
  assert.equal(
    artifactMediaOpenUISource('Rendered diagram artifact: `infra-options-decision.png`; source: `infra-options-decision.excalidraw`.'),
    'root = ArtifactGallery([artifact1])\nartifact1 = ArtifactImage("infra-options-decision.png", "infra-options-decision.excalidraw")',
  );
  assert.equal(
    artifactMediaOpenUISource('```openui\nroot = TextContent("artifacts/mockup.svg")\n```'),
    'root = ArtifactGallery([artifact1])\nartifact1 = ArtifactImage("artifacts/mockup.svg")',
  );
  assert.equal(
    artifactMediaOpenUISource('Created `flow.excalidraw` and rendered it inline.'),
    'root = ArtifactGallery([artifact1])\nartifact1 = ExcalidrawArtifact("flow.excalidraw")',
  );
});
