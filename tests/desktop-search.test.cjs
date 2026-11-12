const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DesktopSearch } = require('../src/main/desktop-search.cjs');

class FakeWindow extends EventEmitter {
  constructor(options = { x: -1100, y: 100, width: 320, height: 64 }) { super();this.bounds = options;this.webContents = new EventEmitter();this.messages = [];this.webContents.send = (...args) => this.messages.push(args);this.destroyed = false;this.focusCount = 0; }
  getNativeWindowHandle() { return Buffer.from([1,0,0,0]); }
  hookWindowMessage(message, callback) { this.nativeMessage = message;this.nativeCallback = callback; }
  unhookWindowMessage() { this.nativeCallback = null; }
  outsideClick(token) { const buffer = Buffer.alloc(8);buffer.writeUInt32LE(token);this.nativeCallback?.(buffer); }
  getBounds() { return { ...this.bounds }; }
  setBounds(bounds) { this.bounds = { ...bounds }; }
  show() { this.visible = true; }
  focus() { this.focusCount++; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true;this.emit('closed'); }
}

async function harness(t) {
  const root = path.resolve('.tmp/tests', `desktop-search-${randomUUID()}`);
  const personal = path.join(root, '个人桌面'), common = path.join(root, '公共桌面');
  fs.mkdirSync(personal, { recursive: true });fs.mkdirSync(common);
  fs.mkdirSync(path.join(personal, 'QQ资料'));
  fs.writeFileSync(path.join(personal, 'QQ资料', 'QQ内部.txt'), '测试占位');
  for (const [dir, name] of [[personal, 'QQ音乐.lnk'], [personal, '文档.txt'], [common, 'QQ音乐.lnk']]) fs.writeFileSync(path.join(dir, name), '测试占位');
  const snapshot = { roots: [personal, common], warnings: [], items: [
    { name: 'QQ音乐.lnk', path: path.join(personal, 'QQ音乐.lnk'), kind: 'shortcut' },
    { name: 'QQ资料', path: path.join(personal, 'QQ资料'), kind: 'folder' },
    { name: '文档.txt', path: path.join(personal, '文档.txt'), kind: 'file' },
    { name: 'QQ音乐.lnk', path: path.join(common, 'QQ音乐.lnk'), kind: 'shortcut' },
    { name: 'QQ内部.txt', path: path.join(personal, 'QQ资料', 'QQ内部.txt'), kind: 'file' },
  ] };
  const calls = { list: 0, icon: 0, opened: [] };
  const manager = new DesktopSearch({
    screen: { getDisplayNearestPoint: () => ({ workArea: { x: -1200, y: 40, width: 1200, height: 800 } }) },
    getWindowsHost: () => ({ request: async method => { if(method === 'desktop.watch-start') return {started:true};if(method === 'desktop.watch-stop') return {stopped:true};if(method === 'desktop.icon') throw new Error('test Shell unavailable');assert.equal(method, 'desktop.list');calls.list++;return snapshot; } }),
    getFileIcon: async () => { calls.icon++;return { toDataURL: () => 'data:image/png;base64,test' }; },
    openPath: async file => { calls.opened.push(file);return ''; },
  });
  t.after(() => { manager.close();fs.rmSync(root, { recursive: true, force: true }); });
  await manager.show(new FakeWindow());
  return { manager, snapshot, calls, sender: manager.session.window.webContents, personal, common };
}

test('search snapshots contain only desktop children and preserve same-name public entries', async t => {
  const { manager, snapshot, calls, sender, personal } = await harness(t);
  snapshot.items.push(snapshot.items[0]);
  const result = await manager.list(sender);
  assert.equal(result.items.length, 4);
  assert.equal(result.items.filter(item => item.name === 'QQ音乐').length, 2);
  assert.equal(result.items.find(item => item.path === path.join(personal, '文档.txt')).name, '文档.txt');
  assert.ok(!result.items.some(item => item.name === 'QQ内部.txt'));
  await manager.list(sender);assert.equal(calls.list, 1);
  const item = result.items[0];await Promise.all([manager.icon(sender, item.id), manager.icon(sender, item.id)]);
  assert.equal(calls.icon, 1);
  assert.throws(() => manager.list({}), /只能由展开的桌面搜索/);
  assert.throws(() => manager.icon(sender, item.path), /已失效/);
  await assert.rejects(manager.open({}, item.id), /只能由展开的桌面搜索/);
});

