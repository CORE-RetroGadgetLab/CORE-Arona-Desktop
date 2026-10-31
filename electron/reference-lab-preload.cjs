'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Isolated bridge: never grants file paths, fs, shell, or general IPC access.
contextBridge.exposeInMainWorld('frameReferences', Object.freeze({
  begin: source => ipcRenderer.invoke('reference-lab:begin',source),
  save: (id,name,png) => ipcRenderer.invoke('reference-lab:save',id,name,png),
  finish: (id,metadata) => ipcRenderer.invoke('reference-lab:finish',id,metadata),
  abort: id => ipcRenderer.invoke('reference-lab:abort',id),
  openComparison: () => ipcRenderer.invoke('reference-lab:open-comparison')
}));