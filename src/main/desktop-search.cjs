const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class DesktopSearch {
  constructor({ screen, getWindowsHost, getFileIcon, openPath }) {
    Object.assign(this, { screen, getWindowsHost, getFileIcon, openPath });
    this.session = null;
  }

  show(window) {
    if (this.session) {
      this.session.window.focus();
      return;
    }
    const origin = window.getBounds();
    const session = { window, origin, items: new Map(), icons: new Map(), snapshot: null, opening: false };
    this.session = session;
    // Launching a file can move focus before Shell reports failure; keep errors visible until it resolves.
    session.onBlur = () => { if (!session.opening && this.session === session) this.close(); };
    session.onInput = (event, input) => {
      if (input.key === 'Escape' && input.type === 'keyDown') { event.preventDefault();this.close(); }
    };
    session.onClose = () => { if (this.session === session) this.close(); };
    window.on('blur', session.onBlur);
    window.on('closed', session.onClose);
    window.webContents.on('before-input-event', session.onInput);
    window.webContents.on('did-start-loading', session.onClose);
    window.webContents.on('render-process-gone', session.onClose);
    window.focus();
  }

  resize(sender, height) {
    const session = this.requireSender(sender);
    if (!Number.isSafeInteger(height) || height < session.origin.height || height > 1400) throw new TypeError('Invalid search height');
    const origin = session.origin;
    const { workArea } = this.screen.getDisplayNearestPoint({ x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 });
    height = Math.min(height, workArea.height);
    // Resize only this known HWND; stored grid geometry remains the collapsed search bar.
    session.window.setBounds({ ...origin, height, y: Math.max(workArea.y, Math.min(origin.y, workArea.y + workArea.height - height)) }, false);
  }

  requireSender(sender) {
    const session = this.session;
    if (!session || session.window.isDestroyed() || session.window.webContents !== sender) throw new Error('此操作只能由展开的桌面搜索磁贴执行');
    return session;
  }

  list(sender) {
    const session = this.requireSender(sender);
    if (!session.snapshot) {
      session.snapshot = this.getWindowsHost().request('desktop.list').then(({ roots, items, warnings, iconSize }) => {
        const desktopIconSize = Number.isInteger(iconSize) && iconSize >= 16 && iconSize <= 256 ? iconSize : 48;
        session.iconSize = desktopIconSize;
        if (this.session !== session) return { items: [], warnings: [], iconSize: desktopIconSize };
        const directories = new Set(roots.map(root => path.resolve(root).toLowerCase()));
        const seen = new Set();
        for (const item of items) {
          const fullPath = path.resolve(item.path);
          const key = fullPath.toLowerCase();
          if (!directories.has(path.dirname(fullPath).toLowerCase()) || seen.has(key)) continue;
          seen.add(key);
          const entry = { id: randomUUID(), name: item.kind === 'shortcut' ? item.name.replace(/\.(lnk|url)$/i, '') : item.name, kind: item.kind, path: fullPath };
          session.items.set(entry.id, entry);
        }
        return { items: [...session.items.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.path.localeCompare(b.path)), warnings, iconSize: desktopIconSize };
      }).catch(error => { session.snapshot = null;throw error; });
    }
    return session.snapshot;
  }

  item(session, id) {
    if (typeof id !== 'string' || !session.items.has(id)) throw new Error('桌面项目已失效，请收起后重新搜索');
    return session.items.get(id);
  }

  icon(sender, id) {
    const session = this.requireSender(sender);
    const item = this.item(session, id);
    if (!session.icons.has(id)) session.icons.set(id, Promise.resolve().then(async () => {
      const origin = session.origin;
      const display = this.screen.getDisplayNearestPoint({ x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 });
      const size = Math.min(512, Math.ceil(Math.min(session.iconSize ?? 48, origin.width - 56) * (display.scaleFactor || 1)));
      try {
        const { dataUrl } = await this.getWindowsHost().request('desktop.icon', { path: item.path, size });
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('Invalid Shell icon');
        return dataUrl;
      } catch {
        return (await this.getFileIcon(item.path, { size: 'normal' })).toDataURL();
      }
    }).catch(() => null));
    return session.icons.get(id);
  }

  async open(sender, id) {
    const session = this.requireSender(sender);
    const item = this.item(session, id);
    if (session.opening) return;
    session.opening = true;
    try {
      await fs.lstat(item.path);
      const error = await this.openPath(item.path);
      if (error) throw new Error(error);
      if (this.session === session) this.close();
    } catch (error) {
      if (this.session === session) { session.window.show();session.window.focus(); }
      throw new Error(`无法打开「${item.name}」：${error.code === 'ENOENT' ? '项目已被移动或删除，请重新搜索' : error.message}`);
    } finally { session.opening = false; }
  }

  close() {
    const session = this.session;
    this.session = null;
    if (!session) return;
    const { window } = session;
    window.removeListener('blur', session.onBlur);
    window.removeListener('closed', session.onClose);
    window.webContents.removeListener('before-input-event', session.onInput);
    window.webContents.removeListener('did-start-loading', session.onClose);
    window.webContents.removeListener('render-process-gone', session.onClose);
    session.items.clear();session.icons.clear();
    if (!window.isDestroyed()) {
      window.setBounds(session.origin, false);
      window.webContents.send('desktop-search:collapsed');
    }
  }
}

module.exports = { DesktopSearch };
