const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { WidgetStore } = require('../src/main/widget-store.cjs');
const { NoteWindows } = require('../src/main/note-windows.cjs');
const colors = require('../src/shared/todo-colors.json');

class FakeWindow extends EventEmitter {
  constructor(options) { super();this.options = options;this.bounds = options;this.webContents = new EventEmitter();this.messages = [];this.webContents.send = (...args) => this.messages.push(args); }
  isDestroyed() { return !!this.destroyed; }
  isMinimized() { return false; }
  restore() {}
  setMenu() {}
  setBackgroundColor(color) { this.color = color; }
  setTitle(title) { this.title = title; }
  setBounds(bounds) { this.bounds = bounds; }
  getBounds() { return this.bounds; }
  show() {}
  focus() { this.focused = true; }
  loadFile() { return Promise.resolve(); }
  loadURL() { return Promise.resolve(); }
  destroy() { this.destroyed = true;this.emit('closed'); }
  close() { let prevented = false;this.emit('close', { preventDefault() { prevented = true; } });if (!prevented) this.destroy(); }
}
function fixture(t) {
  const directory = path.join(__dirname, '../.tmp/tests', `note-${randomUUID()}`);
  const store = new WidgetStore(directory), widget = store.create('note');
  const screen = new EventEmitter();screen.area = { x: -1200, y: 0, width: 1200, height: 900 };
  screen.getCursorScreenPoint = () => ({ x: -500, y: 400 });
  screen.getDisplayNearestPoint = screen.getDisplayMatching = () => ({ workArea: screen.area });
  const changes = [], errors = [];
  const windows = new NoteWindows({ BrowserWindow: FakeWindow, screen, store, preloadPath: 'test', rendererPath: 'test', onChange: id => changes.push(id), onError: error => errors.push(error) });
  t.after(() => { windows.closeAll();fs.rmSync(directory, { recursive: true, force: true }); });
  function open(id) { windows.open(widget.id, id);return [...windows.entries.values()].at(-1); }
  const items = () => store.list('note')[0].settings.items;
  return { directory, store, widget, screen, changes, errors, windows, open, items };
}

test('note store preserves exact text, same titles, colors, order and empty existing notes across restart', t => {
  const { directory, store, widget, items } = fixture(t);
  assert.throws(() => store.create('note'), /最多创建一个/);
  for (const [index, color] of colors.entries()) store.saveNote(widget.id, { id: `test-${index}`, text: ' 同名标题 \r\n测试正文  ', color: color.id });
  assert.equal(items().length, 5);assert.equal(items()[0].text, ' 同名标题 \r\n测试正文  ');
  store.saveNote(widget.id, { id: 'blank-new', text: ' \n ', color: 'blue' });assert.equal(items().length, 5);
  store.saveNote(widget.id, { id: 'test-0', text: '', color: 'pink' });assert.equal(items().length, 5);
  store.moveNote(widget.id, 'test-4', 'test-0');assert.equal(items()[0].id, 'test-4');
  store.moveNote(widget.id, 'test-4', null);assert.equal(items().at(-1).id, 'test-4');
  assert.deepEqual(new WidgetStore(directory).list('note')[0].settings.items, items());
  assert.throws(() => store.updateSettings(widget.id, { items: [] }), /专用操作/);
  assert.throws(() => store.saveNote(widget.id, { id: 'bad', text: '测试', color: 'red' }), /颜色/);
  assert.throws(() => store.moveNote(widget.id, 'missing', null), /已变更/);
});

test('blank windows are discarded; final close saves latest text; existing windows deduplicate without sharing ownership', t => {
  const { windows, open, items } = fixture(t);
  const blank = open();windows.close(blank.window.webContents, { text: '', color: 'blue' });assert.equal(items().length, 0);
  const first = open(), second = open();assert.equal(windows.entries.size, 2);
  windows.update(first.window.webContents, { text: '旧文字', color: 'yellow' });assert.equal(items().length, 0);
  windows.close(first.window.webContents, { text: '首行\n最后一个字', color: 'green' });
  assert.equal(items()[0].text, '首行\n最后一个字');assert.equal(first.window.isDestroyed(), true);
  windows.open(first.widgetId, first.id);const restored = windows.entries.get(first.id);windows.open(first.widgetId, first.id);assert.equal(windows.entries.size, 2);
  assert.deepEqual(windows.get(restored.window.webContents), { id: first.id, text: '首行\n最后一个字', color: 'green' });
  assert.notEqual(windows.get(second.window.webContents).id, first.id);
  assert.throws(() => windows.update({}, { text: '伪造', color: 'blue' }), /自己的编辑窗口/);
  assert.equal(restored.window.options.webPreferences.sandbox, true);assert.equal(restored.window.options.webPreferences.nodeIntegration, false);
});

test('autosave merges rapid inputs and deletion rejects late updates instead of resurrecting a note', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { windows, open, items, changes } = fixture(t), entry = open();
  for (const text of ['测', '测试', '测试最新版']) windows.update(entry.window.webContents, { text, color: 'orange' });
  t.mock.timers.tick(299);assert.equal(items().length, 0);t.mock.timers.tick(1);
  assert.equal(items()[0].text, '测试最新版');assert.equal(changes.length, 1);
  windows.update(entry.window.webContents, { text: '待保存', color: 'pink' });windows.delete(entry.window.webContents);
  t.mock.timers.tick(1000);assert.equal(items().length, 0);
  assert.throws(() => windows.update(entry.window.webContents, { text: '迟到', color: 'blue' }), /自己的编辑窗口/);
});

