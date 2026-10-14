const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { TodoReminderWindow } = require('../src/main/todo-reminder-window.cjs');

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();this.options=options;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};
    this.webContents=new EventEmitter();this.messages=[];
    this.webContents.send=(...args)=>this.messages.push(args);
    FakeWindow.instances.push(this);
  }
  setMenu() {}
  setAlwaysOnTop(value,level) {this.top={value,level};}
  setBounds(bounds) {this.bounds=bounds;}
  show() {this.visible=true;}
  focus() {this.focused=true;}
  isDestroyed() {return !!this.destroyed;}
  isMinimized() {return false;}
  getNativeWindowHandle() {return Buffer.alloc(8,1);}
  destroy() {this.destroyed=true;this.emit('closed');}
  loadFile() {this.webContents.emit('did-finish-load');return FakeWindow.loadResult;}
}

function fixture(t) {
  FakeWindow.instances=[];FakeWindow.loadResult=Promise.resolve();
  const screen=new EventEmitter();
  let displays=[{id:1,bounds:{x:0,y:0,width:1707,height:1067},workArea:{x:0,y:0,width:1707,height:1035}},{id:2,bounds:{x:-1280,y:0,width:1280,height:720}}];
  screen.getDisplayNearestPoint=()=>displays[1];screen.getCursorScreenPoint=()=>({x:-100,y:50});
  screen.getAllDisplays=()=>displays;screen.getPrimaryDisplay=()=>displays[0];
  let opened=0;const errors=[];
  const controller=new TodoReminderWindow({BrowserWindow:FakeWindow,screen,getWindowsHost:()=>({request:async()=>({applied:true})}),rendererPath:'reminder.html',preloadPath:'todo-reminder.cjs',onOpen:()=>opened++,onError:(...args)=>errors.push(args)});
  t.after(()=>controller.close());
  const item=id=>({id,text:'测试提醒',color:'blue',remindAt:10000,reminderState:'notified'});
  return {controller,screen,item,errors,opened:()=>opened,removeMonitor:()=>{displays=displays.slice(0,1);screen.emit('display-removed');}};
}

test('countdown and todo share one overlay; todo sync cannot erase countdown events', t => {
  const f=fixture(t);
  const countdown={...f.item('countdown:1'),source:'countdown',text:'泡面倒计时结束'};
  f.controller.show([countdown]);f.controller.show([f.item('todo:1')]);
  assert.equal(FakeWindow.instances.length,1);assert.equal(f.controller.items.length,2);
  f.controller.sync([]);assert.deepEqual(f.controller.items,[countdown]);
  f.controller.show([f.item('todo:2')]);assert.equal(f.controller.items.length,2);
  f.controller.dismiss();assert.equal(f.controller.items.length,0);
});

test('acknowledging or disabling countdown removes only its overlay entry and preserves todo or preview', t => {
  const f=fixture(t), todo=f.item('todo:1'), countdown={...f.item('countdown:1'),source:'countdown'};
  f.controller.show([todo]);f.controller.show([countdown]);
  f.controller.removeCountdown('1');assert.deepEqual(f.controller.items,[todo]);assert.equal(FakeWindow.instances.length,1);
  f.controller.sync([]);f.controller.show([countdown]);f.controller.removeCountdown('1');assert.equal(f.controller.window,null);
  f.controller.preview();f.controller.removeCountdown('1');assert.equal(f.controller.items[0].id,'preview');
});

