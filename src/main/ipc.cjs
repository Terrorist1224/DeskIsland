const { ipcMain } = require('electron');
const widgetTypes = new Set(require('../shared/widget-catalog.json').map((item) => item.typeId));
const mediaCommands = new Set(['toggle', 'next', 'previous', 'seek']);
const { listWeatherRegions, getWeatherRegionPath } = require('./weather-regions.cjs');

function registerHandlers({ store, getWindowsHost, weatherService, weatherSettings, openWeatherLink, lyricsService, widgetWindows, todoReminders, reminderWindow, getInitialOrigin, getControlWindow, getAppInfo, getStartupSettings, setStartupSettings }) {
  const savingLocations = new Set();
  function requireControl(event) {
    if (event.sender !== getControlWindow()?.webContents) throw new Error('此操作只能在主窗口执行');
  }
  function requireTodo(event) {
    const entry=[...widgetWindows.windows].find(([,window])=>!window.isDestroyed() && window.webContents===event.sender);
    const widget=entry && store.list().find(item=>item.id===entry[0]);
    if(!widget || widget.typeId!=='todo' || !widget.enabled || widgetWindows.editMode) throw new Error('此操作只能由开启的待办磁贴执行');
    return widget.id;
  }
  function syncTodo(id) {
    const widget=store.list().find(item=>item.typeId==='todo');
    reminderWindow?.sync(widget?.enabled ? widget.settings.items : []);
    widgetWindows?.windows.get(id)?.webContents.send('widget:settings');
  }
  ipcMain.handle('todo:add', (event,input)=>{
    const id=requireTodo(event);
    const items=store.addTodo(id,input);
    syncTodo(id);
    return items;
  });
  ipcMain.handle('todo:complete', (event,itemId)=>{
    const id=requireTodo(event);
    const items=store.completeTodo(id,itemId);
    syncTodo(id);
    return items;
  });
  ipcMain.handle('todo:move', (event,itemId,beforeId)=>{
    const id=requireTodo(event);
    const items=store.moveTodo(id,itemId,beforeId);
    syncTodo(id);
    return items;
  });
  ipcMain.handle('todo-reminder:get', event=>{reminderWindow.requireSender(event.sender);return reminderWindow.items;});
  ipcMain.handle('todo-reminder:preview', event=>{requireControl(event);reminderWindow.preview();});
  ipcMain.handle('todo-reminder:dismiss', event=>{reminderWindow.requireSender(event.sender);reminderWindow.dismiss();});
  ipcMain.handle('app:info', () => getAppInfo());
  ipcMain.handle('app:get-startup', event => { requireControl(event); return getStartupSettings(); });
  ipcMain.handle('app:set-startup', (event, enabled) => {
    requireControl(event);
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid startup state');
    return setStartupSettings(enabled);
  });
  ipcMain.handle('widgets:list', () => store.list());
  ipcMain.handle('widgets:create', (event, typeId, variantId, enabled = true) => {
    requireControl(event);
    if (!widgetTypes.has(typeId)) throw new TypeError('Invalid widget type');
    const widget = store.create(typeId, getInitialOrigin?.(), variantId, enabled);
    widgetWindows?.show(widget);
    return widget;
  });
  ipcMain.handle('widgets:remove', (event, id) => {
    requireControl(event);
    if (typeof id !== 'string' || id.length > 64) throw new TypeError('Invalid widget id');
    store.remove(id);
    widgetWindows?.remove(id);
    syncTodo(id);
  });
  ipcMain.handle('widgets:set-variant', (event, id, variantId) => {
    requireControl(event);
    if (typeof id !== 'string' || id.length > 64 || typeof variantId !== 'string') throw new TypeError('Invalid widget variant');
    const widget = store.setVariant(id, variantId, (widget) => widgetWindows.fitWidget(widget));
    return widgetWindows.replace(widget);
  });
  ipcMain.handle('widgets:set-enabled', (event, id, enabled) => {
    requireControl(event);
    if (typeof id !== 'string' || id.length > 64 || typeof enabled !== 'boolean') throw new TypeError('Invalid widget enabled state');
    const widget = store.setEnabled(id, enabled);
    if (enabled) widgetWindows.show(widget);
    else widgetWindows.remove(id);
    if(widget.typeId==='todo') { todoReminders?.reconcile(id);syncTodo(id); }
    return widget;
  });
  ipcMain.handle('weather:get-enabled', (event) => { requireControl(event); return store.getWeatherEnabled(); });
  ipcMain.handle('weather:set-enabled', (event, enabled) => {
    requireControl(event);
    const value = store.setWeatherEnabled(enabled);
    widgetWindows.syncWeather();
    return value;
  });
  ipcMain.handle('desktop:get-edit-mode', () => widgetWindows.editMode);
  ipcMain.handle('widget:begin-gesture', (event,kind) => widgetWindows.beginGesture(event.sender,kind));
  ipcMain.handle('widget:end-gesture', (event,token,commit) => widgetWindows.endGesture(event.sender,token,commit));
  ipcMain.handle('desktop:set-edit-mode', (event, enabled) => {
    requireControl(event);
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid edit mode');
    return widgetWindows.setEditMode(enabled);
  });
  ipcMain.handle('control:minimize', (event) => { requireControl(event); getControlWindow().minimize(); });
  ipcMain.handle('control:hide', (event) => { requireControl(event); widgetWindows.setEditMode(false); getControlWindow().hide(); });
  ipcMain.handle('control:configure-weather', (event) => {
    const widget=[...widgetWindows.windows].find(([,window])=>window.webContents===event.sender);
    if(!widget || store.list().find(item=>item.id===widget[0])?.typeId!=='weather') throw new Error('此操作只能由天气磁贴执行');
    if(widgetWindows.editMode) throw new Error('编辑时不能打开地点设置');
    const control=getControlWindow();
    if(control.isMinimized()) control.restore();
    control.show();control.focus();control.webContents.send('control:configure-weather', widget[0]);
  });
  ipcMain.handle('widgets:show', (_event, id) => {
    if (typeof id !== 'string' || id.length > 64) throw new TypeError('Invalid widget id');
    const widget = store.list().find((item) => item.id === id);
    if (!widget || !store.isVisible(widget)) return false;
    if (widget.typeId !== 'weather' && store.list().find((item) => item.typeId === widget.typeId)?.id !== id) throw new Error('同类已有磁贴，请先移除旧的重复磁贴');
    widgetWindows?.show(widget);
    return true;
  });
  ipcMain.handle('widgets:update-settings', (_event, id, patch) => {
    requireControl(_event);
    if (typeof id !== 'string' || id.length > 64 || !patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new TypeError('Invalid widget settings');
    }
    if (Object.hasOwn(patch, 'location')) {
      const location = patch.location;
      if (location !== null && (!location || typeof location !== 'object' ||
          !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
          location.latitude < -90 || location.latitude > 90 || location.longitude < -180 || location.longitude > 180)) {
        throw new TypeError('Invalid weather location');
      }
    }
    const saved=store.updateSettings(id, patch);
    widgetWindows.windows.get(id)?.webContents.send('widget:settings');
    return saved;
  });
  ipcMain.handle('media:snapshot', async () => getWindowsHost().request('media.snapshot'));
  ipcMain.handle('lyrics:get', (_event, track) => {
    if (!track || typeof track !== 'object' ||
        typeof track.title !== 'string' || track.title.trim().length < 1 || track.title.length > 200 ||
        typeof track.artist !== 'string' || track.artist.trim().length < 1 || track.artist.length > 200 ||
        (track.album != null && (typeof track.album !== 'string' || track.album.length > 200)) ||
        (track.sourceId != null && (typeof track.sourceId !== 'string' || track.sourceId.length > 200)) ||
        (track.durationSeconds != null && (!Number.isFinite(track.durationSeconds) || track.durationSeconds < 1 || track.durationSeconds > 3600))) {
      throw new TypeError('Invalid track details for lyrics lookup');
    }
    return lyricsService.getLyrics({ ...track, title: track.title.trim(), artist: track.artist.trim() });
  });
  ipcMain.handle('media:command', async (_event, command, sourceId, positionTicks) => {
    if (!mediaCommands.has(command)) throw new TypeError('Invalid media command');
    if (typeof sourceId !== 'string' || !/^QQMusic\.exe$/i.test(sourceId)) throw new TypeError('Invalid music target');
    if (command === 'seek' && (!Number.isSafeInteger(positionTicks) || positionTicks < 0)) {
      throw new TypeError('Invalid playback position');
    }
    return getWindowsHost().request('media.command', { command, sourceId, positionTicks });
  });
  ipcMain.handle('weather:search', (_event, query) => {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 80) {
      throw new TypeError('Location query must contain 2 to 80 characters');
    }
    return weatherService.searchLocations(query.trim());
  });
  ipcMain.handle('weather:get', (event) => {
    const entry = [...widgetWindows.windows].find(([, window]) => window.webContents === event.sender);
    const widget = entry && store.list().find(item => item.id === entry[0]);
    if (!widget || widget.typeId !== 'weather' || !store.isVisible(widget)) throw new Error('只有已启用的天气磁贴可以获取天气');
    return weatherService.getWeather(widget.settings.location);
  });
  ipcMain.handle('weather:credentials-status', event => { requireControl(event); return weatherSettings.status(); });
  ipcMain.handle('weather:credentials-save', (event, config) => {
    requireControl(event);
    weatherSettings.save(config);
    weatherService.setProvider(weatherSettings.service);
    for (const widget of store.list()) {
      if (widget.typeId === 'weather' && store.isVisible(widget)) widgetWindows.windows.get(widget.id)?.webContents.send('widget:settings');
    }
    return weatherSettings.status();
  });
  ipcMain.handle('weather:open-link', (event, kind) => { requireControl(event); return openWeatherLink(kind); });
  ipcMain.handle('weather:regions', (event, parentCode) => {
    requireControl(event);
    return listWeatherRegions(parentCode);
  });
  ipcMain.handle('weather:resolve-region', (event, code) => {
    requireControl(event);
    return weatherService.resolveRegion(getWeatherRegionPath(code));
  });
  ipcMain.handle('weather:save-location', async (event, id, code) => {
    requireControl(event);
    if (typeof id !== 'string' || !id || id.length > 64) throw new TypeError('Invalid widget id');
    const path = getWeatherRegionPath(code);
    const requireWeather = () => {
      if (!store.list().some(item => item.id === id && item.typeId === 'weather')) throw new Error('找不到天气磁贴，请重新打开设置页');
    };
    requireWeather();
    if (savingLocations.has(id)) throw new Error('该磁贴地点正在保存，请稍候');
    savingLocations.add(id);
    try {
      // Main owns the entire operation; renderer navigation cannot interrupt persistence.
      const location = await weatherService.resolveRegion(path);
      requireWeather();
      if (!store.updateSettings(id, { location })) throw new Error('找不到天气磁贴，请重新打开设置页');
      widgetWindows.windows.get(id)?.webContents.send('widget:settings');
      return location;
    } finally {
      savingLocations.delete(id);
    }
  });
}

