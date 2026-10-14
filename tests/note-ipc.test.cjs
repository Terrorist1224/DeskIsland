const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { WidgetStore } = require('../src/main/widget-store.cjs');
const handlers = new Map(), originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'electron') return { ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) } };
  return originalLoad.call(this, name, ...args);
};
const { registerHandlers, unregisterWidgetHandlers } = require('../src/main/ipc.cjs');Module._load = originalLoad;

test('note list IPC accepts only enabled note tile and editor channels stay separately authorized', t => {
  const directory = path.join(__dirname, '../.tmp/tests', `note-ipc-${randomUUID()}`);
  t.after(() => { unregisterWidgetHandlers();fs.rmSync(directory, { recursive: true, force: true }); });
  const store = new WidgetStore(directory), note = store.create('note'), todo = store.create('todo');
  const noteSender = { send() {} }, todoSender = {}, editorSender = {}, controlSender = {};
  const widgetWindows = { editMode: false, windows: new Map([[note.id, { webContents: noteSender, isDestroyed: () => false }], [todo.id, { webContents: todoSender, isDestroyed: () => false }]]) };
  let opened = false;
  const noteWindows = { open: id => { assert.equal(id, note.id);opened = true; }, get: sender => { if (sender !== editorSender) throw new Error('编辑窗口');return { text: '测试' }; } };
  registerHandlers({ store, widgetWindows, noteWindows, getControlWindow: () => ({ webContents: controlSender }) });
  for (const sender of [todoSender, editorSender, controlSender, {}]) assert.throws(() => handlers.get('note:open')({ sender }), /便签磁贴/);
  handlers.get('note:open')({ sender: noteSender });assert.equal(opened, true);
  store.saveNote(note.id, { id: 'test', text: '测试', color: 'blue' });
  assert.equal(handlers.get('note:move')({ sender: noteSender }, 'test', null)[0].id, 'test');
  for (const sender of [todoSender, noteSender, controlSender, {}]) assert.throws(() => handlers.get('note:get')({ sender }), /编辑窗口/);
  assert.equal(handlers.get('note:get')({ sender: editorSender }).text, '测试');
  widgetWindows.editMode = true;assert.throws(() => handlers.get('note:open')({ sender: noteSender }), /便签磁贴/);
  widgetWindows.editMode = false;store.setEnabled(note.id, false);assert.throws(() => handlers.get('note:move')({ sender: noteSender }, 'test', null), /便签磁贴/);
  unregisterWidgetHandlers();assert.equal(handlers.size, 0);
});
