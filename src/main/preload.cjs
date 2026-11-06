// Bridge between the game pages and the desktop app. Present only inside the Electron app;
// players joining from a plain browser simply don't get these extras.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  listSaves: () => ipcRenderer.invoke('saves:list'),
  host: (opts) => ipcRenderer.invoke('host:start', opts),
  openHost: (info) => ipcRenderer.invoke('host:open', info),
  join: (url) => ipcRenderer.invoke('join:open', url),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  backToLauncher: () => ipcRenderer.invoke('app:launcher'),
});
