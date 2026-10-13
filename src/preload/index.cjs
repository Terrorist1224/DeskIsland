const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskIsland', {
  openDesktopSearch: () => ipcRenderer.invoke('desktop-search:show'),
  listDesktopSearchItems: () => ipcRenderer.invoke('desktop-search:list'),
  resizeDesktopSearch: height => ipcRenderer.invoke('desktop-search:resize', height),
  getDesktopSearchIcon: id => ipcRenderer.invoke('desktop-search:icon', id),
  openDesktopSearchItem: id => ipcRenderer.invoke('desktop-search:open-item', id),
  closeDesktopSearch: () => ipcRenderer.invoke('desktop-search:close'),
  onDesktopSearchCollapsed: callback => {
    const listener = () => callback();ipcRenderer.on('desktop-search:collapsed', listener);
    return () => ipcRenderer.removeListener('desktop-search:collapsed', listener);
  },
  getAudioSnapshot: () => ipcRenderer.invoke('audio:snapshot'),
  setSystemVolume: volume => ipcRenderer.invoke('audio:volume', volume),
  setDefaultAudioDevice: (kind,id) => ipcRenderer.invoke('audio:device',kind,id),
  startAudioRecording: () => ipcRenderer.invoke('audio:start'),
  stopAudioRecording: () => ipcRenderer.invoke('audio:stop'),
  retrySaveAudioRecording: () => ipcRenderer.invoke('audio:retry-save'),
  openAudioRecordingFolder: () => ipcRenderer.invoke('audio:open-folder'),
  onAudioChanged: callback => {
    const listener=(_event,state)=>callback(state);ipcRenderer.on('audio:changed',listener);
    return ()=>ipcRenderer.removeListener('audio:changed',listener);
  },
  countdown: (action, input) => ipcRenderer.invoke('countdown:action', action, input),
  addTodo: input => ipcRenderer.invoke('todo:add', input),
  completeTodo: id => ipcRenderer.invoke('todo:complete', id),
  moveTodo: (id, beforeId) => ipcRenderer.invoke('todo:move', id, beforeId),
  previewTodoReminder: () => ipcRenderer.invoke('todo-reminder:preview'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getStartupSettings: () => ipcRenderer.invoke('app:get-startup'),
  setStartupSettings: enabled => ipcRenderer.invoke('app:set-startup', enabled),
  getWeatherCredentialsStatus: () => ipcRenderer.invoke('weather:credentials-status'),
  saveWeatherCredentials: config => ipcRenderer.invoke('weather:credentials-save', config),
  openWeatherLink: kind => ipcRenderer.invoke('weather:open-link', kind),
  configureWeather:()=>ipcRenderer.invoke('control:configure-weather'),
  onWeatherConfigurationRequest:(callback)=>{
    const listener=(_event,widgetId)=>callback(widgetId);ipcRenderer.on('control:configure-weather',listener);
    return ()=>ipcRenderer.removeListener('control:configure-weather',listener);
  },
  onWidgetSettingsChange:(callback)=>{
    const listener=()=>callback();ipcRenderer.on('widget:settings',listener);
    return ()=>ipcRenderer.removeListener('widget:settings',listener);
  },
  onDesktopError:(callback)=>{
    const listener=(_event,message)=>callback(message);ipcRenderer.on('desktop:error',listener);
    return ()=>ipcRenderer.removeListener('desktop:error',listener);
  },
  beginWidgetGesture: (kind) => ipcRenderer.invoke('widget:begin-gesture',kind),
  endWidgetGesture: (token,commit) => ipcRenderer.invoke('widget:end-gesture',token,commit),
  onWidgetBounds: (callback) => {
    const listener=(_event,bounds)=>callback(bounds);
    ipcRenderer.on('widget:bounds',listener);
    return ()=>ipcRenderer.removeListener('widget:bounds',listener);
  },
  onWidgetGestureCancelled: (callback) => {
    const listener=(_event,token)=>callback(token);
    ipcRenderer.on('widget:gesture-cancelled',listener);
    return ()=>ipcRenderer.removeListener('widget:gesture-cancelled',listener);
  },
  listWidgets: () => ipcRenderer.invoke('widgets:list'),
  createWidget: (typeId, variantId, enabled) => ipcRenderer.invoke('widgets:create', typeId, variantId, enabled),
  getWeatherEnabled: () => ipcRenderer.invoke('weather:get-enabled'),
  setWeatherEnabled: (enabled) => ipcRenderer.invoke('weather:set-enabled', enabled),
  setWidgetVariant: (id, variantId) => ipcRenderer.invoke('widgets:set-variant', id, variantId),
  setWidgetEnabled: (id, enabled) => ipcRenderer.invoke('widgets:set-enabled', id, enabled),
  getEditMode: () => ipcRenderer.invoke('desktop:get-edit-mode'),
  setEditMode: (enabled) => ipcRenderer.invoke('desktop:set-edit-mode', enabled),
  minimizeControlWindow: () => ipcRenderer.invoke('control:minimize'),
  hideControlWindow: () => ipcRenderer.invoke('control:hide'),
  onEditModeChange: (callback) => {
    const listener = (_event, enabled) => callback(enabled);
    ipcRenderer.on('desktop:edit-mode', listener);
    return () => ipcRenderer.removeListener('desktop:edit-mode', listener);
  },
  removeWidget: (id) => ipcRenderer.invoke('widgets:remove', id),
  showWidget: (id) => ipcRenderer.invoke('widgets:show', id),
  updateWidgetSettings: (id, patch) => ipcRenderer.invoke('widgets:update-settings', id, patch),
  getMediaSnapshot: () => ipcRenderer.invoke('media:snapshot'),
  getLyrics: (track) => ipcRenderer.invoke('lyrics:get', track),
  sendMediaCommand: (command, sourceId, positionTicks) => ipcRenderer.invoke('media:command', command, sourceId, positionTicks),
  searchWeatherLocations: (query) => ipcRenderer.invoke('weather:search', query),
  listWeatherRegions: (parentCode) => ipcRenderer.invoke('weather:regions', parentCode),
  resolveWeatherRegion: (code) => ipcRenderer.invoke('weather:resolve-region', code),
  saveWeatherLocation: (id, code) => ipcRenderer.invoke('weather:save-location', id, code),
  getWeather: (location) => ipcRenderer.invoke('weather:get', location),
  onWidgetActiveChange: (callback) => {
    const listener = (_event, active) => callback(active);
    ipcRenderer.on('widget:active', listener);
    return () => ipcRenderer.removeListener('widget:active', listener);
  },
});
