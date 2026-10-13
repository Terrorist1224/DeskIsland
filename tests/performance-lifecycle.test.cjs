const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {Countdown}=require('../src/main/countdown.cjs');
const {TodoReminders}=require('../src/main/todo-reminders.cjs');
const {WidgetStore}=require('../src/main/widget-store.cjs');

test('countdown checks run only while a countdown is running and unblocked',t=>{
  let now=10000;const timer=new Countdown({now:()=>now,onChange:()=>{},onDue:()=>{},onError:assert.fail});t.after(()=>timer.close());
  timer.open();assert.equal(timer.timer,undefined);timer.start('test',1);assert.ok(timer.timer);
  timer.pause('test');assert.equal(timer.timer,undefined);timer.resume('test');assert.ok(timer.timer);
  timer.setBlocked('lock',true);assert.equal(timer.timer,undefined);now+=2000;
  timer.setBlocked('lock',false);assert.equal(timer.get('test').status,'finished');assert.equal(timer.timer,undefined);
  timer.cancel('test');timer.start('test',2);assert.ok(timer.timer);timer.cancel('test');assert.equal(timer.timer,undefined);
});

test('todo checks start after idle, stop on completion/disable/lock and do not miss the first new deadline',t=>{
  let now=10000;const items=[];let enabled=true;const due=[];
  const store={list:type=>{assert.equal(type,'todo');return [{id:'test',enabled,settings:{items}}];},setTodoReminderStates:(_,states)=>{for(const item of items)if(states.has(item.id))item.reminderState=states.get(item.id);}};
  const timer=new TodoReminders({store,now:()=>now,monotonic:()=>now,onChange:()=>{},onDue:values=>due.push(values),onError:assert.fail});t.after(()=>timer.close());
  timer.start();assert.equal(timer.timer,undefined);now+=60000;items.push({id:'first',remindAt:now+500,reminderState:'pending'});timer.reconcile();assert.ok(timer.timer);
  now+=500;timer.tick();assert.equal(due.length,1);assert.equal(timer.timer,undefined);
  items.push({id:'second',remindAt:now+500,reminderState:'pending'});timer.reconcile();assert.ok(timer.timer);
  enabled=false;timer.reconcile();assert.equal(timer.timer,undefined);now+=1000;enabled=true;timer.reconcile();assert.equal(items.at(-1).reminderState,'missed');assert.equal(timer.timer,undefined);
  items.push({id:'third',remindAt:now+500,reminderState:'pending'});timer.reconcile();timer.setBlocked('lock',true);assert.equal(timer.timer,undefined);
  now+=1000;timer.setBlocked('lock',false);assert.equal(items.at(-1).reminderState,'missed');assert.equal(due.length,1);assert.equal(timer.timer,undefined);
});

test('filtered widget reads avoid cloning unrelated settings and still return detached values',()=>{
  const store=Object.create(WidgetStore.prototype);store.state={widgets:[{id:'audio',typeId:'audio',settings:{}},{id:'todo',typeId:'todo',settings:{get items(){throw Error('unrelated data was read');}}}]};
  const audio=store.list('audio');assert.equal(audio.length,1);audio[0].id='changed';assert.equal(store.state.widgets[0].id,'audio');
});

const handlers=new Map(),load=Module._load;
Module._load=function(name,...args){if(name==='electron')return {ipcMain:{handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)}};return load.call(this,name,...args);};
const {registerHandlers,unregisterWidgetHandlers}=require('../src/main/ipc.cjs');Module._load=load;
test('control drafts are kept only for the authorized window, validated and detached before closing',t=>{
  t.after(unregisterWidgetHandlers);const sender={};let saved=null;
  registerHandlers({getControlWindow:()=>({webContents:sender}),getControlState:()=>saved,closeControlWindow:value=>{saved=value;}});
  const draft={selectedType:'weather',settingsPage:false,focusedWeatherId:'test',apiHost:'test.invalid',apiKey:'test-unsaved-key',weatherCodes:{test:['43','4301','']}};
  assert.throws(()=>handlers.get('control:hide')({sender:{}},draft));
  assert.throws(()=>handlers.get('control:hide')({sender},{...draft,apiKey:'x'.repeat(4097)}),/Invalid control/);
  assert.throws(()=>handlers.get('control:hide')({sender},{...draft,weatherCodes:{test:['43',{}]}}),/Invalid control/);
  handlers.get('control:hide')({sender},draft);draft.weatherCodes.test[0]='44';assert.equal(saved.weatherCodes.test[0],'43');
  assert.equal(handlers.get('control:get-state')({sender}).selectedType,'weather');
});
