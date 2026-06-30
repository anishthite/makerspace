import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const desktopMain = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');
const serverJs = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const packageScript = readFileSync(new URL('../scripts/package-desktop.sh', import.meta.url), 'utf8');

test('desktop sends local API token as a request header', () => {
  assert.match(desktopMain, /onBeforeSendHeaders/);
  assert.match(desktopMain, /127\.0\.0\.1:\$\{port\}\/api\/\*/);
  assert.match(desktopMain, /'x-api-token': token/);
  assert.doesNotMatch(desktopMain, /loadURL\([^\n]+\?token=/);
});

test('desktop package build keeps frontend on same-origin API', () => {
  assert.match(packageScript, /VITE_MAKERSPACE_API_BASE= npm run build/);
});

test('desktop backend exits when Electron parent disconnects', () => {
  assert.match(desktopMain, /stdio: \['ignore', 'inherit', 'inherit', 'ipc'\]/);
  assert.match(serverJs, /process\.on\('disconnect'/);
  assert.match(serverJs, /server\.close\(\(\) => process\.exit\(0\)\)/);
});
