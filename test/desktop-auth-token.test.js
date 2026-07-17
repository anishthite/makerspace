import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const desktopMain = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');
const desktopPreload = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
const frontendEntry = readFileSync(new URL('../frontend/src/entry.jsx', import.meta.url), 'utf8');
const frontendPages = readFileSync(new URL('../frontend/src/pages.jsx', import.meta.url), 'utf8');
const frontendRouteManifest = readFileSync(new URL('../frontend/route-manifest.json', import.meta.url), 'utf8');
const frontendSettings = readFileSync(new URL('../frontend/src/runtime/settings.js', import.meta.url), 'utf8');
const frontendStyles = readFileSync(new URL('../frontend/src/styles/app.css', import.meta.url), 'utf8');
const serverJs = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const packageScript = readFileSync(new URL('../scripts/package-desktop.sh', import.meta.url), 'utf8');

test('desktop sends local API token as a request header', () => {
  assert.match(desktopMain, /onBeforeSendHeaders/);
  assert.match(desktopMain, /127\.0\.0\.1:\$\{port\}\/api\/\*/);
  assert.match(desktopMain, /'x-api-token': token/);
  assert.doesNotMatch(desktopMain, /loadURL\([^\n]+\?token=/);
});

test('desktop package build keeps frontend on same-origin API', () => {
  assert.match(packageScript, /VITE_SPANNER_API_BASE= npm run build/);
  assert.match(packageScript, /node "\$ROOT\/node_modules\/electron\/install\.js"/);
  assert.match(packageScript, /frontend\/public\/logo-mark\.svg/);
  assert.doesNotMatch(packageScript, /desktop src public dist/);
});

test('packaged desktop app checks public GitHub releases for updates', () => {
  assert.match(desktopMain, /if \(app\.isPackaged\)/);
  assert.match(desktopMain, /updateElectronApp/);
  assert.match(desktopMain, /UpdateSourceType\.ElectronPublicUpdateService/);
  assert.match(desktopMain, /repo: 'anishthite\/makerspace-downloads'/);
});

test('downloaded desktop updates apply silently on next launch', () => {
  assert.match(desktopMain, /notifyUser: false/);
  assert.match(desktopMain, /autoUpdater\.on\('update-downloaded', announceUpdateDownloaded\)/);
  assert.match(desktopMain, /install the next time Spanner starts/);
  assert.doesNotMatch(desktopMain, /spanner:update-downloaded/);
  assert.doesNotMatch(desktopMain, /spanner:get-pending-update/);
  assert.doesNotMatch(desktopMain, /spanner:restart-to-update/);
  assert.doesNotMatch(desktopPreload, /onUpdateDownloaded/);
  assert.doesNotMatch(desktopPreload, /getPendingUpdate/);
  assert.doesNotMatch(desktopPreload, /restartToUpdate/);
  assert.doesNotMatch(frontendEntry, /restart to update|spannerUpdateDismissed:/);
  assert.doesNotMatch(frontendRouteManifest, /spannerUpdateDismissed:/);
  assert.doesNotMatch(frontendStyles, /\.desktop-update-banner/);
});

test('settings can manually check desktop updates', () => {
  assert.match(desktopMain, /spanner:check-for-updates/);
  assert.match(desktopMain, /autoUpdater\.checkForUpdates\(\)/);
  assert.match(desktopMain, /spanner:update-status/);
  assert.match(desktopPreload, /checkForUpdates/);
  assert.match(desktopPreload, /onUpdateStatus/);
  assert.match(frontendPages, /id="desktop-updates"/);
  assert.match(frontendPages, /id="desktop-check-updates"/);
  assert.match(frontendSettings, /desktop-check-updates/);
  assert.match(frontendSettings, /checkForUpdates/);
});

test('desktop package build emits the signed app OTA zip', () => {
  assert.match(packageScript, /OTA_ZIP_PATH="\$OUT_DIR\/spanner-mac-\$ARCH\.zip"/);
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