test('reminder uses full pointer-display bounds rather than work area, accepts Escape, and recreates after dismissal', t => {
  const f=fixture(t);f.controller.show([f.item('1'),f.item('2')]);
  const window=FakeWindow.instances[0];
  assert.deepEqual(window.bounds,{x:-1280,y:0,width:1280,height:720});
  assert.equal(window.options.thickFrame,false);
  assert.equal(window.options.transparent,true);
  assert.equal(window.options.backgroundColor,'#00000000');
  assert.equal(window.options.webPreferences.nodeIntegration,false);
  assert.equal(window.options.webPreferences.contextIsolation,true);
  assert.equal(window.options.webPreferences.preload,'todo-reminder.cjs');
  assert.deepEqual(window.top,{value:true,level:'screen-saver'});
  assert.ok(window.visible&&window.focused);
  f.controller.show([f.item('2'),f.item('3')]);
  assert.equal(FakeWindow.instances.length,1);assert.equal(f.controller.items.length,3);
  assert.throws(()=>f.controller.requireSender({}),/提醒窗口/);
  f.controller.requireSender(window.webContents);
  f.removeMonitor();
  assert.deepEqual(window.bounds,{x:0,y:0,width:1707,height:1067});
  let prevented=false;
  window.webContents.emit('before-input-event',{preventDefault:()=>{prevented=true;}},{key:'Escape',type:'keyDown'});
  assert.ok(window.destroyed&&prevented);assert.equal(f.controller.items.length,0);
  f.screen.getDisplayNearestPoint=()=>f.screen.getPrimaryDisplay();
  f.controller.show([f.item('4')]);assert.equal(FakeWindow.instances.length,2);assert.equal(f.opened(),2);
});

test('completing items removes them from the visible batch; disabling closes it; teardown removes display listeners', t => {
  const f=fixture(t);f.controller.show([f.item('1'),f.item('2')]);
  f.controller.sync([f.item('2')]);assert.deepEqual(f.controller.items.map(item=>item.id),['2']);
  f.controller.sync([]);assert.ok(FakeWindow.instances[0].destroyed);
  f.controller.close();assert.equal(f.screen.listenerCount('display-removed'),0);assert.equal(f.screen.listenerCount('display-metrics-changed'),0);
});

test('load failure closes the overlay and reports affected items; a dismissed old load cannot close a replacement', async t => {
  const f=fixture(t);let reject;
  FakeWindow.loadResult=new Promise((_resolve,rejectLoad)=>{reject=rejectLoad;});
  f.controller.show([f.item('1')]);reject(new Error('测试页面加载失败'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.errors.length,1);assert.equal(f.errors[0][1][0].id,'1');assert.equal(f.controller.window,null);
  FakeWindow.loadResult=new Promise((_resolve,rejectLoad)=>{reject=rejectLoad;});
  f.controller.show([f.item('2')]);f.controller.dismiss();
  FakeWindow.loadResult=Promise.resolve();f.controller.show([f.item('3')]);
  reject(new Error('测试旧请求失败'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.controller.items[0].id,'3');assert.ok(!f.controller.window.destroyed);
});

test('a crashed reminder renderer cannot leave an unresponsive full-screen overlay', t => {
  const f=fixture(t);f.controller.show([f.item('1')]);
  const window=f.controller.window;
  window.webContents.emit('render-process-gone',{}, {reason:'crashed'});
  assert.ok(window.destroyed);assert.equal(f.controller.window,null);
  assert.equal(f.errors[0][1][0].id,'1');
});

test('preview survives data sync and gives way to real reminders without mixing sample items', t => {
  const f=fixture(t);f.controller.preview();
  assert.match(f.controller.items[0].text,/预览示例/);
  f.controller.sync([]);assert.ok(!f.controller.window.destroyed);
  f.controller.preview();assert.equal(FakeWindow.instances.length,1);
  f.controller.show([f.item('real')]);
  assert.deepEqual(f.controller.items.map(item=>item.id),['real']);
  f.controller.preview();assert.deepEqual(f.controller.items.map(item=>item.id),['real']);
  f.controller.sync([]);assert.equal(f.controller.window,null);
});

test('preview failure does not report sample rows as failed real reminders', t => {
  const f=fixture(t);f.controller.preview();
  f.controller.window.webContents.emit('render-process-gone',{}, {reason:'crashed'});
  assert.deepEqual(f.errors[0][1],[]);
  assert.equal(f.controller.isPreview,false);
});
