const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Countdown } = require('../src/main/countdown.cjs');
const { WidgetStore } = require('../src/main/widget-store.cjs');
const { validateDuration } = require('../src/shared/countdown.cjs');
const colors = require('../src/shared/todo-colors.json');
const crypto = require('node:crypto');

test('each start picks a todo color and retains it through pause, resume and expiry', t => {
  let now=0,index=0;
  const random=t.mock.method(crypto,'randomInt',max=>{assert.equal(max,colors.length);return index;});
  // Reload so the service uses the controlled random source without probabilistic assertions.
  delete require.cache[require.resolve('../src/main/countdown.cjs')];
  const { Countdown: ColorCountdown }=require('../src/main/countdown.cjs');
  t.after(()=>{delete require.cache[require.resolve('../src/main/countdown.cjs')];});
  const timer=new ColorCountdown({now:()=>now,onDue:()=>{},onChange:()=>{},onError:error=>{throw error;}});
  for(index=0;index<colors.length;index++) {
    timer.start('color',2,'测试颜色');
    assert.equal(timer.get('color').color,colors[index].value);
    now+=500;timer.pause('color');assert.equal(timer.get('color').color,colors[index].value);
    timer.resume('color');assert.equal(timer.get('color').color,colors[index].value);
    now+=2000;timer.tick();assert.equal(timer.get('color').color,colors[index].value);
    assert.equal(timer.get('color').status,'finished');timer.cancel('color');
  }
  assert.equal(random.mock.callCount(),colors.length);
});

test('countdown range, pause/resume, cancel and one-shot named expiry', () => {
  let now=0;const due=[],changes=[];
  const timer=new Countdown({now:()=>now,onDue:id=>due.push(id),onChange:(...args)=>changes.push(args),onError:error=>{throw error;}});
  for(const value of [0,-1,86401,1.5,NaN,'3']) assert.throws(()=>validateDuration(value));
  assert.equal(validateDuration(86400),86400);
  timer.start('a',10,'泡面');assert.throws(()=>timer.start('a',2));
  now=3000;timer.pause('a');assert.equal(timer.get('a').remainingMs,7000);
  now=50000;timer.tick();assert.equal(due.length,0);
  timer.resume('a');assert.equal(timer.get('a').deadline,57000);
  now=57000;timer.tick();timer.tick();assert.equal(due.length,1);
  assert.equal(due[0],'a');assert.equal(timer.get('a').name,'泡面');assert.equal(timer.get('a').status,'finished');
  assert.throws(()=>timer.start('a',1));timer.cancel('a');
  timer.start('a',1);timer.cancel('a');now+=5000;timer.tick();assert.equal(due.length,1);
  timer.start('a',1);timer.close();now+=5000;timer.tick();assert.equal(due.length,1);
  let reset=false,reported=false;
  const failed=new Countdown({now:()=>now,onDue:()=>{throw Error('测试窗口失败');},onChange:(_id,finished)=>{if(finished)reset=true;},onError:()=>{reported=true;}});
  failed.start('a',1);now+=1000;failed.tick();assert.equal(reset,true);assert.equal(reported,true);assert.equal(failed.get('a').status,'finished');
});

test('sleep and lock overlap defer expired countdown until both blockers clear, without catch-up duplicates', () => {
  let now=0;const due=[];
  const timer=new Countdown({now:()=>now,onDue:id=>due.push(id),onChange:()=>{},onError:error=>{throw error;}});
  timer.start('a',86400);timer.setBlocked('lock',true);timer.setBlocked('sleep',true);
  now=86400001;timer.tick();timer.setBlocked('sleep',false);assert.equal(due.length,0);
  timer.setBlocked('lock',false);assert.equal(due.length,1);assert.equal(timer.get('a').status,'finished');assert.equal(timer.get('a').name,'');
  timer.tick();assert.equal(due.length,1);
});

test('presets persist, stay independent of active sessions and failed writes preserve previous data', t => {
  const directory=path.join(__dirname,'../.tmp/tests',`countdown-${randomUUID()}`);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new WidgetStore(directory),widget=store.create('countdown');
  const settings={seconds:180,presets:[{id:'noodles',name:'泡面',seconds:180}]};
  store.updateSettings(widget.id,settings);
  assert.deepEqual(new WidgetStore(directory).list()[0].settings,settings);
  assert.throws(()=>store.create('countdown'));
  for(const presets of [[{id:'x',name:' ',seconds:3}],[{id:'x',name:'a',seconds:86401}],[settings.presets[0],settings.presets[0]]]) assert.throws(()=>store.updateSettings(widget.id,{presets}));
  fs.mkdirSync(`${store.filePath}.tmp`);assert.throws(()=>store.updateSettings(widget.id,{seconds:10}));
  assert.deepEqual(store.list()[0].settings,settings);
});
