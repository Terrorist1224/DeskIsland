const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { getWindowHandle, installLegacyGlass, supportsNativeAcrylic } = require('../src/main/window-glass.cjs');

test('untinted reminders request accent blur even on Acrylic systems and keep a transparent failure fallback', async () => {
  if (process.platform !== 'win32') return;
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.isMinimized = () => false;
  window.getNativeWindowHandle = () => Buffer.from([1, 0, 0, 0]);
  let payload, background;
  window.setBackgroundColor = value => { background = value; };
  installLegacyGlass(window, () => ({ request: async (_method, value) => { payload = value;throw new Error('测试模糊不可用'); } }), true, true);
  window.emit('ready-to-show');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(payload, { handle: '1', blur: true });
  assert.equal(background, '#00000000');
  window.emit('closed');
});

test('transparent tiles disable rectangular accent blur', () => {
  if (process.platform !== 'win32' || supportsNativeAcrylic) return;
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.isMinimized = () => false;
  window.getNativeWindowHandle = () => Buffer.from([1, 0, 0, 0]);
  let payload;
  installLegacyGlass(window, () => ({ request: async (_method, value) => { payload = value; } }), false);
  window.emit('ready-to-show');
  assert.deepEqual(payload, { handle: '1', blur: false });
  window.emit('closed');
});

test('native HWND serialization preserves both 32-bit and 64-bit handles', () => {
  const large = Buffer.alloc(8);
  large.writeBigUInt64LE(0x123456789abcdefn);
  assert.equal(getWindowHandle({ getNativeWindowHandle: () => large }), '81985529216486895');
  assert.equal(getWindowHandle({ getNativeWindowHandle: () => Buffer.from([0x78, 0x56, 0x34, 0x12]) }), '305419896');
});

test('legacy blur uses only the supplied window handle and stops scheduled work after close', async () => {
  if (process.platform !== 'win32' || supportsNativeAcrylic) return;
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.isMinimized = () => false;
  window.getNativeWindowHandle = () => Buffer.from([1, 0, 0, 0]);
  const calls = [];
  installLegacyGlass(window, () => ({ request: async (method, payload) => { calls.push({ method, payload }); } }));
  window.emit('ready-to-show');
  assert.deepEqual(calls, [{ method: 'system.window-glass', payload: { handle: '1', blur: true } }]);
  window.emit('resize');
  window.emit('closed');
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(calls.length, 1);
});

test('legacy rounded clipping skips minimized windows and reapplies after restore', async (t) => {
  if (process.platform !== 'win32' || supportsNativeAcrylic) return;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const window = new EventEmitter();
  let minimized = false;
  window.isDestroyed = () => false;
  window.isMinimized = () => minimized;
  window.getNativeWindowHandle = () => Buffer.from([1, 0, 0, 0]);
  const calls = [];
  installLegacyGlass(window, () => ({ request: async method => { calls.push(method); } }));
  window.emit('ready-to-show');
  assert.equal(calls.length, 1);
  window.emit('resize');
  minimized = true;
  t.mock.timers.tick(100);
  assert.equal(calls.length, 1, 'minimized titlebar bounds must never become the clipping region');
  minimized = false;
  window.emit('restore');
  assert.equal(calls.length, 2);
  window.emit('closed');
});
