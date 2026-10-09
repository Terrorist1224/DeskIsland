const path = require('node:path');
const { supportsNativeAcrylic, installLegacyGlass } = require('./window-glass.cjs');
const { app, BrowserWindow, screen, Menu, Tray, nativeTheme, globalShortcut, safeStorage, shell, dialog } = require('electron');
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
  widgetWindows?.closeAll();
  windowsHost?.close();
  tray?.destroy();
});
