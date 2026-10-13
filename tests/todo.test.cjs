const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { WidgetStore } = require('../src/main/widget-store.cjs');
const { TodoReminders } = require('../src/main/todo-reminders.cjs');
const { validateTodoInput } = require('../src/shared/todo.cjs');
const { parseTodoTime, formatTodoTime, todoCalendarDays } = require('../src/shared/todo.ts');
const { fitBoundsToGrid, resizeFromCorner } = require('../src/shared/grid.cjs');
const catalog = require('../src/shared/widget-catalog.json');

test('calendar cells use Monday first, actual month lengths and literal years below 100', () => {
  const leap = todoCalendarDays('2028-02');
  assert.deepEqual(leap.slice(0, 3), [null, 1, 2]);
  assert.equal(leap.at(-1), 29);
  assert.equal(todoCalendarDays('2026-02').at(-1), 28);
  assert.equal(todoCalendarDays('2026-02').indexOf(1), 6);
  assert.equal(todoCalendarDays('2026-06').indexOf(1), 0);
  assert.equal(todoCalendarDays('0096-02').at(-1), 29);
  assert.equal(todoCalendarDays('2026-12').at(-1), 31);
  for (const invalid of ['', '2026-00', '2026-13', '0000-01']) assert.deepEqual(todoCalendarDays(invalid), []);
});

function fixture(t) {
  const directory = path.join(__dirname, '../.tmp/tests', `todo-${randomUUID()}`);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new WidgetStore(directory);
  const widget = store.create('todo');
  return { directory, store, widget };
}

test('moving a todo preserves its data, persists order, rejects stale targets and rolls back failed writes', t => {
  const {store,widget,directory}=fixture(t);
  for(let i=1;i<=3;i++) store.addTodo(widget.id,{text:`测试排序${i}`,color:'green',remindAt:null});
  const original=store.list()[0].settings.items;
  assert.deepEqual(store.moveTodo(widget.id,original[2].id,original[1].id),[original[0],original[2],original[1]]);
  assert.deepEqual(new WidgetStore(directory).list(),store.list());
  assert.deepEqual(store.moveTodo(widget.id,original[0].id,null),[original[2],original[1],original[0]]);
  const before=store.list();
  assert.throws(()=>store.moveTodo(widget.id,original[0].id,'stale'),/已变更/);
  assert.throws(()=>store.moveTodo(widget.id,{},null),/Invalid/);
  const rename=fs.renameSync;
  fs.renameSync=()=>{throw new Error('测试排序保存失败');};
  try { assert.throws(()=>store.moveTodo(widget.id,original[0].id,original[2].id),/测试排序保存失败/); }
  finally {fs.renameSync=rename;}
  assert.deepEqual(store.list(),before);
});

test('todo stores independent colors, full text, optional seconds and independent geometry across restarts', t => {
  const { store, widget, directory } = fixture(t);
  assert.throws(() => store.create('todo'), /最多创建一个/);
  store.addTodo(widget.id, { text: '测试事项一', color: 'pink', remindAt: null });
  store.addTodo(widget.id, { text: '测试事项二', color: 'blue', remindAt: Date.now() + 100000 });
  store.updateBounds(widget.id, { x: -1200, y: 32, width: 160, height: 480, monitorId: '2' });
  store.setEnabled(widget.id, false);
  const restored = new WidgetStore(directory);
  assert.deepEqual(restored.list(), store.list());
  assert.deepEqual(restored.list()[0].settings.items.map(item => item.color), ['pink', 'blue']);
  store.setVariant(widget.id, 'standard');
  assert.equal(store.list()[0].height, 480);
  const item = store.list()[0].settings.items[0];
  store.completeTodo(widget.id, item.id);
  assert.equal(store.list()[0].settings.items.length, 1);
  assert.throws(() => store.updateSettings(widget.id, {items: []}), /专用/);
  assert.throws(() => store.updateBounds(widget.id, {x: 0, y: 0, width: 160, height: 496, monitorId: '2'}), /Invalid/);
  assert.throws(() => store.updateBounds(widget.id, {x: 0, y: 0, width: 144, height: 480, monitorId: '2'}), /Invalid/);
  assert.throws(() => store.updateBounds(widget.id, {x: 0, y: 0, width: 480, height: 144, monitorId: '2'}), /Invalid/);
});

