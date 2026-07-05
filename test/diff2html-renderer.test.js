import test from 'node:test';
import assert from 'node:assert/strict';

import * as Diff2Html from 'diff2html';

test('diff2html escapes malicious diff lines', () => {
  const html = Diff2Html.html('diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-<img src=x onerror=alert(1)>\n+ok\n', {
    drawFileList: true,
    matching: 'lines',
    outputFormat: 'side-by-side',
  });
  assert.doesNotMatch(html, /<img src=x/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
