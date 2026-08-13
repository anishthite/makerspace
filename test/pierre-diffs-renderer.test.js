import test from 'node:test';
import assert from 'node:assert/strict';

import { processPatch } from '@pierre/diffs';

test('pierre parses unified patches without treating diff text as markup', () => {
  const patch = 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-<img src=x onerror=alert(1)>\n+ok\n';
  const file = processPatch(patch, undefined, true).files[0];

  assert.equal(file.name, 'x.js');
  assert.equal(file.hunks.length, 1);
  assert.equal(file.deletionLines[0], '<img src=x onerror=alert(1)>\n');
});
