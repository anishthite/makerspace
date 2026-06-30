import test from 'node:test';
import assert from 'node:assert/strict';

import { excalidrawArtifactPaths, normalizeExcalidrawArtifactPath } from '../frontend/src/runtime/excalidraw-artifacts.js';

test('excalidrawArtifactPaths finds unique safe relative drawings', () => {
  assert.deepEqual(
    excalidrawArtifactPaths('Created `diagrams/flow.excalidraw` and ./flow.excalidraw. diagrams/flow.excalidraw'),
    ['diagrams/flow.excalidraw', 'flow.excalidraw'],
  );
});

test('normalizeExcalidrawArtifactPath rejects traversal and URLs', () => {
  assert.equal(normalizeExcalidrawArtifactPath('../secret.excalidraw'), '');
  assert.equal(normalizeExcalidrawArtifactPath('/tmp/secret.excalidraw'), '');
  assert.equal(normalizeExcalidrawArtifactPath('https://example.com/a.excalidraw'), '');
  assert.equal(normalizeExcalidrawArtifactPath('notes.txt'), '');
});
