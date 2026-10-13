const path = require('node:path');
const { supportsNativeAcrylic, installLegacyGlass } = require('./window-glass.cjs');
const { app, BrowserWindow, screen, Menu, Tray, nativeTheme, globalShortcut, safeStorage, shell, dialog, powerMonitor } = require('electron');
const { TodoReminders } = require('./todo-reminders.cjs');
const { TodoReminderWindow } = require('./todo-reminder-window.cjs');
const { DesktopSearch } = require('./desktop-search.cjs');
const { configureDataPaths, getStartupSettings, setStartupSettings } = require('./runtime-settings.cjs');
const { WidgetStore } = require('./widget-store.cjs');
const { WidgetWindows } = require('./widget-windows.cjs');
const { WindowsHostClient } = require('./windows-host-client.cjs');
const { AudioService } = require('./audio/audio-service.cjs');
const { WeatherService } = require('./weather-service.cjs');
const { QWeatherSettings } = require('./qweather-settings.cjs');
const { LyricsService } = require('./lyrics-service.cjs');
const { registerHandlers, unregisterWidgetHandlers } = require('./ipc.cjs');
const { GRID_SIZE } = require('../shared/grid.cjs');

try {
  configureDataPaths(app);
} catch (error) {
  dialog.showErrorBox('桌屿无法启动', `安装目录中的数据无法写入，请检查目录权限。不会回退到系统用户目录。\n${error.message}`);
  app.exit(1);
}
app.setName('DeskIsland');
app.setAppUserModelId('DeskIsland');
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
let silentStartup = process.argv.includes('--autostart');

let controlWindow;
let store;
let widgetWindows;
let weatherService;
let lyricsService;
let windowsHost;
let tray;
let audioService;
let quitPending=false;
let quitting = false;
const { Countdown } = require('./countdown.cjs');
let countdown;
let todoReminders;
let reminderWindow;
let desktopSearch;
let lastAudioRecording;
// Unsaved credentials and page drafts stay in memory for this app session only.
let controlState=null;
const powerListeners = [];

function sendAudioRecording(recording, force=false) {
  if(!controlWindow||controlWindow.isDestroyed()||!controlWindow.isVisible()) return;
  const value={status:recording.status,message:recording.message};
  if(!force&&lastAudioRecording?.status===value.status&&lastAudioRecording?.message===value.message) return;
  controlWindow.webContents.send('audio:recording-changed',value);
  lastAudioRecording=value;
}

function broadcastAudioState(state) {
  for(const widget of store.list('audio')) {
    if(!widget.enabled) continue;
    const window=widgetWindows?.windows.get(widget.id);
    if(window&&!window.isDestroyed()) window.webContents.send('audio:changed',state);
  }
  sendAudioRecording(state.recording);
}

function getWindowsHost() {
  if (!windowsHost) windowsHost = new WindowsHostClient();
  return windowsHost;
}

function createControlWindow(show = true) {
  if(!show) return;
  if (controlWindow && !controlWindow.isDestroyed()) {
    if (controlWindow.isMinimized()) controlWindow.restore();
    if (show) { controlWindow.show(); controlWindow.focus(); }
    return;
  }

  controlWindow = new BrowserWindow({
    width: 1000,
    height: 740,
    minWidth: 920,
    minHeight: 700,
    frame: false,
    show,
    icon: path.join(__dirname, 'tray-icon.png'),
    roundedCorners: true,
    transparent: !supportsNativeAcrylic,
    backgroundMaterial: supportsNativeAcrylic ? 'acrylic' : 'none',
    backgroundColor: '#00000000',
    title: '桌屿',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  installLegacyGlass(controlWindow, getWindowsHost);
  controlWindow.setMenu(null);
  controlWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    if(controlWindow.webContents.isLoadingMainFrame()) controlWindow.destroy();
    else controlWindow.webContents.send('control:closing');
  });
  controlWindow.on('hide', () => widgetWindows?.setEditMode(false));
  controlWindow.on('show', () => { if(audioService) sendAudioRecording(audioService.snapshot.recording,true); });
  controlWindow.on('minimize', () => widgetWindows?.setEditMode(false));
  controlWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'Escape') widgetWindows?.setEditMode(false);
  });

  const devUrl = process.env.DESKISLAND_DEV_URL;
  if (devUrl) void controlWindow.loadURL(devUrl);
  else void controlWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));

  controlWindow.on('closed', () => { controlWindow = null; });
}