test('todo validation rejects malformed input and impossible local dates without normalizing them', () => {
  for (const input of [null, {}, {text:' ',color:'blue',remindAt:null}, {text:'测试',color:'#fff',remindAt:null}, {text:'测试',color:'blue',remindAt:100}, {text:'测试',color:'blue',remindAt:NaN}, {text:'测试',color:'blue'}]) assert.throws(() => validateTodoInput(input, 100));
  assert.equal(parseTodoTime('2026-02-30T16:40:00'), null);
  assert.equal(parseTodoTime('2026-10-12T24:00:00'), null);
  assert.equal(parseTodoTime('2026-10-12T16:40:60'), null);
  assert.equal(parseTodoTime('2026-10-12T16:40'), null);
  const timestamp = parseTodoTime('2026-10-12T16:40:09');
  assert.equal(formatTodoTime(timestamp), '2026-10-12 16:40:09');
});

test('atomic todo writes roll back in memory and preserve disk on failure; corrupt data is not overwritten', t => {
  const { store, widget, directory } = fixture(t);
  store.addTodo(widget.id, {text:'测试原数据', color:'yellow', remindAt:null});
  const before = fs.readFileSync(store.filePath, 'utf8');
  const original = fs.renameSync;
  fs.renameSync = () => {throw new Error('测试写入失败');};
  try {
    assert.throws(() => store.addTodo(widget.id, {text:'测试新数据', color:'blue', remindAt:null}), /写入失败/);
    assert.throws(() => store.completeTodo(widget.id, store.list()[0].settings.items[0].id), /写入失败/);
    assert.equal(store.list()[0].settings.items.length, 1);
    assert.equal(fs.readFileSync(store.filePath, 'utf8'), before);
  } finally { fs.renameSync = original; }
  const corrupted = JSON.parse(before);
  corrupted.widgets[0].settings.items[0].color = 'unknown';
  fs.writeFileSync(store.filePath, JSON.stringify(corrupted));
  assert.throws(() => new WidgetStore(directory), /Invalid persisted todo/);
  assert.equal(JSON.parse(fs.readFileSync(store.filePath)).widgets[0].settings.items[0].color, 'unknown');
});

test('free resize keeps opposite edges, adapts both axes and preserves rectangular saved bounds', () => {
  const base = catalog.find(item => item.typeId === 'todo').variants[0].size;
  const area = {x:-1280,y:7,width:1280,height:713};
  const start = {x:-960,y:167,width:240,height:240};
  for (const corner of ['nw','ne','sw','se']) {
    const left=corner.includes('w'),top=corner.includes('n');
    const next=resizeFromCorner(start,base,corner,{x:left?80:-80,y:top?-160:160},area);
    assert.equal(next.width,160);assert.equal(next.height,400);
    assert.equal(left?next.x+next.width:next.x,left?start.x+start.width:start.x);
    assert.equal(top?next.y+next.height:next.y,top?start.y+start.height:start.y);
  }
  assert.deepEqual(fitBoundsToGrid({x:-50,y:650,width:160,height:480},base,area), {x:-160,y:231,width:160,height:480});
  assert.deepEqual(fitBoundsToGrid({x:-960,y:167,width:144,height:144},base,area), {x:-960,y:167,width:160,height:160});
  assert.throws(() => fitBoundsToGrid(start,base,{x:0,y:0,width:150,height:500}), /工作区/);
});