test('click keeps original bounds; result-driven resize restores bounds and snapshot on collapse', async t => {
  const { manager, sender, calls, snapshot } = await harness(t);
  const first = manager.session.window;
  assert.deepEqual(first.bounds, { x: -1100, y: 100, width: 320, height: 64 });
  manager.resize(sender,214);
  assert.deepEqual(first.bounds, { x: -1100, y: 100, width: 320, height: 214 });
  assert.throws(()=>manager.resize({},214),/只能由展开的桌面搜索/);
  for(const height of [0,-1,63,2000,NaN,Infinity,214.5]) assert.throws(()=>manager.resize(sender,height),/Invalid search height/);
  await manager.list(sender);await manager.show(first);assert.equal(manager.session.window, first);
  const session = manager.session, focusCount = first.focusCount;
  first.emit('blur');first.emit('blur');
  assert.equal(manager.session, session);assert.equal(first.focusCount,focusCount);
  assert.equal((await manager.list(sender)).items.length,4);
  first.outsideClick(session.token);assert.equal(manager.session, null);
  assert.equal(first.isDestroyed(), false);
  assert.deepEqual(first.bounds, { x: -1100, y: 100, width: 320, height: 64 });
  assert.deepEqual(first.messages.at(-1), ['desktop-search:collapsed']);
  assert.equal(first.listenerCount('blur'), 0);
  assert.throws(() => manager.list(sender), /只能由展开的桌面搜索/);
  snapshot.items = [];
  await manager.show(first);
  assert.deepEqual((await manager.list(manager.session.window.webContents)).items, []);assert.equal(calls.list, 2);
  let prevented = false;
  manager.session.window.webContents.emit('before-input-event', { preventDefault: () => { prevented = true; } }, { key: 'Escape', type: 'keyDown' });
  assert.equal(manager.session, null);assert.ok(prevented);
});

test('opening launches the original shortcut once and ignores blur until Shell completes', async t => {
  const { manager, sender, calls, personal } = await harness(t);
  const item = (await manager.list(sender)).items.find(item => item.path === path.join(personal, 'QQ音乐.lnk'));
  let finish;
  manager.openPath = file => { calls.opened.push(file);manager.session.window.emit('blur');return new Promise(resolve => { finish = resolve; }); };
  const opening = manager.open(sender, item.id);
  await new Promise(resolve => setImmediate(resolve));
  await manager.open(sender, item.id);
  assert.ok(manager.session);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  finish('');await opening;
  assert.deepEqual(calls.opened, [item.path]);assert.equal(manager.session, null);
});

test('missing items and Shell failures stay visible; failed icon retrieval is harmless', async t => {
  const { manager, sender } = await harness(t);
  const item = (await manager.list(sender)).items.find(item => item.kind === 'file');
  manager.getFileIcon = async () => { throw new Error('icon error'); };
  assert.equal(await manager.icon(sender, item.id), null);
  manager.openPath = async () => { manager.session.window.emit('blur');return '没有关联应用'; };
  await assert.rejects(manager.open(sender, item.id), /没有关联应用/);
  assert.ok(manager.session.window.visible);assert.equal(manager.session.opening, false);
  fs.unlinkSync(item.path);
  await assert.rejects(manager.open(sender, item.id), /移动或删除/);
  assert.ok(manager.session);
});

test('enumeration failure can be retried and closing during a pending open cannot close a new session', async t => {
  const { manager, sender, snapshot } = await harness(t);
  manager.getWindowsHost = () => ({ request: async () => { throw new Error('timeout'); } });
  await assert.rejects(manager.list(sender), /timeout/);
  manager.getWindowsHost = () => ({ request: async method => method === 'desktop.watch-start' ? {started:true} : snapshot });
  const item = (await manager.list(sender)).items[0];
  let finish;
  manager.openPath = () => new Promise(resolve => { finish = resolve; });
  const opening = manager.open(sender, item.id);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  manager.close();await manager.show(new FakeWindow());
  const second = manager.session;
  finish('');await opening;assert.equal(manager.session, second);
});

