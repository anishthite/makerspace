const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('makerspaceDesktop', {
  checkForUpdates: () => ipcRenderer.invoke('makerspace:check-for-updates'),
  chooseFolder: (folder) => ipcRenderer.invoke('makerspace:choose-folder', folder),
  getLastFolder: () => ipcRenderer.invoke('makerspace:get-last-folder'),
  getPendingUpdate: () => ipcRenderer.invoke('makerspace:get-pending-update'),
  rememberFolder: (folder) => ipcRenderer.invoke('makerspace:remember-folder', folder),
  restartToUpdate: () => ipcRenderer.invoke('makerspace:restart-to-update'),
  onUpdateDownloaded: (callback) => {
    const handler = (_event, info) => callback(info || {});
    ipcRenderer.on('makerspace:update-downloaded', handler);
    return () => ipcRenderer.removeListener('makerspace:update-downloaded', handler);
  },
  onUpdateStatus: (callback) => {
    const handler = (_event, info) => callback(info || {});
    ipcRenderer.on('makerspace:update-status', handler);
    return () => ipcRenderer.removeListener('makerspace:update-status', handler);
  },
});
