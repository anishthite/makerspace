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

test('packaged desktop app checks public GitHub releases for updates', () => {
  assert.match(desktopMain, /if \(app\.isPackaged\)/);
  assert.match(desktopMain, /updateElectronApp/);
  assert.match(desktopMain, /UpdateSourceType\.ElectronPublicUpdateService/);
  assert.match(desktopMain, /repo: 'anishthite\/makerspace-downloads'/);
});

test('desktop package build emits the signed app OTA zip', () => {
  assert.match(packageScript, /OTA_ZIP_PATH="\$OUT_DIR\/makerspace-mac-\$ARCH\.zip"/);
  assert.match(packageScript, /ditto -c -k --sequesterRsrc --keepParent "\$APP_DIR" "\$OTA_ZIP_PATH"/);
  assert.match(packageScript, /sign_app\ncreate_ota_zip/);
});

test('desktop package build prunes bundled runtime dependencies', () => {
  assert.match(packageScript, /runtimeDependencies = new Set/);
  assert.match(packageScript, /'@earendil-works\/pi-coding-agent'/);
  assert.match(packageScript, /rm -f "\$APP_RESOURCES\/package-lock\.json"/);
  assert.match(packageScript, /npm prune --omit=dev --ignore-scripts --package-lock=false/);
  assert.match(packageScript, /-name '\*\.map'/);
  assert.match(packageScript, /-name '\*\.d\.ts'/);
});

test('desktop backend exits when Electron parent disconnects', () => {
  assert.match(desktopMain, /stdio: \['ignore', 'inherit', 'inherit', 'ipc'\]/);
  assert.match(serverJs, /process\.on\('disconnect'/);
  assert.match(serverJs, /server\.close\(\(\) => process\.exit\(0\)\)/);
});
