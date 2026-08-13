const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spannerDesktop', {
  checkForUpdates: () => ipcRenderer.invoke('spanner:check-for-updates'),
  chooseFolder: (folder) => ipcRenderer.invoke('spanner:choose-folder', folder),
  getLastFolder: () => ipcRenderer.invoke('spanner:get-last-folder'),
  rememberFolder: (folder) => ipcRenderer.invoke('spanner:remember-folder', folder),
  openExternal: (url) => ipcRenderer.invoke('spanner:open-external', url),
  onNewThreadShortcut: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('spanner:new-thread-shortcut', handler);
    return () => ipcRenderer.removeListener('spanner:new-thread-shortcut', handler);
  },
  onUpdateStatus: (callback) => {
    const handler = (_event, info) => callback(info || {});
    ipcRenderer.on('spanner:update-status', handler);
    return () => ipcRenderer.removeListener('spanner:update-status', handler);
  },
});
