import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, autoUpdater, BrowserWindow, dialog, ipcMain } from 'electron';

import { cleanFolder, readLastFolder, writeLastFolder } from './last-folder.js';

const require = createRequire(import.meta.url);
const { updateElectronApp, UpdateSourceType } = require('update-electron-app');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
let serverProcess = null;
let mainWindow = null;
let pendingUpdate = null;

function publicUpdateInfo(info = {}) {
  return {
    releaseName: String(info.releaseName || ''),
    releaseDate: String(info.releaseDate || ''),
    updateURL: String(info.updateURL || ''),
  };
}

function sendPendingUpdate(window = mainWindow) {
  if (!pendingUpdate || !window || window.isDestroyed()) return;
  window.webContents.send('makerspace:update-downloaded', pendingUpdate);
}

function sendUpdateStatus(message, level = 'info') {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window || window.isDestroyed()) return;
    window.webContents.send('makerspace:update-status', { message, level });
  });
}

function announceUpdateDownloaded(info) {
  pendingUpdate = publicUpdateInfo(info);
  BrowserWindow.getAllWindows().forEach(sendPendingUpdate);
  sendUpdateStatus('Update ready. Restart to install.', 'success');
}

function slugify(value) {
  return String(value || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function initialFolderArg() {
  return cleanFolder(process.argv.slice(app.isPackaged ? 1 : 2).find((arg) => arg && !arg.startsWith('-')));
}

const initialFolder = initialFolderArg();

function projectName() {
  const explicit = cleanFolder(process.env.MAKERSPACE_PROJECT);
  if (explicit) return explicit;
  const normalized = initialFolder.replace(/[\\/]+$/, '');
  return path.basename(normalized) || '';
}

function projectHomeDir() {
  if (process.env.MAKERSPACE_HOME) return process.env.MAKERSPACE_HOME;
  const name = projectName();
  // ponytail: same-name folders share state; set MAKERSPACE_HOME to split duplicates.
  return name ? path.join(userDataDir(), 'projects', slugify(name)) : '';
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Local backend did not start.');
}

function backendCommand() {
  if (process.env.MAKERSPACE_NODE) return { command: process.env.MAKERSPACE_NODE, args: ['src/server.js'], env: {} };
  if (app.isPackaged) return { command: process.execPath, args: ['src/server.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  return { command: 'node', args: ['src/server.js'], env: {} };
}

async function startBackend() {
  const port = await getFreePort();
  const token = randomBytes(24).toString('hex');
  const name = projectName();
  const homeDir = projectHomeDir();
  const backend = backendCommand();
  serverProcess = spawn(backend.command, backend.args, {
    cwd: rootDir,
    env: {
      ...process.env,
      ...backend.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      CONTROL_API_TOKEN: token,
      INFRA_PROVIDER: 'local',
      ...(name ? { MAKERSPACE_PROJECT: name } : {}),
      ...(homeDir ? { MAKERSPACE_HOME: homeDir } : {}),
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });

  serverProcess.on('exit', () => {
    serverProcess = null;
    if (!app.isQuitting) app.quit();
  });

  await waitForServer(port);
  return { port, token };
}

function createWindow(port, token) {
  const name = projectName();
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 840,
    title: name ? `Makerspace · ${name}` : 'Makerspace',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: [`http://127.0.0.1:${port}/api/*`] },
    (details, callback) => callback({ requestHeaders: { ...details.requestHeaders, 'x-api-token': token } }),
  );
  mainWindow.webContents.on('did-finish-load', () => sendPendingUpdate(mainWindow));
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

function userDataDir() {
  return app.getPath('userData');
}

ipcMain.handle('makerspace:get-last-folder', () => initialFolder || readLastFolder(userDataDir()));

ipcMain.handle('makerspace:remember-folder', (_event, folder) => writeLastFolder(userDataDir(), folder));

ipcMain.handle('makerspace:get-pending-update', () => pendingUpdate);

ipcMain.handle('makerspace:choose-folder', async (_event, folder) => {
  const defaultPath = cleanFolder(folder) || initialFolder || readLastFolder(userDataDir());
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    ...(defaultPath ? { defaultPath } : {}),
  });
  const selected = result.canceled ? '' : result.filePaths[0] || '';
  if (selected) writeLastFolder(userDataDir(), selected);
  return selected;
});

ipcMain.handle('makerspace:restart-to-update', () => {
  autoUpdater.quitAndInstall();
  return true;
});

ipcMain.handle('makerspace:check-for-updates', () => {
  if (!app.isPackaged) return { ok: false, message: 'Update checks work in the packaged app.' };
  if (!['darwin', 'win32'].includes(process.platform)) return { ok: false, message: 'Electron updates are macOS/Windows only.' };
  try {
    autoUpdater.checkForUpdates();
    return { ok: true, message: 'Checking for updates…' };
  } catch (error) {
    const message = error?.message || 'Could not check for updates.';
    sendUpdateStatus(message, 'error');
    return { ok: false, message };
  }
});

if (app.isPackaged) {
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('Checking for updates…'));
  autoUpdater.on('update-available', () => sendUpdateStatus('Update found. Downloading…'));
  autoUpdater.on('update-not-available', () => sendUpdateStatus('You are up to date.', 'success'));
  autoUpdater.on('error', (error) => sendUpdateStatus(error?.message || 'Update check failed.', 'error'));
  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: 'anishthite/makerspace-downloads',
    },
    onNotifyUser: announceUpdateDownloaded,
  });
}

app.whenReady().then(async () => {
  const { port, token } = await startBackend();
  createWindow(port, token);
});

app.on('before-quit', () => {
  app.isQuitting = true;
  serverProcess?.kill();
});

app.on('window-all-closed', () => {
  app.quit();
});
