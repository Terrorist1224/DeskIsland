const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { WidgetStore } = require('../src/main/widget-store.cjs');
const { WidgetWindows } = require('../src/main/widget-windows.cjs');

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    this.webContents = new EventEmitter();
    this.messages = [];
    this.webContents.send = (...args) => this.messages.push(args);
    this.visible = false;
    this.destroyed = false;
    FakeWindow.instances.push(this);
  }
  setAlwaysOnTop(value) { this.alwaysOnTop = value; }
  isAlwaysOnTop() { return this.alwaysOnTop; }
  getNativeWindowHandle() { return Buffer.from([1, 0, 0, 0]); }
  setMovable(value) { this.movable = value; }
  setIgnoreMouseEvents(value) { this.ignoreMouse = value; }
  showInactive() { this.visible = true; }
  hide() { this.visible = false; }
  isDestroyed() { return this.destroyed; }
  loadURL() { this.webContents.emit('did-finish-load');return Promise.resolve(); }
  loadFile() { this.webContents.emit('did-finish-load');return Promise.resolve(); }
  getBounds() { return { ...this.bounds }; }
  setPosition(x, y) { this.bounds.x = x; this.bounds.y = y; }
  setBounds(bounds) { this.bounds={...bounds}; this.emit('resize'); }
  close() { this.destroyed = true; this.emit('closed'); }
  destroy() { this.close(); }
}
FakeWindow.instances = [];

test('late page-load callbacks after tile destruction do not resize, send or attach a desktop HWND', async t => {
  const directory=path.join(__dirname,'../.tmp/tests',`late-load-${randomUUID()}`);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const {manager,store}=createHarness(directory);t.after(()=>manager.closeAll());
  class LoadingWindow extends FakeWindow {
    loadFile() { return Promise.resolve(); }
  }
  manager.BrowserWindow=LoadingWindow;
  const widget=store.create('note'),window=manager.show(widget),contents=window.webContents;
  const callbacks=contents.listeners('did-finish-load');
  manager.remove(widget.id);
  window.setBounds=()=>{throw Error('Destroyed window resized');};
  contents.send=()=>{throw Error('Destroyed WebContents used');};
  let installs=0;manager.getWindowsHost=()=>({request:async()=>{installs++;return {installed:true};}});
  for (const callback of callbacks) await callback();
  assert.equal(installs,0);assert.equal(manager.readyWindows.size,0);
});

test('audio keeps rendering when another window is focused without changing other tiles',t=>{
  const directory=path.join(__dirname,'../.tmp/tests',`audio-rendering-${randomUUID()}`);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const {manager,store}=createHarness(directory);t.after(()=>manager.closeAll());
  assert.equal(manager.show(store.create('audio')).options.webPreferences.backgroundThrottling,false);
  assert.equal(manager.show(store.create('weather')).options.webPreferences.backgroundThrottling,true);
});

test('countdown expiry replaces the desktop HWND with a pinned window and acknowledgment restores desktop', async t => {
  const directory=path.join(__dirname,'../.tmp/tests',`countdown-layer-${randomUUID()}`);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const {manager,store}=createHarness(directory);t.after(()=>manager.closeAll());
  const calls=[];
  manager.getWindowsHost=()=>({request:async(method,payload)=>{calls.push([method,payload]);return {installed:true,applied:true};}});
  const widget=store.create('countdown'),window=manager.show(widget);
  await new Promise(resolve=>setImmediate(resolve));
  await manager.setCountdownReminder(widget.id,true);const pinned=manager.windows.get(widget.id);assert.equal(pinned.alwaysOnTop,true);assert.equal(window.destroyed,true);assert.deepEqual(pinned.getBounds(),window.getBounds());
  const count=calls.length;manager.setEditMode(true);manager.setEditMode(false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.slice(count).filter(([method])=>method==='system.lower-widget').length,0);
  await manager.setCountdownReminder(widget.id,false);assert.equal(pinned.destroyed,true);assert.equal(manager.windows.get(widget.id).alwaysOnTop,false);
  assert.equal(window.options.movable,false);
  assert.equal(window.listenerCount('will-move'),0);
  assert.equal(manager.reminderWindows.size,0);
});

