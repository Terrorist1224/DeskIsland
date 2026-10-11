const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const handlers = new Map();
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'electron') return { ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) } };
  return originalLoad.call(this, name, ...args);
};
const { registerHandlers, unregisterWidgetHandlers } = require('../src/main/ipc.cjs');
Module._load = originalLoad;
const fs = require('node:fs');
const path = require('node:path');
const { WidgetStore } = require('../src/main/widget-store.cjs');

test('location saves persist after navigation, reject duplicates, and keep independent tiles separate', async t => {
  const directory = fs.mkdtempSync(path.join(__dirname, '../.tmp/weather-save-'));
  t.after(() => { unregisterWidgetHandlers(); fs.rmSync(directory, { recursive: true }); });
  const store = new WidgetStore(directory);
  const first = store.create('weather', undefined, 'standard', false);
  const second = store.create('weather', undefined, 'standard', false);
  const control = {}, resolutions = [], notifications = [];
  registerHandlers({ store, getControlWindow: () => ({ webContents: control }),
    weatherService: { resolveRegion: region => new Promise(resolve => resolutions.push(() => resolve({ name: region.at(-1).name, regionCodes: region.map(item => item.code), latitude: 28, longitude: 113 }))) },
    widgetWindows: { windows: new Map([first, second].map(widget => [widget.id, { webContents: { send: channel => notifications.push([widget.id, channel]) } }])) },
  });
  const save = handlers.get('weather:save-location');
  const event = { sender: control };
  await assert.rejects(save({ sender: {} }, first.id, '430105'), /主窗口/);
  for (const code of [null, {}, 'invalid', '43']) await assert.rejects(save(event, first.id, code));
  await assert.rejects(save(event, '', '430105'), /Invalid/);
  await assert.rejects(save(event, 'missing', '430105'), /找不到/);
  const pending = save(event, first.id, '430105');
  await assert.rejects(save(event, first.id, '430105'), /正在保存/);
  const other = save(event, second.id, '330106');
  assert.equal(resolutions.length, 2);
  // Navigation has no main-process cancellation step; complete in reverse order.
  resolutions[1]();
  const otherLocation = await other;
  resolutions[0]();
  const location = await pending;
  const restored = new WidgetStore(directory).list();
  assert.deepEqual(restored.find(item => item.id === first.id).settings.location, location);
  assert.deepEqual(restored.find(item => item.id === second.id).settings.location, otherLocation);
  assert.equal(notifications.length, 2);
});

test('failed or deleted location saves preserve old data and release the pending lock', async t => {
  const directory = fs.mkdtempSync(path.join(__dirname, '../.tmp/weather-save-'));
  t.after(() => { unregisterWidgetHandlers(); fs.rmSync(directory, { recursive: true }); });
  const store = new WidgetStore(directory);
  const widget = store.create('weather', undefined, 'standard', false);
  const oldLocation = { name: '测试旧地址', latitude: 20, longitude: 110 };
  const newLocation = { name: '测试新地址', latitude: 28, longitude: 113 };
  store.updateSettings(widget.id, { location: oldLocation });
  const control = {};
  let resolveRegion = async () => { throw new Error('解析失败'); };
  registerHandlers({ store, getControlWindow: () => ({ webContents: control }),
    weatherService: { resolveRegion: () => resolveRegion() }, widgetWindows: { windows: new Map() },
  });
  const save = () => handlers.get('weather:save-location')({ sender: control }, widget.id, '430105');
  await assert.rejects(save(), /解析失败/);
  const originalWrite = fs.renameSync;
  fs.renameSync = () => { throw new Error('写入失败'); };
  resolveRegion = async () => newLocation;
  try { await assert.rejects(save(), /写入失败/); } finally { fs.renameSync = originalWrite; }
  assert.deepEqual(store.list()[0].settings.location, oldLocation);
  assert.deepEqual(new WidgetStore(directory).list()[0].settings.location, oldLocation);
  await save();
  assert.deepEqual(store.list()[0].settings.location, newLocation);
  let complete;
  resolveRegion = () => new Promise(resolve => { complete = resolve; });
  const pending = save();
  store.remove(widget.id);
  complete(newLocation);
  await assert.rejects(pending, /找不到/);
  assert.equal(new WidgetStore(directory).list().length, 0);
});

test('disabled instances and category cannot fetch; settings saves never prefetch; main cannot fetch as a tile', () => {
  const control = {}, sender = {}, location = { name: 'Test', latitude: 20, longitude: 110 };
  let enabled = false, category = true, calls = 0;
  const widget = () => ({ id: 'weather-test', typeId: 'weather', enabled, settings: { location } });
  registerHandlers({
    store: { list: () => [widget()], isVisible: item => item.enabled && category, updateSettings: () => true },
    getControlWindow: () => ({ webContents: control }),
    widgetWindows: { windows: new Map([['weather-test', { webContents: Object.assign(sender, { send() {} }) }]]) },
    weatherService: { getWeather: value => { calls++; assert.equal(value, location); return 'test snapshot'; } },
  });
  const get = handlers.get('weather:get'), save = handlers.get('widgets:update-settings');
  assert.equal(save({ sender: control }, 'weather-test', { location }), true);
  assert.equal(calls, 0);
  assert.throws(() => get({ sender }), /已启用/);
  enabled = true; category = false;
  assert.throws(() => get({ sender }), /已启用/);
  category = true;
  assert.throws(() => get({ sender: control }), /已启用/);
  assert.equal(get({ sender }, { latitude: 0, longitude: 0 }), 'test snapshot');
  assert.equal(calls, 1);
  unregisterWidgetHandlers();
});
