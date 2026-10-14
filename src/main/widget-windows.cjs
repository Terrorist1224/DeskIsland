const { GRID_SIZE, fitBoundsToGrid, resizeFromCorner } = require('../shared/grid.cjs');
const catalog = require('../shared/widget-catalog.json');
const { getWindowHandle } = require('./window-glass.cjs');

class WidgetWindows {
  constructor({ BrowserWindow, screen, store, getWindowsHost, preloadPath, rendererPath, devUrl }) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.store = store;
    this.getWindowsHost = getWindowsHost;
    this.preloadPath = preloadPath;
    this.rendererPath = rendererPath;
    this.devUrl = devUrl;
    this.windows = new Map();
    this.readyWindows = new Set();
    this.reminderWindows = new Set();
    this.gesture = null;
    this.gestureSequence = 0;
    this.pauseTimer = null;
    this.pauseRequestInFlight = false;
    this.paused = false;
    this.editMode = false;
    this.overlays = [];
  }

  async restore() {
    if (this.store.list().length === 0) return;
    try {
      const { shouldPause } = await this.getWindowsHost().request('system.pause-state');
      this.paused = Boolean(shouldPause);
    } catch {
      this.paused = false;
    }
    const restoredTypes = new Set();
    for (const widget of this.store.list()) {
      // Music stays a singleton; every enabled weather instance restores its own window.
      if (widget.typeId !== 'weather' && restoredTypes.has(widget.typeId)) continue;
      restoredTypes.add(widget.typeId);
      this.show(widget);
    }
  }

  show(widget, reminder = this.isCountdownFinished?.(widget.id) ?? false) {
    if (!this.store.isVisible(widget)) return;
    const current = this.windows.get(widget.id);
    if (current && !current.isDestroyed()) {
      if(this.readyWindows.has(current)) current.showInactive();
      return current;
    }

    widget = this.fitWidget(widget);
    this.store.updateBounds(widget.id, widget, false);

    const window = new this.BrowserWindow({
      width: widget.width,
      height: widget.height,
      x: widget.x,
      y: widget.y,
      frame: false,
      thickFrame: false,
      transparent: true,
      roundedCorners: true,
      alwaysOnTop: reminder,
      backgroundMaterial: 'none',
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: ['todo','note','countdown','audio','desktop-search'].includes(widget.typeId),
      show: false,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Audio must repaint while the Windows volume window holds focus.
        backgroundThrottling: widget.typeId !== 'audio',
      },
    });
    window.setAlwaysOnTop(reminder, 'floating');
    if(reminder) this.reminderWindows.add(window);
    window.on('show', () => this.#lowerWindow(window));
    window.on('minimize', () => { window.restore(); this.#lowerWindow(window); });
    this.windows.set(widget.id, window);
    // Only the typed edit gesture changes geometry; native titlebar dragging stays disabled.
    // Electron's will-move interception also blocks HWND Z-order changes; countdown uses movable:false.
    if(widget.typeId!=='countdown') window.on('will-move', (event) => event.preventDefault());
    // Hidden transparent windows may not paint; initialize from load instead of waiting for ready-to-show.
    window.webContents.once('did-finish-load', async () => {
      if (window.isDestroyed()) return;
      try {
        window.setBounds({ x:widget.x,y:widget.y,width:widget.width,height:widget.height }, false);
        if(reminder) {
          if(!window.isAlwaysOnTop()) throw new Error('倒计时窗口未能置顶');
        } else {
          const result=await this.getWindowsHost().request('system.desktop-widget',{handle:getWindowHandle(window),focusable:['todo','note','countdown','audio','desktop-search'].includes(widget.typeId)});
          if(!result.installed) throw new Error('Windows 没有启用桌面磁贴层级');
        }
        if(window.isDestroyed()) return;
        this.readyWindows.add(window);
        window.showInactive();
      } catch(error) {
        if(!window.isDestroyed()) this.onDesktopError?.(error instanceof Error?error.message:'无法启用桌面磁贴');
      }
    });
    window.on('resize', () => this.#sendBounds(widget.id));
    window.webContents.once('did-finish-load', () => {
      if (window.isDestroyed()) return;
      window.webContents.send('widget:active', !this.paused);
      window.webContents.send('desktop:edit-mode', this.editMode);
      this.#sendBounds(widget.id);
    });
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'Escape') this.setEditMode(false);
    });
    for (const event of ['did-start-loading','render-process-gone']) {
      window.webContents.on(event, () => {
        if(this.gesture?.id===widget.id) this.cancelGesture();
      });
    }
    window.on('closed', () => {
      if (this.windows.get(widget.id) !== window) return;
      if(this.gesture?.id===widget.id) this.cancelGesture();
      this.windows.delete(widget.id);
      this.readyWindows.delete(window);
      this.reminderWindows.delete(window);
      if (this.windows.size === 0) this.#stopPauseMonitor();
    });

    if (this.devUrl) void window.loadURL(new URL(`widget.html?id=${encodeURIComponent(widget.id)}`, this.devUrl).href);
    else void window.loadFile(this.rendererPath, { query: { id: widget.id } });
    this.#startPauseMonitor();
    return window;
  }

  #lowerWindow(window) {
    if (window.isDestroyed() || this.reminderWindows.has(window)) return;
    // The hidden Windows worker adjusts only this known widget HWND; renderers cannot choose handles.
    void this.getWindowsHost().request('system.lower-widget', { handle: getWindowHandle(window) }).catch(error => {
      if (!window.isDestroyed()) console.error('Failed to lower desktop widget:', error);
    });
  }

  async setCountdownReminder(id, active) {
    const widget=this.store.list().find(item=>item.id===id);
    if(!widget || !widget.enabled) return;
    if(widget.typeId!=='countdown') throw new Error('此操作仅限倒计时窗口');
    // Recreate at identical bounds: reusing an Explorer-owned HWND gives unreliable TOPMOST transitions.
    this.remove(id);
    this.show(widget,active);
  }

  setEditMode(enabled) {
    if (this.editMode === enabled) return this.editMode;
    if (enabled && this.paused) this.#setPaused(false);
    if (!enabled) this.cancelGesture();
    this.editMode = enabled;
    for (const window of this.windows.values()) {
      if (window.isDestroyed()) continue;
      window.webContents.send('desktop:edit-mode', enabled);
      if(!enabled) this.#lowerWindow(window);
    }
    if (enabled) {
      // BrowserWindow bounds and grid spacing use Electron DIP, not Win32 physical pixels.
      for (const display of this.screen.getAllDisplays()) {
        const overlay = new this.BrowserWindow({
          ...display.workArea, frame: false, transparent: true, backgroundColor: '#00000000',
          resizable: false, movable: false, focusable: false, skipTaskbar: true, show: false,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        });
        overlay.setIgnoreMouseEvents(true);
        overlay.setAlwaysOnTop(true, 'floating');
        const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html{height:100%;background-color:#ffffff03;background-image:linear-gradient(#ffffff26 1px,transparent 1px),linear-gradient(90deg,#ffffff26 1px,transparent 1px);background-size:${GRID_SIZE}px ${GRID_SIZE}px}body{font:14px Segoe UI,sans-serif;color:#fafafa;background:#17161bed;border:1px solid #ffffff40;border-radius:12px;padding:12px 18px;width:max-content;margin:12px auto}</style><body>DeskIsland · 拖动磁贴，四角缩放（待办、便签宽高独立） · Esc 完成编辑</body>`;
        void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        overlay.once('ready-to-show', () => {
          if (!overlay.isDestroyed() && this.editMode) {
            overlay.setBounds(display.workArea,false);
            overlay.showInactive();
          }
        });
        this.overlays.push(overlay);
      }
    } else {
      for (const overlay of this.overlays) if (!overlay.isDestroyed()) overlay.destroy();
      this.overlays = [];
    }
    this.onEditModeChange?.(enabled);
    return enabled;
  }

  replace(widget) {
    this.remove(widget.id);
    this.show(widget);
    return this.store.list().find((item) => item.id === widget.id);
  }

  syncWeather() {
    for (const widget of this.store.list().filter(item => item.typeId === 'weather')) {
      if (this.store.isVisible(widget)) this.show(widget);
      else this.remove(widget.id);
    }
  }

  remove(id) {
    const window = this.windows.get(id);
    if (!window) return;
    if(this.gesture?.id===id) this.cancelGesture();
    this.windows.delete(id);
    this.readyWindows.delete(window);
    this.reminderWindows.delete(window);
    if (!window.isDestroyed()) window.destroy();
    if (this.windows.size === 0) this.#stopPauseMonitor();
  }

  closeAll() {
    this.setEditMode(false);
    this.#stopPauseMonitor();
    for (const window of this.windows.values()) {
      if (!window.isDestroyed()) window.destroy();
    }
    this.windows.clear();
    this.readyWindows.clear();
    this.reminderWindows.clear();
  }

  #base(widget) {
    return catalog.find(item=>item.typeId===widget.typeId).variants.find(item=>item.id===widget.variantId).size;
  }

  fitWidget(widget) {
    const display = this.screen.getDisplayNearestPoint({
      x:widget.x+widget.width/2,y:widget.y+widget.height/2,
    });
    return {...widget,...fitBoundsToGrid(widget,this.#base(widget),display.workArea),monitorId:String(display.id)};
  }

  #sendBounds(id) {
    const window=this.windows.get(id);
    if(window && !window.isDestroyed()) window.webContents.send('widget:bounds',window.getBounds());
  }

  #senderWidget(sender) {
    const entry=[...this.windows].find(([,window])=>!window.isDestroyed() && window.webContents===sender);
    if(!entry) throw new Error('此操作只能由磁贴自己的窗口执行');
    return entry[0];
  }

  beginGesture(sender, kind) {
    const id=this.#senderWidget(sender);
    if(!this.editMode) throw new Error('请先开启编辑模式');
    if(!['move','nw','ne','sw','se'].includes(kind)) throw new TypeError('Invalid edit gesture');
    if(this.gesture) throw new Error('已有磁贴正在编辑');
    const window=this.windows.get(id);
    const widget=this.store.list().find(item=>item.id===id);
    const start={x:widget.x,y:widget.y,width:widget.width,height:widget.height};
    window.setBounds(start,false);
    const cursor=this.screen.getCursorScreenPoint();
    const display=this.screen.getDisplayNearestPoint({x:start.x+start.width/2,y:start.y+start.height/2});
    const gesture={id,token:++this.gestureSequence,kind,start,cursor,base:this.#base(widget),area:display.workArea};
    this.gesture=gesture;
    // Read the system cursor in DIP, avoiding DOM screen-coordinate differences across DPI scales.
    gesture.timer=setInterval(()=>this.#updateGesture(),16);
    return gesture.token;
  }

  #updateGesture() {
    const gesture=this.gesture;
    if(!gesture) return;
    const window=this.windows.get(gesture.id);
    if(!window || window.isDestroyed()) { this.cancelGesture();return; }
    const point=this.screen.getCursorScreenPoint();
    const delta={x:point.x-gesture.cursor.x,y:point.y-gesture.cursor.y};
    const bounds=gesture.kind==='move'
      ? {...gesture.start,x:Math.round(gesture.start.x+delta.x),y:Math.round(gesture.start.y+delta.y)}
      : resizeFromCorner(gesture.start,gesture.base,gesture.kind,delta,gesture.area);
    const current=window.getBounds();
    if(['x','y','width','height'].some(key=>current[key]!==bounds[key])) window.setBounds(bounds,false);
  }

  endGesture(sender, token, commit) {
    const id=this.#senderWidget(sender);
    if(typeof commit!=='boolean' || !Number.isSafeInteger(token)) throw new TypeError('Invalid edit session');
    if(!this.gesture || this.gesture.id!==id || this.gesture.token!==token) return null;
    if(!commit) { this.cancelGesture();return null; }
    this.#updateGesture();
    const gesture=this.gesture;
    clearInterval(gesture.timer);
    this.gesture=null;
    const window=this.windows.get(id);
    const widget=this.store.list().find(item=>item.id===id);
    try {
      const fitted=this.fitWidget({...widget,...window.getBounds()});
      const saved=this.store.updateBounds(id,fitted);
      window.setBounds({x:saved.x,y:saved.y,width:saved.width,height:saved.height},false);
      this.#sendBounds(id);
      return saved;
    } catch(error) {
      window.setBounds(gesture.start,false);
      this.#sendBounds(id);
      throw error;
    }
  }

  cancelGesture() {
    const gesture=this.gesture;
    if(!gesture) return;
    clearInterval(gesture.timer);
    this.gesture=null;
    const window=this.windows.get(gesture.id);
    if(window && !window.isDestroyed()) {
      window.setBounds(gesture.start,false);
      window.webContents.send('widget:gesture-cancelled',gesture.token);
      this.#sendBounds(gesture.id);
    }
  }

  #startPauseMonitor() {
    if (this.pauseTimer) return;
    // Pause background work, keeping desktop-owned windows painted for instant Show Desktop transitions.
    this.pauseTimer = setInterval(() => void this.#refreshPauseState(), 1500);
    void this.#refreshPauseState();
  }

  async #refreshPauseState() {
    if (this.editMode || this.pauseRequestInFlight || this.windows.size === 0) return;
    this.pauseRequestInFlight = true;
    try {
      const { shouldPause } = await this.getWindowsHost().request('system.pause-state');
      if (this.editMode) return;
      this.#setPaused(Boolean(shouldPause));
    } catch {
      this.#setPaused(false);
    } finally {
      this.pauseRequestInFlight = false;
    }
  }

  #setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) this.setEditMode(false);
    for (const window of this.windows.values()) {
      if (window.isDestroyed()) continue;
      window.webContents.send('widget:active', !paused);
    }
  }

  #stopPauseMonitor() {
    clearInterval(this.pauseTimer);
    this.pauseTimer = null;
    this.paused = false;
  }
}

module.exports = { WidgetWindows };
