const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('makerspaceDesktop', {
  chooseFolder: (folder) => ipcRenderer.invoke('makerspace:choose-folder', folder),
  getLastFolder: () => ipcRenderer.invoke('makerspace:get-last-folder'),
  rememberFolder: (folder) => ipcRenderer.invoke('makerspace:remember-folder', folder),
});
