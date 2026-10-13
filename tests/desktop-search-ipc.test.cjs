const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const handlers = new Map();
const load = Module._load;
Module._load = function(name, ...args) {
  if (name === 'electron') return { ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) } };
  return load.call(this, name, ...args);
};
const { registerHandlers, unregisterWidgetHandlers } = require('../src/main/ipc.cjs');
Module._load = load;

test('only enabled search tiles open the search window, and lifecycle actions close it', async () => {
  const tile = {}, control = {};
  let widget = { id: 'search', typeId: 'desktop-search', enabled: true };
  const calls = [];
  const widgetWindows = { editMode: false, windows: new Map([['search', { webContents: tile, isDestroyed: () => false, getBounds: () => ({ width: 320 }) }]]), remove: () => {} };
  registerHandlers({
    getControlWindow: () => ({ webContents: control }), widgetWindows,
    store: { list: () => [widget], setEnabled: (_id, enabled) => (widget = { ...widget, enabled }) },
    desktopSearch: { show: bounds => calls.push(bounds), close: () => calls.push('close') },
  });
  const show = handlers.get('desktop-search:show');
  assert.throws(() => show({ sender: control }), /开启的桌面搜索/);
  show({ sender: tile });assert.deepEqual(calls, [widgetWindows.windows.get('search')]);
  widgetWindows.editMode = true;assert.throws(() => show({ sender: tile }), /开启的桌面搜索/);
  widgetWindows.editMode = false;
  handlers.get('widgets:set-enabled')({ sender: control }, 'search', false);
  assert.equal(calls.at(-1), 'close');
  assert.throws(() => show({ sender: tile }), /开启的桌面搜索/);
  unregisterWidgetHandlers();assert.equal(handlers.size, 0);
});