function createHarness(directory, shouldPause = false) {
  FakeWindow.instances = [];
  const store = new WidgetStore(directory);
  const display = { id: 2, workArea: { x: -1280, y: 0, width: 1280, height: 720 } };
  const cursor={x:-1200,y:40};
  const manager = new WidgetWindows({
    BrowserWindow: FakeWindow,
    screen: { getDisplayNearestPoint: () => display, getAllDisplays: () => [display],getCursorScreenPoint:()=>({...cursor}) },
    store,
    getWindowsHost: () => ({ request: async () => ({ shouldPause,installed:true }) }),
    preloadPath: 'preload.cjs',
    rendererPath: 'widget.html',
  });
  return { manager, store, cursor };
}

test('music and weather use transparent windows without native backdrop effects', async (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `transparent-${randomUUID()}`);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { manager, store } = createHarness(directory);
  t.after(() => manager.closeAll());
  const requests = [];
  manager.getWindowsHost = () => ({ request: async method => { requests.push(method);return { installed: true }; } });
  for (const type of ['music', 'weather']) {
    const window = manager.show(store.create(type));
    assert.equal(window.options.transparent, true);
    assert.equal(window.options.backgroundMaterial, 'none');
    window.emit('ready-to-show');
    window.emit('restore');
    window.emit('resize');
  }
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.ok(!requests.includes('system.window-glass'));
});

test('weather master switch controls all enabled instances while preserving disabled rows and music', async (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `weather-group-${randomUUID()}`);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { manager, store } = createHarness(directory);
  t.after(() => manager.closeAll());
  const music = store.create('music');
  const first = store.create('weather');
  const second = store.create('weather');
  const inactive = store.create('weather', undefined, 'standard', false);
  await manager.restore();
  assert.deepEqual([...manager.windows.keys()], [music.id, first.id, second.id]);
  const musicWindow = manager.windows.get(music.id);
  store.setWeatherEnabled(false);
  manager.syncWeather();
  assert.deepEqual([...manager.windows.keys()], [music.id]);
  manager.show(store.setEnabled(inactive.id, true));
  manager.replace(store.setVariant(second.id, 'standard'));
  assert.deepEqual([...manager.windows.keys()], [music.id]);
  store.setEnabled(first.id, false);
  store.setWeatherEnabled(true);
  manager.syncWeather();
  assert.deepEqual([...manager.windows.keys()], [music.id, second.id, inactive.id]);
  assert.equal(manager.windows.get(music.id), musicWindow);
  manager.closeAll();
  await manager.restore();
  assert.deepEqual([...manager.windows.keys()], [music.id, second.id, inactive.id]);
  store.remove(second.id);
  manager.remove(second.id);
  assert.ok(manager.windows.has(inactive.id));
});

test('disabled tiles stay closed on restore and variant changes, and can be re-enabled', async (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `disabled-${randomUUID()}`);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { manager, store } = createHarness(directory);
  t.after(() => manager.closeAll());
  const widget = store.create('music');
  store.setEnabled(widget.id, false);
  await manager.restore();
  assert.equal(manager.windows.size, 0);
  manager.replace(store.setVariant(widget.id, 'wide'));
  assert.equal(manager.windows.size, 0);
  manager.show(store.setEnabled(widget.id, true));
  assert.equal(manager.windows.size, 1);
  store.setEnabled(widget.id, false);
  manager.remove(widget.id);
  assert.equal(manager.windows.size, 0);
  assert.equal(store.list()[0].variantId, 'wide');
});

