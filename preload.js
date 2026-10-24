const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mc', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  connectInfo: () => ipcRenderer.invoke('connect:info'),
  setSettings: patch => ipcRenderer.send('settings:set', patch),
  reset: () => ipcRenderer.send('settings:reset'),
  on: (channel, fn) => ipcRenderer.on(channel, (_e, data) => fn(data)),
});
