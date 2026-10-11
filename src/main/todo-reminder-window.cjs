const { installLegacyGlass } = require('./window-glass.cjs');

// One interrupting overlay; only its WebContents can read or dismiss the current batch.
class TodoReminderWindow {
  constructor({ BrowserWindow, screen, preloadPath, rendererPath, devUrl, getWindowsHost, onOpen, onError }) {
    Object.assign(this, { BrowserWindow, screen, preloadPath, rendererPath, devUrl, getWindowsHost, onOpen, onError });
    this.items = [];
    this.onDisplayChange = () => {
      if (!this.window || this.window.isDestroyed()) return;
      const display = this.screen.getAllDisplays().find(item => item.id === this.displayId) ?? this.screen.getPrimaryDisplay();
      this.displayId = display.id;
      this.window.setBounds(display.bounds);
    };
    screen.on('display-removed', this.onDisplayChange);
    screen.on('display-metrics-changed', this.onDisplayChange);
  }

  requireSender(sender) {
    if (!this.window || this.window.isDestroyed() || this.window.webContents !== sender) throw new Error('此操作只能由提醒窗口执行');
  }

  preview() {
    if (this.window && !this.window.isDestroyed()) { this.window.focus();return; }
    this.show([{ id: 'preview', text: '预览示例 · 这是待办全屏提醒', color: 'blue', remindAt: Date.now(), reminderState: 'notified' }]);
    this.isPreview = true;
  }

  show(items) {
    if (this.isPreview) { this.items = [];this.isPreview = false; }
    this.items = [...this.items, ...items.filter(item => !this.items.some(current => current.id === item.id))];
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('todo-reminder:items', this.items);
      return;
    }
    this.onOpen();
    const display = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint());
    this.displayId = display.id;
    const window = new this.BrowserWindow({
      ...display.bounds, frame: false, thickFrame: false, show: false, backgroundColor: '#00000000', transparent: true,
      resizable: false, movable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, title: '桌屿 · 待办提醒',
      webPreferences: { preload: this.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.window = window;
    // Accent blur has no theme tint, unlike dark-theme native Acrylic.
    installLegacyGlass(window, this.getWindowsHost, true, true);
    const fail = error => {
      if(this.window!==window) return;
      const failed=this.isPreview ? [] : this.items;
      this.dismiss();
      this.onError(error,failed);
    };
    window.setMenu(null);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.webContents.once('did-finish-load', () => {
      if (window.isDestroyed()) return;
      // On Windows, native fullscreen can use maximized work-area bounds; cover the full display in DIP instead.
      this.onDisplayChange();
      window.show();
      window.focus();
    });
    window.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape' && input.type === 'keyDown') { event.preventDefault();this.dismiss(); }
    });
    window.webContents.once('render-process-gone', (_event, details) => fail(new Error(`提醒页面退出：${details.reason}`)));
    window.once('closed', () => {
      if (this.window === window) { this.window = null;this.items = [];this.isPreview = false; }
    });
    const loaded = this.devUrl
      ? window.loadURL(new URL('reminder.html', this.devUrl).href)
      : window.loadFile(this.rendererPath);
    void loaded.catch(fail);
  }

  sync(items) {
    if (this.isPreview) return;
    const ids = new Set(items.map(item => item.id));
    this.items = this.items.filter(item => ids.has(item.id));
    if (!this.items.length) this.dismiss();
    else this.window?.webContents.send('todo-reminder:items', this.items);
  }

  dismiss() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.items = [];
    this.isPreview = false;
  }

  close() {
    this.dismiss();
    this.screen.removeListener('display-removed', this.onDisplayChange);
    this.screen.removeListener('display-metrics-changed', this.onDisplayChange);
  }
}

module.exports = { TodoReminderWindow };