test('pointer gesture moves smoothly, snaps both axes and saves only on release', async (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `windows-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new WidgetStore(directory);
  const origin = { x: -1280, y: 40, width: 1280, monitorId: '2' };
  const music = store.create('music', origin);
  const weather = store.create('weather', origin);
  const { manager, cursor } = createHarness(directory);
  t.after(() => manager.closeAll());

  await manager.restore();
  manager.setEditMode(true);
  const weatherWindow = FakeWindow.instances.find((window) => window.options.x === weather.x);
  assert.ok(weatherWindow.visible);
  const before=weatherWindow.getBounds();
  const token=manager.beginGesture(weatherWindow.webContents,'move');
  cursor.x+=37;cursor.y+=51;
  await new Promise(resolve=>setTimeout(resolve,35));
  assert.equal(weatherWindow.getBounds().x,before.x+37);
  assert.equal(new WidgetStore(directory).list().find(item=>item.id===weather.id).x,weather.x);
  manager.endGesture(weatherWindow.webContents,token,true);

  const saved = new WidgetStore(directory).list().find((widget) => widget.id === weather.id);
  assert.equal(Math.abs(saved.x%16),0);
  assert.equal(saved.y%16,0);
  assert.notEqual(saved.x,weather.x);
  manager.closeAll();
});

test('normal mode locks movement; editing creates click-through grids and restores locks', async (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `editing-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { manager, store } = createHarness(directory);
  t.after(() => manager.closeAll());
  const widget = store.create('music', { x: -1200, y: 40, width: 1280, monitorId: '2' });
  const window = manager.show(widget);
  assert.equal(window.options.movable, false);
  assert.equal(window.alwaysOnTop, false);
  assert.equal(window.options.minimizable, false);
  assert.equal(window.options.focusable,false);
  let prevented = false;
  window.emit('will-move', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  window.emit('move');
  assert.throws(()=>manager.beginGesture(window.webContents,'move'),/编辑模式/);
  manager.setEditMode(true);
  assert.equal(window.options.movable, false);
  assert.equal(manager.overlays.length, 1);
  const overlay = manager.overlays[0];
  assert.equal(overlay.ignoreMouse, true);
  assert.deepEqual(overlay.bounds, { x: -1280, y: 0, width: 1280, height: 720 });
  const start=window.getBounds();
  const token=manager.beginGesture(window.webContents,'se');
  assert.throws(()=>manager.endGesture(new EventEmitter(),token,true),/自己的窗口/);
  window.bounds.width=400;
  manager.setEditMode(false);
  assert.equal(window.options.movable, false);
  assert.equal(overlay.destroyed, true);
  assert.equal(manager.overlays.length, 0);
  assert.equal(manager.gesture, null);
  assert.deepEqual(window.getBounds(),start);
  assert.equal(store.list()[0].x,start.x);
  assert.ok(window.messages.some(message=>message[0]==='desktop:edit-mode' && message[1]===false));
});

test('keeps desktop tiles painted while a fullscreen app pauses background updates', async (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `paused-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new WidgetStore(directory);
  store.create('music', { x: -1280, y: 40, width: 1280, monitorId: '2' });
  const { manager } = createHarness(directory, true);
  t.after(() => manager.closeAll());

  await manager.restore();
  assert.equal(FakeWindow.instances[0].visible, true);
  assert.ok(FakeWindow.instances[0].messages.some(message=>message[0]==='widget:active' && message[1]===false));
  manager.closeAll();
});

test('restore uses current variants after the asynchronous system check; old close events do not remove replacements', async (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `restore-race-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { manager, store } = createHarness(directory);
  t.after(() => manager.closeAll());
  const widget = store.create('music', { x: -1200, y: 40, width: 1280, monitorId: '2' });
  let resolvePause;
  manager.getWindowsHost = () => ({ request: () => new Promise(resolve => { resolvePause = resolve; }) });
  const restoring = manager.restore();
  store.setVariant(widget.id, 'wide');
  resolvePause({ shouldPause: false });
  await restoring;
  const oldWindow = manager.windows.get(widget.id);
  assert.equal(oldWindow.options.width, 416);
  manager.replace(store.setVariant(widget.id, 'square'));
  const replacement = manager.windows.get(widget.id);
  oldWindow.emit('closed');
  assert.equal(manager.windows.get(widget.id), replacement);
  assert.equal(replacement.options.width, 240);
});

test('desktop transitions pause timers without hiding, showing or recreating either tile', async (t) => {
  t.mock.timers.enable({apis:['setInterval']});
  const directory=path.join(__dirname,'../.tmp/tests',`desktop-transition-${randomUUID()}`);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const {manager,store}=createHarness(directory);
  t.after(()=>manager.closeAll());
  store.create('music');store.create('weather');
  let paused=false;
  manager.getWindowsHost=()=>({request:async()=>({shouldPause:paused,installed:true})});
  await manager.restore();
  await new Promise(resolve=>setImmediate(resolve));
  const windows=[...manager.windows.values()];
  for(const window of windows){window.hide=()=>assert.fail('desktop transition must not hide a tile');window.showInactive=()=>assert.fail('desktop transition must not reshow a tile');}
  for(let cycle=0;cycle<6;cycle++) {
    paused=!paused;t.mock.timers.tick(1500);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(manager.paused,paused);
    assert.deepEqual([...manager.windows.values()],windows);
    for(const window of windows){assert.equal(window.visible,true);assert.deepEqual(window.messages.at(-1),['widget:active',!paused]);}
  }
});

test('gesture identity, cancellation and persistence failure restore the original window', async (t) => {
  const directory=path.join(__dirname,'../.tmp/tests',`gesture-${randomUUID()}`);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const {manager,store,cursor}=createHarness(directory);
  t.after(()=>manager.closeAll());
  const widget=store.create('music',{x:-1200,y:64,width:1280,monitorId:'2'});
  const window=manager.show(widget);
  manager.setEditMode(true);
  assert.throws(()=>manager.beginGesture(new EventEmitter(),'move'),/自己的窗口/);
  assert.throws(()=>manager.beginGesture(window.webContents,'unknown'),TypeError);
  const start=window.getBounds();
  let token=manager.beginGesture(window.webContents,'se');
  cursor.x+=80;cursor.y+=80;
  await new Promise(resolve=>setTimeout(resolve,35));
  assert.equal(window.getBounds().width,320);
  assert.equal(manager.endGesture(window.webContents,token+1,true),null);
  assert.ok(manager.gesture);
  manager.endGesture(window.webContents,token,false);
  assert.deepEqual(window.getBounds(),start);
  assert.equal(new WidgetStore(directory).list()[0].width,240);
  token=manager.beginGesture(window.webContents,'move');
  cursor.x+=80;
  fs.mkdirSync(`${store.filePath}.tmp`);
  assert.throws(()=>manager.endGesture(window.webContents,token,true));
  assert.deepEqual(window.getBounds(),start);
  assert.equal(store.list()[0].x,start.x);
  assert.equal(manager.gesture,null);
});

test('cross-display drag uses the destination lattice and renderer reload cancels a session', async (t) => {
  const directory=path.join(__dirname,'../.tmp/tests',`cross-display-${randomUUID()}`);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const {manager,store,cursor}=createHarness(directory);
  t.after(()=>manager.closeAll());
  const displays=[{id:1,scaleFactor:1.25,workArea:{x:-1280,y:0,width:1280,height:720}},{id:2,scaleFactor:1.5,workArea:{x:0,y:23,width:1707,height:1004}}];
  manager.screen.getDisplayNearestPoint=point=>displays[point.x<0?0:1];
  const widget=store.create('music',{x:-1200,y:64,width:1280,monitorId:'1'});
  const window=manager.show(widget);
  manager.setEditMode(true);
  let token=manager.beginGesture(window.webContents,'move');
  cursor.x+=1500;cursor.y+=51;
  const saved=manager.endGesture(window.webContents,token,true);
  assert.equal(saved.monitorId,'2');
  assert.equal(saved.x%16,0);
  assert.equal((saved.y-23)%16,0);
  const committed=window.getBounds();
  token=manager.beginGesture(window.webContents,'se');
  cursor.x+=64;cursor.y+=64;
  await new Promise(resolve=>setTimeout(resolve,35));
  window.webContents.emit('did-start-loading');
  assert.equal(manager.gesture,null);
  assert.deepEqual(window.getBounds(),committed);
  assert.equal(manager.endGesture(window.webContents,token,true),null);
  assert.equal(new WidgetStore(directory).list()[0].width,saved.width);
});

test('desktop ownership is installed before showing; initialization failure keeps the tile hidden',async(t)=>{
  const directory=path.join(__dirname,'../.tmp/tests',`desktop-owner-${randomUUID()}`);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const {manager,store}=createHarness(directory);
  t.after(()=>manager.closeAll());
  const errors=[];manager.onDesktopError=message=>errors.push(message);
  let install;
  manager.getWindowsHost=()=>({request:method=>method==='system.desktop-widget'?new Promise(resolve=>{install=resolve;}):Promise.resolve({shouldPause:false})});
  const window=manager.show(store.create('music'));
  assert.equal(window.visible,false);
  assert.equal(window.options.focusable,false);
  install({installed:false});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(window.visible,false);assert.equal(manager.readyWindows.size,0);
  assert.equal(errors.length,1);
});
