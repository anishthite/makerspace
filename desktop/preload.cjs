const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('makerspaceDesktop', {
  checkForUpdates: () => ipcRenderer.invoke('makerspace:check-for-updates'),
  chooseFolder: (folder) => ipcRenderer.invoke('makerspace:choose-folder', folder),
  getLastFolder: () => ipcRenderer.invoke('makerspace:get-last-folder'),
  rememberFolder: (folder) => ipcRenderer.invoke('makerspace:remember-folder', folder),
  onUpdateStatus: (callback) => {
    const handler = (_event, info) => callback(info || {});
    ipcRenderer.on('makerspace:update-status', handler);
    return () => ipcRenderer.removeListener('makerspace:update-status', handler);
  },
});
