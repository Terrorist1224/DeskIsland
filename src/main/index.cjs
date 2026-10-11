const path = require('node:path');
const { supportsNativeAcrylic, installLegacyGlass } = require('./window-glass.cjs');
const { app, BrowserWindow, screen, Menu, Tray, nativeTheme, globalShortcut, safeStorage, shell, dialog, powerMonitor } = require('electron');
const { TodoReminders } = require('./todo-reminders.cjs');
const { TodoReminderWindow } = require('./todo-reminder-window.cjs');
const { configureDataPaths, getStartupSettings, setStartupSettings } = require('./runtime-settings.cjs');
const { WidgetStore } = require('./widget-store.cjs');
const { WidgetWindows } = require('./widget-windows.cjs');
const { WindowsHostClient } = require('./windows-host-client.cjs');
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
let quitting = false;
let todoReminders;
let reminderWindow;
const powerListeners = [];

function getWindowsHost() {
  if (!windowsHost) windowsHost = new WindowsHostClient();
  return windowsHost;
}

function createControlWindow(show = true) {
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
    widgetWindows?.setEditMode(false);
    controlWindow.hide();
  });
  controlWindow.on('hide', () => widgetWindows?.setEditMode(false));
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
    if(enabled) globalShortcut.register('Escape',()=>widgetWindows.setEditMode(false));
    else globalShortcut.unregister('Escape');
    if (controlWindow && !controlWindow.isDestroyed()) controlWindow.webContents.send('desktop:edit-mode', enabled);
  };
  widgetWindows.onDesktopError = (message) => {
    console.error('Desktop widget initialization failed:',message);
    controlWindow?.webContents.send('desktop:error',message);
  };
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, () => widgetWindows.setEditMode(false));
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
  todoReminders = new TodoReminders({
    store, onDue: items => {
      try { reminderWindow.show(items); }
      catch(error) { reminderWindow.dismiss();throw error; }
    }, onError: reportTodoError,
    onChange: id => widgetWindows.windows.get(id)?.webContents.send('widget:settings'),
  });
  for (const [event, reason, blocked] of [['suspend','sleep',true],['resume','sleep',false],['lock-screen','lock',true],['unlock-screen','lock',false]]) {
    const listener = () => { if(blocked) reminderWindow.dismiss();todoReminders.setBlocked(reason,blocked); };
    powerMonitor.on(event,listener);
    powerListeners.push([event,listener]);
  }
  if(powerMonitor.getSystemIdleState(1)==='locked') todoReminders.setBlocked('lock',true);
  todoReminders.start();
  registerHandlers({
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
    todoReminders,
    reminderWindow,
    getControlWindow: () => controlWindow,
    getInitialOrigin: () => {
      const display = screen.getPrimaryDisplay();
      const { x, y, width } = display.workArea;
      return { x: x + GRID_SIZE, y: y + GRID_SIZE, width:width-GRID_SIZE, monitorId: String(display.id) };
    },
  });
  createControlWindow(!silentStartup);
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
app.on('before-quit', () => {
  quitting = true;
  globalShortcut.unregister('Escape');
  unregisterWidgetHandlers();
  todoReminders?.close();
  reminderWindow?.close();
  for(const [event,listener] of powerListeners) powerMonitor.removeListener(event,listener);
  widgetWindows?.closeAll();
  windowsHost?.close();
  tray?.destroy();
});