function reminderFixture(t) {
  const fixtureData = fixture(t);
  let wall = 10000, mono = 10000;
  const batches = [], changes = [], errors = [];
  const reminders = new TodoReminders({store:fixtureData.store, now:()=>wall, monotonic:()=>mono,
    onDue:items=>batches.push(items), onChange:id=>changes.push(id), onError:error=>errors.push(error)});
  t.after(()=>reminders.close());
  const add = deadline => fixtureData.store.addTodo(fixtureData.widget.id,{text:'测试提醒',color:'blue',remindAt:deadline},wall);
  const step = (delta, monoDelta=delta) => {wall+=delta;mono+=monoDelta;reminders.tick();};
  const states = () => fixtureData.store.list()[0].settings.items.map(item=>item.reminderState);
  return {...fixtureData, reminders, batches, changes, errors, add, step, states};
}

test('due items are batched once and survive dismissal/restart as notified', t => {
  const f=reminderFixture(t);
  f.add(10500);f.add(10500);
  f.step(500);
  assert.equal(f.batches.length,1);assert.equal(f.batches[0].length,2);
  assert.deepEqual(f.states(),['notified','notified']);
  f.step(500);f.reminders.reconcile();
  assert.equal(f.batches.length,1);
  assert.deepEqual(new WidgetStore(f.directory).list(),f.store.list());
  f.add(11500);f.step(500);
  assert.equal(f.batches.length,2);
});

test('disabled/re-enabled, startup, sleep, lock and jumps never catch up missed reminders', t => {
  const f=reminderFixture(t);
  f.add(10500);f.store.setEnabled(f.widget.id,false);f.step(500);
  assert.deepEqual(f.states(),['missed']);
  f.store.setEnabled(f.widget.id,true);f.reminders.reconcile();
  f.add(11000);f.reminders.setBlocked('lock',true);f.step(500);f.reminders.setBlocked('lock',false);
  f.add(11500);f.reminders.setBlocked('sleep',true);f.step(60000);f.reminders.setBlocked('sleep',false);
  f.add(72000);f.step(60000,250);
  f.add(132000);f.step(60000);
  assert.ok(f.states().every(state=>state==='missed'));
  assert.equal(f.batches.length,0);
  f.add(192000);
  const restarted=new TodoReminders({store:f.store,now:()=>200000,monotonic:()=>200000,onDue:()=>assert.fail('catch-up'),onChange:()=>{},onError:assert.fail});
  restarted.reconcile();restarted.close();
  assert.equal(f.states().at(-1),'missed');
});

test('re-enable within a polling interval skips overdue items and completion cancels future reminders', t => {
  const f=reminderFixture(t);
  f.add(10500);
  f.store.setEnabled(f.widget.id,false);f.step(499);
  f.store.setEnabled(f.widget.id,true);
  // Advance through the missed instant without ticking, as enabling IPC does.
  const overdue=new TodoReminders({store:f.store,now:()=>10501,monotonic:()=>10501,onChange:()=>{},onError:assert.fail});
  overdue.reconcile(f.widget.id);overdue.close();
  assert.deepEqual(f.states(),['missed']);
  f.add(11000);f.store.completeTodo(f.widget.id,f.store.list()[0].settings.items.at(-1).id);
  f.step(1000);assert.equal(f.batches.length,0);
});

test('a backward clock adjustment preserves future pending reminders without duplicates', t => {
  const f=reminderFixture(t);
  f.add(10500);f.step(-1000,250);
  assert.deepEqual(f.states(),['pending']);
  f.step(1500);
  assert.equal(f.batches.length,1);
  f.step(-1000,250);f.step(1000);
  assert.equal(f.batches.length,1);
});

test('failed reminder persistence emits no alarm and failed presentation records missed', t => {
  const f=reminderFixture(t);f.add(10500);
  const original=f.store.setTodoReminderStates;
  f.store.setTodoReminderStates=()=>{throw new Error('测试保存失败');};
  f.step(500);assert.equal(f.batches.length,0);assert.deepEqual(f.states(),['pending']);
  f.store.setTodoReminderStates=original;f.step(250);
  assert.deepEqual(f.states(),['missed']);
  f.add(11000);f.reminders.onDue=()=>{throw new Error('测试窗口失败');};f.step(250);
  assert.equal(f.states().at(-1),'missed');assert.equal(f.errors.length,2);
});
