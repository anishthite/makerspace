import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = new URL('..', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const manifest = JSON.parse(read('frontend/route-manifest.json'));
const reactFiles = ['index.html', 'workspace.html', 'thread.html', 'settings.html', 'history.html', 'telemetry.html', 'local-telemetry.html', 'desktop.html'];

function walk(dir) {
  const fullDir = new URL(dir, root);
  return readdirSync(fullDir, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(dir, entry.name);
    return entry.isDirectory() ? walk(`${rel}/`) : rel;
  }).sort();
}

test('frontend is the Vite source of truth', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.scripts.build, 'vite build');
  assert.equal(packageJson.scripts['frontend:sync'], undefined);
  assert.match(read('vite.config.js'), /root: frontendRoot/);
  assert.match(read('vite.config.js'), /publicDir: resolve\(frontendRoot, 'public'\)/);
  assert.equal(existsSync(new URL('scripts/sync-react-legacy.js', root)), false);
  assert.equal(existsSync(new URL('frontend/src/generated/page-html.js', root)), false);
  assert.equal(existsSync(new URL('public', root)), false);
});

test('React core routes are explicit Vite MPA entries', () => {
  for (const file of reactFiles) {
    assert.ok(existsSync(new URL(`frontend/${file}`, root)), file);
    assert.ok(manifest.routes.some((route) => route.file === file && route.mode === 'react'), file);
  }
  assert.ok(manifest.routes.some((route) => route.route === '/' && route.file === 'index.html'));
  assert.match(read('vite.config.js'), /index\.html[\s\S]+workspace\.html[\s\S]+thread\.html[\s\S]+settings\.html/);
});

test('static public pages stay in frontend/public for Vite copy', () => {
  const publicHtml = walk('frontend/public/').filter((file) => file.endsWith('.html')).map((file) => file.replace(/^frontend\/public\//, '')).sort();
  const copiedManifestFiles = manifest.routes.filter((route) => route.mode === 'copy').map((route) => route.file).sort();
  assert.deepEqual(copiedManifestFiles, publicHtml);
  assert.ok(publicHtml.includes('better-designs.html'));
  assert.ok(publicHtml.includes('thread-message-variations/index.html'));
  assert.ok(existsSync(new URL('frontend/public/styles.css', root)));
});

test('active storage keys and deploy aliases are listed', () => {
  for (const key of ['spannerBrowserSession', 'spannerSelectedProject', 'spannerModelRef', 'spannerThinkingLevel', 'spannerSeenFinishedThreads', 'spannerRecentProjects']) {
    assert.ok(manifest.storageKeys.includes(key), key);
  }

  assert.ok(manifest.aliases.some((alias) => alias.route === '/homepage' && alias.target === '/desktop.html'));
  assert.ok(manifest.aliases.some((alias) => alias.route === '/desktop' && alias.target === '/desktop.html'));
  assert.ok(manifest.aliases.some((alias) => alias.route === '/thread' && alias.target === '/thread.html'));
  assert.ok(manifest.aliases.some((alias) => alias.route === '/telemetry' && alias.target === '/telemetry.html'));
  assert.ok(manifest.aliases.some((alias) => alias.route === '/local-telemetry' && alias.target === '/local-telemetry.html'));
  assert.match(read('src/server.js'), /const publicDir = process\.env\.SPANNER_STATIC_DIR \|\| distDir;/);
  assert.match(read('src/server/http.js'), /\['\/homepage', 'desktop\.html'\]/);
  assert.doesNotMatch(read('src/server.js'), /rootDir, 'public'/);
});