test('write failure retains old disk data and live text, blocks close and can be retried', t => {
  const { windows, open, store, items, directory } = fixture(t), entry = open();
  windows.save(entry.window.webContents, { text: '原内容', color: 'blue' });
  const original = fs.readFileSync(path.join(directory, 'deskisland.json'), 'utf8');
  const rename = fs.renameSync;fs.renameSync = () => { throw new Error('测试写入失败'); };
  try {
    assert.throws(() => windows.close(entry.window.webContents, { text: '未丢失的新内容', color: 'green' }), /测试写入失败/);
    assert.equal(entry.window.isDestroyed(), false);assert.equal(items()[0].text, '原内容');
    assert.equal(windows.get(entry.window.webContents).text, '未丢失的新内容');
    assert.equal(fs.readFileSync(path.join(directory, 'deskisland.json'), 'utf8'), original);
    assert.throws(() => windows.delete(entry.window.webContents), /测试写入失败/);assert.equal(entry.window.isDestroyed(), false);
  } finally { fs.renameSync = rename; }
  store.setEnabled(entry.widgetId, false);
  windows.close(entry.window.webContents, { text: '重试成功', color: 'green' });assert.equal(items()[0].text, '重试成功');
});

test('native close and app quit collect current renderer text before releasing windows', async t => {
  const { windows, open, items } = fixture(t), first = open();
  first.window.webContents.emit('did-finish-load');
  first.window.close();assert.equal(first.window.isDestroyed(), false);
  const token = first.window.messages.find(message => message[0] === 'note:request-save')[1];
  windows.save(first.window.webContents, { text: 'Alt+F4 最后一个字', color: 'yellow' }, token);
  await new Promise(resolve => setImmediate(resolve));assert.equal(first.window.isDestroyed(), true);
  const second = open();second.window.webContents.emit('did-finish-load');
  const quitting = windows.prepareQuit();assert.equal(second.window.isDestroyed(), false);
  assert.ok(second.window.messages.some(message => message[0] === 'note:lock' && message[1] === true));
  windows.save(second.window.webContents, { text: '退出前最后一个字', color: 'pink' }, second.request.token);
  await quitting;assert.equal(items().at(-1).text, '退出前最后一个字');assert.equal(second.window.isDestroyed(), false);
});

test('quit skips an already destroyed editor before its closed callback, and ignores late page readiness', async t => {
  const {windows,open,items}=fixture(t),entry=open();
  windows.save(entry.window.webContents,{text:'关闭前已保存的最后一个字',color:'blue'});
  entry.window.destroyed=true;
  entry.window.webContents.send=()=>{throw Error('Destroyed WebContents used');};
  entry.window.show=()=>{throw Error('Destroyed window shown');};
  assert.doesNotThrow(()=>entry.window.webContents.emit('did-finish-load'));
  await windows.prepareQuit();
  assert.equal(items()[0].text,'关闭前已保存的最后一个字');
});

test('failed quit snapshot rejects shutdown and leaves editor available for retry', async t => {
  const { windows, open } = fixture(t), entry = open();entry.window.webContents.emit('did-finish-load');
  const quitting = windows.prepareQuit(), rejected = assert.rejects(quitting, /测试写入失败/);
  const rename = fs.renameSync;fs.renameSync = () => { throw new Error('测试写入失败'); };
  try { assert.throws(() => windows.save(entry.window.webContents, { text: '仍保留', color: 'blue' }, entry.request.token), /测试写入失败/); }
  finally { fs.renameSync = rename; }
  await rejected;assert.equal(entry.window.isDestroyed(), false);assert.equal(windows.get(entry.window.webContents).text, '仍保留');
  assert.ok(entry.window.messages.some(message => message[0] === 'note:lock' && message[1] === false));
});

test('corrupt note records fail startup without replacing the original file', t => {
  const { directory, store, widget } = fixture(t);
  store.saveNote(widget.id, { id: 'test', text: '测试', color: 'blue' });
  const file = path.join(directory, 'deskisland.json'), data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.widgets[0].settings.items.push({ id: 'test', text: '重复标识', color: 'green' });
  const original = JSON.stringify(data);fs.writeFileSync(file, original);
  assert.throws(() => new WidgetStore(directory), /Duplicate note id/);assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('windows remain reachable on negative-coordinate displays and small work areas', t => {
  const { screen, open } = fixture(t), entry = open();
  assert.equal(entry.window.bounds.width, 600);assert.equal(entry.window.bounds.height, 480);assert.ok(entry.window.bounds.x < 0);
  screen.area = { x: 0, y: 0, width: 400, height: 300 };screen.emit('display-removed');
  assert.deepEqual(entry.window.bounds, { x: 0, y: 0, width: 400, height: 300 });
});

test('closing an editor before page readiness reports write failure without crashing or destroying it', async t => {
  const { windows, open, store, errors } = fixture(t), entry = open();
  windows.update(entry.window.webContents, { text: '测试页面未就绪', color: 'blue' });
  const save = store.saveNote;store.saveNote = () => { throw new Error('测试冷启动保存失败'); };
  try {
    assert.doesNotThrow(() => entry.window.close());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(entry.window.isDestroyed(), false);assert.equal(errors[0].message, '测试冷启动保存失败');
  } finally { store.saveNote = save; }
});
