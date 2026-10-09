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
