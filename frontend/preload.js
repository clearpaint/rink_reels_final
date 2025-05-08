const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkServerReady: () => ipcRenderer.invoke('check-server-ready'),
  checkFileExists: (path) => ipcRenderer.invoke('check-file-exists', path),
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
  getFilePath: (fileObject) => ipcRenderer.invoke('get-file-path', fileObject),
  openDirectoryDialog: (options) => ipcRenderer.invoke('open-directory-dialog', options),
  deleteFile: (path) => ipcRenderer.invoke('delete-file', path),
  openFilesDialog: (opts) => ipcRenderer.invoke('open-files-dialog', opts),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
});