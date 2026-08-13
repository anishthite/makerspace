import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, autoUpdater, BrowserWindow, dialog, ipcMain, shell } from 'electron';

import { cleanFolder, readLastFolder, writeLastFolder } from './last-folder.js';

const require = createRequire(import.meta.url);
const { updateElectronApp, UpdateSourceType } = require('update-electron-app');

app.setName('Spanner');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
let serverProcess = null;
let mainWindow = null;
let userDataMigrated = false;
let updateStatus = { message: app.isPackaged ? 'Checking for updates on launch…' : 'Update checks run in the packaged app.' };
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);
const LOCAL_BACKEND_HOST = 'localhost';
const LOCAL_BACKEND_PORT = 8788;
const NEW_THREAD_SHORTCUT_CHANNEL = 'spanner:new-thread-shortcut';

function sendUpdateStatus(message) {
  updateStatus = { message };
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window || window.isDestroyed()) return;
    window.webContents.send('spanner:update-status', { message });
  });
}

function announceUpdateDownloaded() {
  sendUpdateStatus('Update downloaded. It will install the next time Spanner starts.');
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

function folderName(value) {
  const text = cleanFolder(value).replace(/[\\/]+$/, '');
  return text.split(/[\\/]+/).filter(Boolean).pop() || '';
}

function projectName() {
  return folderName(process.env.SPANNER_PROJECT) || folderName(initialFolder);
}

function projectHomeDir() {
  if (process.env.SPANNER_HOME) return process.env.SPANNER_HOME;
  const name = projectName();
  // ponytail: same-name folders share state; set SPANNER_HOME to split duplicates.
  return name ? path.join(userDataDir(), 'projects', slugify(name)) : '';
}

function assertLocalBackendPortAvailable() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        reject(new Error(`Local backend port ${LOCAL_BACKEND_HOST}:${LOCAL_BACKEND_PORT} is already in use.`));
        return;
      }
      reject(error);
    });
    server.listen(LOCAL_BACKEND_PORT, LOCAL_BACKEND_HOST, () => {
      server.close(() => resolve());
    });
  });
}

async function waitForServer(port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    try {
      const response = await fetch(localBackendUrl(port, '/healthz'));
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Local backend did not start.');
}

function localBackendUrl(port, pathname = '') {
  return `http://${LOCAL_BACKEND_HOST}:${port}${pathname}`;
}

function isNewThreadShortcutInput(input) {
  return input?.type === 'keyDown'
    && !input.isAutoRepeat
    && String(input.key || '').toLowerCase() === 't'
    && (input.meta || input.control)
    && !input.alt
    && !input.shift;
}

function sendNewThreadShortcut(window) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(NEW_THREAD_SHORTCUT_CHANNEL);
}

function backendCommand() {
  if (process.env.SPANNER_NODE) return { command: process.env.SPANNER_NODE, args: ['src/server.js'], env: {} };
  if (app.isPackaged) return { command: process.execPath, args: ['src/server.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  return { command: 'node', args: ['src/server.js'], env: {} };
}

async function startBackend() {
  await assertLocalBackendPortAvailable();
  const port = LOCAL_BACKEND_PORT;
  const token = randomBytes(24).toString('hex');
  const name = projectName();
  const homeDir = projectHomeDir();
  const backend = backendCommand();
  serverProcess = spawn(backend.command, backend.args, {
    cwd: rootDir,
    env: {
      ...process.env,
      ...backend.env,
      HOST: LOCAL_BACKEND_HOST,
      PORT: String(port),
      CONTROL_API_TOKEN: token,
      INFRA_PROVIDER: 'local',
      ...(name ? { SPANNER_PROJECT: name } : {}),
      ...(homeDir ? { SPANNER_HOME: homeDir } : {}),
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
    title: name ? `Spanner · ${name}` : 'Spanner',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: [localBackendUrl(port, '/api/*')] },
    (details, callback) => callback({ requestHeaders: { ...details.requestHeaders, 'x-api-token': token } }),
  );
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!isNewThreadShortcutInput(input)) return;
    event.preventDefault();
    sendNewThreadShortcut(mainWindow);
  });
  mainWindow.loadURL(localBackendUrl(port, '/'));
}

function moveLegacyDir(legacyDir, nextDir) {
  if (!legacyDir || !nextDir || legacyDir === nextDir || existsSync(nextDir) || !existsSync(legacyDir)) return;
  try {
    renameSync(legacyDir, nextDir);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    cpSync(legacyDir, nextDir, { recursive: true, errorOnExist: false });
    rmSync(legacyDir, { recursive: true, force: true });
  }
}

function migrateUserDataDir() {
  if (userDataMigrated) return;
  userDataMigrated = true;
  // ponytail: one-time desktop rename; old Workbench.app state becomes Spanner.app state.
  moveLegacyDir(path.join(app.getPath('appData'), 'Workbench'), app.getPath('userData'));
}

function userDataDir() {
  migrateUserDataDir();
  return app.getPath('userData');
}

ipcMain.handle('spanner:get-last-folder', () => initialFolder || readLastFolder(userDataDir()));

ipcMain.handle('spanner:remember-folder', (_event, folder) => writeLastFolder(userDataDir(), folder));

ipcMain.handle('spanner:choose-folder', async (_event, folder) => {
  const defaultPath = cleanFolder(folder) || initialFolder || readLastFolder(userDataDir());
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    ...(defaultPath ? { defaultPath } : {}),
  });
  const selected = result.canceled ? '' : result.filePaths[0] || '';
  if (selected) writeLastFolder(userDataDir(), selected);
  return selected;
});

async function openExternalUrl(url) {
  const target = new URL(String(url || ''));
  if (!EXTERNAL_PROTOCOLS.has(target.protocol)) throw new Error('Only safe external URLs can be opened.');
  await shell.openExternal(target.href);
}

ipcMain.handle('spanner:open-external', (_event, url) => openExternalUrl(url));

ipcMain.handle('spanner:get-update-status', () => updateStatus);

ipcMain.handle('spanner:check-for-updates', () => {
  if (!app.isPackaged) return { ok: false, message: 'Update checks work in the packaged app.' };
  if (!['darwin', 'win32'].includes(process.platform)) return { ok: false, message: 'Electron updates are macOS/Windows only.' };
  try {
    autoUpdater.checkForUpdates();
    return { ok: true, message: 'Checking for updates…' };
  } catch (error) {
    const message = error?.message || 'Could not check for updates.';
    sendUpdateStatus(message);
    return { ok: false, message };
  }
});

if (app.isPackaged) {
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('Checking for updates…'));
  autoUpdater.on('update-available', () => sendUpdateStatus('Update found. Downloading…'));
  autoUpdater.on('update-not-available', () => sendUpdateStatus('You are up to date.'));
  autoUpdater.on('update-downloaded', announceUpdateDownloaded);
  autoUpdater.on('error', (error) => sendUpdateStatus(error?.message || 'Update check failed.'));
  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: 'anishthite/makerspace-downloads',
    },
    notifyUser: false,
  });
}

app.whenReady().then(async () => {
  try {
    const { port, token } = await startBackend();
    createWindow(port, token);
  } catch (error) {
    dialog.showErrorBox('Spanner could not start', error?.message || 'Local backend did not start.');
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  serverProcess?.kill();
});

app.on('window-all-closed', () => {
  app.quit();
});