function unregisterWidgetHandlers() {
  for(const channel of ['todo:add','todo:complete','todo:move','todo-reminder:get','todo-reminder:dismiss','todo-reminder:preview']) ipcMain.removeHandler(channel);
  for (const channel of ['app:info', 'app:get-startup', 'app:set-startup']) ipcMain.removeHandler(channel);
  for (const channel of ['weather:credentials-status', 'weather:credentials-save', 'weather:open-link']) ipcMain.removeHandler(channel);
  ipcMain.removeHandler('weather:get-enabled');
  ipcMain.removeHandler('weather:set-enabled');
  ipcMain.removeHandler('widgets:set-enabled');
  for (const channel of ['widget:begin-gesture','widget:end-gesture','control:configure-weather']) ipcMain.removeHandler(channel);
  for (const channel of ['widgets:set-variant', 'desktop:get-edit-mode', 'desktop:set-edit-mode', 'control:minimize', 'control:hide']) ipcMain.removeHandler(channel);
  ipcMain.removeHandler('widgets:list');
  ipcMain.removeHandler('widgets:create');
  ipcMain.removeHandler('widgets:remove');
  ipcMain.removeHandler('widgets:show');
  ipcMain.removeHandler('widgets:update-settings');
  ipcMain.removeHandler('media:snapshot');
  ipcMain.removeHandler('lyrics:get');
  ipcMain.removeHandler('media:command');
  ipcMain.removeHandler('weather:search');
  ipcMain.removeHandler('weather:get');
  ipcMain.removeHandler('weather:regions');
  ipcMain.removeHandler('weather:resolve-region');
  ipcMain.removeHandler('weather:save-location');
}

module.exports = { registerHandlers, unregisterWidgetHandlers };