app.on('second-instance', (_event, argv) => {
  if (argv.includes('--autostart')) return;
  silentStartup = false;
  if (app.isReady() && widgetWindows) createControlWindow();
});

if (primaryInstance) app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(null);
  store = new WidgetStore(app.getPath('userData'));
  const weatherSettings = new QWeatherSettings(app.getPath('userData'), safeStorage);
  weatherService = new WeatherService({ qweather: weatherSettings.service });
  lyricsService = new LyricsService();
  audioService = new AudioService({
    userDataPath:app.getPath('userData'),runtimePath:app.isPackaged?path.join(app.getAppPath(),'audio-runtime'):path.join(app.getAppPath(),'.tmp','audio-runtime'),desktopPath:app.getPath('desktop'),
    chooseSavePath:async name=>{
      const options={title:'保存录音',defaultPath:path.join(app.getPath('desktop'),name),filters:[{name:'MP3 音频',extensions:['mp3']}]};
      const result=controlWindow?.isVisible()?await dialog.showSaveDialog(controlWindow,options):await dialog.showSaveDialog(options);
      return result.canceled?null:result.filePath;
    },
    onChange:broadcastAudioState,
  });
  widgetWindows = new WidgetWindows({
    BrowserWindow,
    screen,
    store,
    getWindowsHost,
    preloadPath: path.join(__dirname, '../preload/index.cjs'),
    rendererPath: path.join(__dirname, '../../dist/renderer/widget.html'),
    devUrl: process.env.DESKISLAND_DEV_URL,
  });
  widgetWindows.onEditModeChange = (enabled) => {
    if(enabled) desktopSearch?.close();
    if(enabled) globalShortcut.register('Escape',()=>widgetWindows.setEditMode(false));
    else globalShortcut.unregister('Escape');
    if (controlWindow && !controlWindow.isDestroyed()) controlWindow.webContents.send('desktop:edit-mode', enabled);
  };
  widgetWindows.onDesktopError = (message) => {
    console.error('Desktop widget initialization failed:',message);
    controlWindow?.webContents.send('desktop:error',message);
  };
  desktopSearch = new DesktopSearch({
    screen, getWindowsHost,
    getFileIcon: (filePath, options) => app.getFileIcon(filePath, options),
    openPath: filePath => shell.openPath(filePath),
  });
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, () => { desktopSearch.close();widgetWindows.setEditMode(false); });
  }
  const reportTodoError = error => {
    console.error('Todo reminder failed:', error);
    controlWindow?.webContents.send('desktop:error', `待办提醒失败：${error.message}`);
  };
  reminderWindow = new TodoReminderWindow({
    getWindowsHost,
    BrowserWindow, screen,
    preloadPath: path.join(__dirname, '../preload/todo-reminder.cjs'),
    rendererPath: path.join(__dirname, '../../dist/renderer/reminder.html'),
    devUrl: process.env.DESKISLAND_DEV_URL,
    onOpen: () => widgetWindows.setEditMode(false),
    onError: (error,items) => {
      const widget=store.list().find(item=>item.typeId==='todo');
      if(widget && items?.length) {
        try {
          store.setTodoReminderStates(widget.id,new Map(items.map(item=>[item.id,'missed'])));
          widgetWindows.windows.get(widget.id)?.webContents.send('widget:settings');
        } catch(saveError) { reportTodoError(saveError); }
      }
      reportTodoError(error);
    },
  });
  countdown = new Countdown({
    onDue: id => { widgetWindows.setEditMode(false);void widgetWindows.setCountdownReminder(id,true).catch(reportTodoError); },
    onChange: (id, finished) => {
      if (finished) { try { store.updateSettings(id, {seconds: 0}); } catch (error) { reportTodoError(error); } }
      widgetWindows.windows.get(id)?.webContents.send('widget:settings');
    }, onError: reportTodoError,
  });
  countdown.open();
  widgetWindows.isCountdownFinished = id => countdown.get(id).status === 'finished';
  todoReminders = new TodoReminders({
    store, onDue: items => {
      try { reminderWindow.show(items); }
      catch(error) { reminderWindow.dismiss();throw error; }
    }, onError: reportTodoError,
    onChange: id => widgetWindows.windows.get(id)?.webContents.send('widget:settings'),
  });
  for (const [event, reason, blocked] of [['suspend','sleep',true],['resume','sleep',false],['lock-screen','lock',true],['unlock-screen','lock',false]]) {
    const listener = () => { if(blocked) reminderWindow.dismiss();todoReminders.setBlocked(reason,blocked);countdown.setBlocked(reason,blocked); };
    powerMonitor.on(event,listener);
    powerListeners.push([event,listener]);
  }
  if(powerMonitor.getSystemIdleState(1)==='locked') { todoReminders.setBlocked('lock',true);countdown.setBlocked('lock',true); }
  todoReminders.start();
  registerHandlers({
    desktopSearch,
    audioService,
    openAudioFolder:()=>{const saved=audioService.snapshot.recording.savedPath;if(saved) shell.showItemInFolder(saved);},
    getAppInfo: () => ({ version: app.getVersion() }),
    getStartupSettings: () => getStartupSettings(app),
    setStartupSettings: enabled => setStartupSettings(app, enabled),
    store,
    getWindowsHost,
    weatherService,
    weatherSettings,
    openWeatherLink: kind => {
      const links = { register: 'https://console.qweather.com/', guide: 'https://dev.qweather.com/docs/configuration/authentication/', pricing: 'https://dev.qweather.com/docs/finance/pricing/' };
      if (!Object.hasOwn(links, kind)) throw new TypeError('Invalid weather link');
      return shell.openExternal(links[kind]);
    },
    lyricsService,
    widgetWindows,
    todoReminders, countdown,
    reminderWindow,
    getControlWindow: () => controlWindow,
    getControlState:()=>controlState,
    closeControlWindow:state=>{controlState=state;widgetWindows.setEditMode(false);controlWindow.destroy();},
    openControlWindow:()=>{createControlWindow();return controlWindow;},
    getInitialOrigin: () => {
      const display = screen.getPrimaryDisplay();
      const { x, y, width } = display.workArea;
      return { x: x + GRID_SIZE, y: y + GRID_SIZE, width:width-GRID_SIZE, monitorId: String(display.id) };
    },
  });
  createControlWindow(!silentStartup);
  void audioService.recover().then(()=>audioService.setEnabled(store.list().some(item=>item.typeId==='audio'&&item.enabled))).catch(error=>controlWindow?.webContents.send('desktop:error',`音频初始化失败：${error.message}`));
  void widgetWindows.restore();
  tray = new Tray(path.join(__dirname, 'tray-icon.png'));
  tray.setToolTip(`桌屿 · DeskIsland ${app.getVersion()}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开桌屿', click: () => createControlWindow() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
  tray.on('double-click', () => createControlWindow());
}).catch(error => {
  dialog.showErrorBox('桌屿无法启动', `配置或系统初始化失败，原数据文件已保留。\n${error.message}`);
  app.quit();
});

app.on('activate', () => createControlWindow());
// The tray keeps the app running even when every renderer window has been released.
app.on('window-all-closed',()=>{});
app.on('before-quit', event => {
  if(audioService&&!audioService.closed) {
    event.preventDefault();
    if(!quitPending){quitPending=true;void audioService.shutdown().catch(error=>console.error('录音退出保存失败，临时文件已保留：',error)).finally(()=>app.quit());}
    return;
  }
  quitting = true;
  globalShortcut.unregister('Escape');
  unregisterWidgetHandlers();
  countdown?.close();
  todoReminders?.close();
  reminderWindow?.close();
  desktopSearch?.close();
  for(const [event,listener] of powerListeners) powerMonitor.removeListener(event,listener);
  widgetWindows?.closeAll();
  windowsHost?.close();
  tray?.destroy();
});
