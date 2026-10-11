const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('todoReminder', {
  getItems: () => ipcRenderer.invoke('todo-reminder:get'),
  dismiss: () => ipcRenderer.invoke('todo-reminder:dismiss'),
  onItems: callback => {
    const listener = (_event, items) => callback(items);
    ipcRenderer.on('todo-reminder:items', listener);
    return () => ipcRenderer.removeListener('todo-reminder:items', listener);
  },
});
