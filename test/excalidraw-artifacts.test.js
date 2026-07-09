import test from 'node:test';
import assert from 'node:assert/strict';

import {
  artifactMediaOpenUISource,
  diagramImageArtifactPaths,
  excalidrawArtifactPaths,
  htmlImageArtifactPaths,
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
  assert.equal(normalizeDiagramImageArtifactPath('./output/playwright/demo.png'), 'output/playwright/demo.png');
});

test('diagramImageArtifactPaths ignores generic static asset mentions', () => {
  assert.deepEqual(diagramImageArtifactPaths('Added `public/logo.svg` and `public/favicon.svg`.'), []);
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

test('artifactMediaOpenUISource turns media paths into Spanner OpenUI', () => {
  assert.equal(
    artifactMediaOpenUISource('Rendered diagram artifact: `infra-options-decision.png`; source: `infra-options-decision.excalidraw`.'),
    'root = ArtifactGallery([artifact1])\nartifact1 = ArtifactImage("infra-options-decision.png", "infra-options-decision.excalidraw")',
  );
  assert.equal(
    artifactMediaOpenUISource('Created `flow.excalidraw` and rendered it inline.'),
    'root = ArtifactGallery([artifact1])\nartifact1 = ExcalidrawArtifact("flow.excalidraw")',
  );
});
