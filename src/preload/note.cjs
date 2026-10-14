const { contextBridge, ipcRenderer } = require('electron');
function listen(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('noteEditor', {
  get: () => ipcRenderer.invoke('note:get'),
  update: input => ipcRenderer.invoke('note:update', input),
  save: (input, token) => ipcRenderer.invoke('note:save', input, token),
  close: input => ipcRenderer.invoke('note:close', input),
  delete: () => ipcRenderer.invoke('note:delete'),
  onSaveRequest: callback => listen('note:request-save', callback),
  onLock: callback => listen('note:lock', callback),
  onError: callback => listen('note:error', callback),
  onSaved: callback => listen('note:saved', callback),
});
