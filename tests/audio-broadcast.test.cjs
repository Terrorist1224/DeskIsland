const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {EventEmitter}=require('node:events');
const vm=require('node:vm');
const ts=require('typescript');

function fixture() {
  const source=ts.createSourceFile('index.cjs',readFileSync(require.resolve('../src/main/index.cjs'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const functions=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&['sendAudioRecording','broadcastAudioState'].includes(node.name.text)).map(node=>node.getText(source)).join('\n');
  let visible=true;
  const messages=[];
  const window=id=>({isDestroyed:()=>false,webContents:{send:(channel,value)=>messages.push({id,channel,value})}});
  const control={...window('control'),isVisible:()=>visible};
  const widgets=[{id:'audio',typeId:'audio',enabled:true},{id:'music',typeId:'music',enabled:true},{id:'disabled-audio',typeId:'audio',enabled:false}];
  const windows=new Map(widgets.map(widget=>[widget.id,window(widget.id)]));
  const api=new Function('controlWindow','store','widgetWindows',`let lastAudioRecording;${functions};return {sendAudioRecording,broadcastAudioState};`)(control,{list:type=>widgets.filter(widget=>widget.typeId===type)},{windows});
  return {...api,messages,windows,hide:()=>{visible=false;},show:()=>{visible=true;}};
}

test('audio broadcasts target only enabled audio windows; control receives status changes without meters',()=>{
  const f=fixture();
  const state={volume:24,recording:{status:'recording',elapsedMs:1000,levels:[0.2]}};
  f.broadcastAudioState(state);
  assert.deepEqual(f.messages.map(item=>[item.id,item.channel]),[['audio','audio:changed'],['control','audio:recording-changed']]);
  assert.deepEqual(f.messages[1].value,{status:'recording',message:undefined});
  f.messages.length=0;
  for(let i=0;i<20;i++) f.broadcastAudioState({...state,recording:{...state.recording,elapsedMs:1050+i*50,levels:[i/20]}});
  assert.equal(f.messages.length,20);
  assert.ok(f.messages.every(item=>item.id==='audio'));
  f.broadcastAudioState({...state,recording:{status:'error',message:'测试保存失败'}});
  assert.deepEqual(f.messages.at(-1),{id:'control',channel:'audio:recording-changed',value:{status:'error',message:'测试保存失败'}});
});

test('hidden control receives nothing and showing it can synchronize the latest error',()=>{
  const f=fixture();f.hide();
  const recording={status:'error',message:'测试录音已保留',elapsedMs:2000,levels:[1]};
  f.broadcastAudioState({recording});
  assert.ok(f.messages.every(item=>item.id==='audio'));
  f.show();f.sendAudioRecording(recording,true);
  assert.deepEqual(f.messages.at(-1).value,{status:'error',message:'测试录音已保留'});
  f.messages.length=0;f.windows.get('audio').isDestroyed=()=>true;
  f.broadcastAudioState({recording});assert.equal(f.messages.length,0);
  f.sendAudioRecording(recording,true);assert.equal(f.messages.length,1,'reopening must synchronize even unchanged status');
});

test('preload exposes a separate recording listener and removes it on unsubscribe',()=>{
  const ipc=new EventEmitter();let bridge;
  vm.runInNewContext(readFileSync(require.resolve('../src/preload/index.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_,value)=>{bridge=value;}},ipcRenderer:ipc})});
  const received=[];const unsubscribe=bridge.onAudioRecordingChanged(value=>received.push(value));
  ipc.emit('audio:changed',{},{});assert.equal(received.length,0);
  const value={status:'error',message:'测试错误'};
  ipc.emit('audio:recording-changed',{},value);assert.deepEqual(received,[value]);
  unsubscribe();assert.equal(ipc.listenerCount('audio:recording-changed'),0);
});
