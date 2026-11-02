const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mysyncAPI', {
  platform: process.platform,
  selectFolder: (defaultPath) => ipcRenderer.invoke('dialog:selectFolder', defaultPath),
  loadProfiles: () => ipcRenderer.invoke('profiles:load'),
  saveProfiles: (data) => ipcRenderer.invoke('profiles:save', data),
  analyzeFolders: (params) => ipcRenderer.invoke('sync:analyze', params),
  executeSync: (params) => ipcRenderer.invoke('sync:execute', params),
  cancelSync: () => ipcRenderer.invoke('sync:cancel'),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('shell:showItemInFolder', targetPath),
  trashItem: (targetPath) => ipcRenderer.invoke('shell:trashItem', targetPath),
  readFilePreview: (params) => ipcRenderer.invoke('file:readPreview', params),
  onSyncProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('sync:progress', listener);
    return () => ipcRenderer.removeListener('sync:progress', listener);
  },
});
