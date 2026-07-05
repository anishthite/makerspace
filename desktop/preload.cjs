const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workbenchDesktop', {
  checkForUpdates: () => ipcRenderer.invoke('workbench:check-for-updates'),
  chooseFolder: (folder) => ipcRenderer.invoke('workbench:choose-folder', folder),
  getLastFolder: () => ipcRenderer.invoke('workbench:get-last-folder'),
  rememberFolder: (folder) => ipcRenderer.invoke('workbench:remember-folder', folder),
  onUpdateStatus: (callback) => {
    const handler = (_event, info) => callback(info || {});
    ipcRenderer.on('workbench:update-status', handler);
    return () => ipcRenderer.removeListener('workbench:update-status', handler);
  },
});