test('search near the bottom temporarily shifts up, restores position and removes listeners after reload or destruction', async t => {
  const { manager } = await harness(t);
  manager.close();
  const window = new FakeWindow({ x: -600, y: 750, width: 240, height: 48 });
  await manager.show(window);
  manager.resize(window.webContents,368);
  assert.equal(window.bounds.y, 472);assert.equal(window.bounds.height, 368);
  window.webContents.emit('did-start-loading');
  assert.equal(manager.session, null);assert.equal(window.bounds.y, 750);
  assert.equal(window.webContents.listenerCount('before-input-event'), 0);
  await manager.show(window);window.destroy();assert.equal(manager.session, null);
});

test('Shell icons request physical pixels for the source display and retain the original shortcut identity', async t => {
  const {manager,sender} = await harness(t);
  const item = (await manager.list(sender)).items.find(item => item.kind === 'shortcut');
  const requests=[];
  let scaleFactor=1;
  manager.screen.getDisplayNearestPoint=()=>({scaleFactor});
  manager.getWindowsHost=()=>({request:async(method,payload)=>{requests.push({method,...payload});return {dataUrl:'data:image/png;base64,high-resolution'};}});
  manager.getFileIcon=async()=>{throw new Error('Small icon fallback must not run on Shell success');};
  for (scaleFactor of [1,1.25,1.5,1.75,2,2.5,3]) {
    manager.session.icons.clear();
    assert.equal(await manager.icon(sender,item.id),'data:image/png;base64,high-resolution');
    assert.deepEqual(requests.at(-1),{method:'desktop.icon',path:item.path,size:Math.ceil(48*scaleFactor)});
    const count=requests.length;
    await manager.icon(sender,item.id);assert.equal(requests.length,count);
  }
  manager.session.icons.clear();manager.session.iconSize=256;manager.screen.getDisplayNearestPoint=()=>({scaleFactor:3});
  await manager.icon(sender,item.id);assert.equal(requests.at(-1).size,512);
});

test('outside clicks are session-scoped and listeners are released on close, reload, crash and destruction', async t => {
  const {manager} = await harness(t);
  const window = manager.session.window;
  const oldToken = manager.session.token, oldCallback = window.nativeCallback;
  manager.close();assert.equal(window.nativeCallback,null);
  await manager.show(window);
  window.outsideClick(oldToken);assert.ok(manager.session);
  const buffer = Buffer.alloc(8);buffer.writeUInt32LE(oldToken);oldCallback(buffer);
  assert.ok(manager.session);
  window.emit('blur');assert.ok(manager.session);
  window.outsideClick(manager.session.token);assert.equal(manager.session,null);
  for (const event of ['did-start-loading','render-process-gone']) {
    await manager.show(window);window.webContents.emit(event);
    assert.equal(manager.session,null);assert.equal(window.nativeCallback,null);
    assert.equal(window.webContents.listenerCount('before-input-event'),0);
  }
  await manager.show(window);window.destroy();assert.equal(manager.session,null);
  assert.equal(window.listenerCount('closed'),0);
});

test('watch failure reports an error and releases the session without installing blur behavior', async t => {
  const {manager} = await harness(t);
  const window = manager.session.window;
  manager.close();
  for (const fail of [false,true]) {
    const requests=[];
    manager.getWindowsHost=()=>({request:async(method,payload)=>{
      requests.push({method,...payload});
      if (method==='desktop.watch-start') {
        if (fail) throw new Error('TEST_ONLY hook unavailable');
        return {started:false};
      }
      return {stopped:true};
    }});
    await assert.rejects(manager.show(window),/外部点击监听/);
    assert.equal(manager.session,null);assert.equal(window.nativeCallback,null);
    assert.equal(window.listenerCount('blur'),0);assert.equal(window.listenerCount('closed'),0);
    assert.equal(requests.at(-1).method,'desktop.watch-stop');
  }
});

test('closing while watch startup is pending cannot focus a closed or newer session', async t => {
  const {manager} = await harness(t);
  const window = manager.session.window;
  manager.close();
  let finish;
  const stops=[];
  manager.getWindowsHost=()=>({request:(method,payload)=>{
    if (method==='desktop.watch-start') return new Promise(resolve=>{finish=resolve;});
    stops.push(payload.token);return Promise.resolve({stopped:true});
  }});
  const initialFocus=window.focusCount;
  const first=manager.show(window), token=manager.session.token;
  manager.close();finish({started:true});await first;
  assert.equal(window.focusCount,initialFocus);assert.deepEqual(stops,[token]);
  const second=manager.show(window), current=manager.session;
  finish({started:true});await second;
  assert.equal(manager.session,current);assert.equal(window.focusCount,initialFocus+1);
});
