const { randomUUID } = require('node:crypto');
const colors = require('../shared/todo-colors.json');
const { validateNoteInput, validateNoteId, noteTitle } = require('../shared/note.cjs');

// Records outlive their windows. Only a window's own WebContents can edit its record.
class NoteWindows {
  constructor({ BrowserWindow, screen, store, preloadPath, rendererPath, devUrl, onChange, onError }) {
    Object.assign(this, { BrowserWindow, screen, store, preloadPath, rendererPath, devUrl, onChange, onError });
    this.entries = new Map();
    this.sequence = 0;
    this.displayListener = () => {
      for (const entry of this.entries.values()) {
        const bounds = entry.window.getBounds();
        const area = screen.getDisplayMatching(bounds).workArea;
        entry.window.setBounds(this.fitBounds(bounds, area));
      }
    };
    for (const event of ['display-removed', 'display-metrics-changed']) screen.on(event, this.displayListener);
  }

  fitBounds(bounds, area) {
    const width = Math.min(600, area.width), height = Math.min(480, area.height);
    return { width, height, x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))) };
  }

  open(widgetId, id) {
    if (this.preparingQuit) throw new Error('程序正在保存便签并退出');
    const widget = this.store.list('note').find(widget => widget.id === widgetId);
    if (!widget) throw new Error('找不到便签磁贴');
    if (id !== undefined) validateNoteId(id);
    const existing = id && this.entries.get(id);
    if (existing) { if (existing.window.isMinimized()) existing.window.restore();existing.window.show();existing.window.focus();return; }
    const record = id && widget.settings.items.find(item => item.id === id);
    if (id && !record) throw new Error('便签已删除');
    id ??= randomUUID();
    const input = record ? { text: record.text, color: record.color } : { text: '', color: 'blue' };
    const area = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint()).workArea;
    const offset = (this.entries.size % 6) * 24;
    const bounds = this.fitBounds({ x: area.x + (area.width - 600) / 2 + offset, y: area.y + (area.height - 480) / 2 + offset }, area);
    const window = new this.BrowserWindow({
      ...bounds, frame: false, thickFrame: false, show: false, resizable: false, maximizable: false, movable: true,
      backgroundColor: colors.find(color => color.id === input.color).value, title: `便签 · ${noteTitle(input.text)}`,
      webPreferences: { preload: this.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const entry = { id, widgetId, window, input, ready: false, timer: null, request: null };
    this.entries.set(id, entry);
    window.setMenu(null);
    window.on('close', event => {
      event.preventDefault();
      if (entry.closing) return;
      entry.closing = true;
      void this.requestSave(entry).then(() => window.destroy()).catch(error => this.report(entry, error)).finally(() => { entry.closing = false; });
    });
    window.once('closed', () => {
      clearTimeout(entry.timer);
      if (entry.request) this.finishRequest(entry, new Error('便签窗口已关闭'));
      this.entries.delete(id);
    });
    window.webContents.once('did-finish-load', () => {
      if (window.isDestroyed()) return;
      entry.ready = true;window.show();
      // Windows adjusts initial frameless bounds at fractional DPI; reapply the requested DIP size.
      window.setBounds(bounds, false);window.focus();
    });
    window.webContents.on('render-process-gone', () => {
      entry.ready = false;
      try { this.flush(entry); } catch (error) { this.report(entry, error); }
      this.report(entry, new Error('便签页面意外退出，已收到的内容已尝试保存，请重新加载页面'));
    });
    const loaded = this.devUrl ? window.loadURL(new URL('note.html', this.devUrl).href) : window.loadFile(this.rendererPath);
    void loaded.catch(error => { this.report(entry, error);window.destroy(); });
  }

  requireSender(sender) {
    const entry = [...this.entries.values()].find(entry => !entry.window.isDestroyed() && entry.window.webContents === sender);
    if (!entry || !this.store.list('note').some(widget => widget.id === entry.widgetId)) throw new Error('此操作只能由便签自己的编辑窗口执行');
    return entry;
  }

  get(sender) { const entry = this.requireSender(sender);return { id: entry.id, ...entry.input }; }

  update(sender, input) {
    const entry = this.requireSender(sender);
    entry.input = validateNoteInput(input);
    entry.window.setBackgroundColor(colors.find(color => color.id === entry.input.color).value);
    entry.window.setTitle(`便签 · ${noteTitle(entry.input.text)}`);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { try { this.flush(entry); } catch (error) { this.report(entry, error); } }, 300);
  }

  flush(entry) {
    clearTimeout(entry.timer);entry.timer = null;
    this.store.saveNote(entry.widgetId, { id: entry.id, ...entry.input });
    if (!this.preparingQuit) this.onChange(entry.widgetId);
    entry.window.webContents.send('note:saved');
  }

  save(sender, input, token) {
    const entry = this.requireSender(sender);
    if (token !== undefined && token !== entry.request?.token) throw new Error('便签保存请求已失效');
    try {
      this.update(sender, input);this.flush(entry);
      if (token !== undefined) this.finishRequest(entry);
    } catch (error) {
      if (token !== undefined) this.finishRequest(entry, error);
      throw error;
    }
  }

  close(sender, input) {
    const entry = this.requireSender(sender);
    this.save(sender, input);entry.window.destroy();
  }

  delete(sender) {
    const entry = this.requireSender(sender);
    clearTimeout(entry.timer);entry.timer = null;
    this.store.deleteNote(entry.widgetId, entry.id);
    this.onChange(entry.widgetId);entry.window.destroy();
  }

  requestSave(entry) {
    if (!entry.ready) return Promise.resolve().then(() => this.flush(entry));
    if (entry.request) return entry.request.promise;
    const token = ++this.sequence;
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes;reject = no; });
    entry.request = { token, promise, resolve, reject, timer: setTimeout(() => this.finishRequest(entry, new Error('便签页面未响应，内容未确认保存，请重试')), 5000) };
    entry.window.webContents.send('note:request-save', token);
    return promise;
  }

  finishRequest(entry, error) {
    const request = entry.request;
    if (!request) return;
    clearTimeout(request.timer);entry.request = null;
    if (error) request.reject(error);else request.resolve();
  }

  report(entry, error) {
    if (!entry.window.isDestroyed()) { entry.window.webContents.send('note:error', error.message);entry.window.show();entry.window.focus(); }
    this.onError?.(error);
  }

  async prepareQuit() {
    this.preparingQuit = true;
    // Native teardown can destroy WebContents before the closed listener removes its entry.
    const entries = [...this.entries.values()].filter(entry => !entry.window.isDestroyed());
    // Keep editors frozen until shutdown, including a potentially slow recording save.
    for (const entry of entries) entry.window.webContents.send('note:lock', true);
    try { await Promise.all(entries.map(entry => this.requestSave(entry))); }
    catch (error) {
      this.preparingQuit = false;
      for (const entry of entries) if (!entry.window.isDestroyed()) entry.window.webContents.send('note:lock', false);
      for (const widgetId of new Set(entries.map(entry => entry.widgetId))) this.onChange(widgetId);
      throw error;
    }
  }
  removeWidget(widgetId) { for (const entry of [...this.entries.values()]) if (entry.widgetId === widgetId) entry.window.destroy(); }
  closeAll() {
    for (const entry of [...this.entries.values()]) entry.window.destroy();
    for (const event of ['display-removed', 'display-metrics-changed']) this.screen.removeListener(event, this.displayListener);
  }
}
module.exports = { NoteWindows };
