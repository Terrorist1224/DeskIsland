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

test('startup IPC requires control window and boolean input, then returns actual system state', () => {
  const control = {};
  let enabled = false;
  registerHandlers({ getControlWindow: () => ({ webContents: control }),
    getAppInfo: () => ({ version: '1.0.1' }),
    getStartupSettings: () => ({ supported: true, enabled }),
    setStartupSettings: value => ({ supported: true, enabled: enabled = value }),
  });
  const get = handlers.get('app:get-startup'), set = handlers.get('app:set-startup');
  assert.deepEqual(handlers.get('app:info')(), { version: '1.0.1' });
  assert.throws(() => get({ sender: {} }), /主窗口/);
  assert.throws(() => set({ sender: {} }, true), /主窗口/);
  assert.throws(() => set({ sender: control }, 'true'), /Invalid/);
  assert.equal(set({ sender: control }, true).enabled, true);
  assert.equal(get({ sender: control }).enabled, true);
  unregisterWidgetHandlers();
  assert.equal(handlers.size, 0);
});
