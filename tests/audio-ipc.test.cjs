const test=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
const handlers=new Map();const load=Module._load;
Module._load=function(name,...args){if(name==='electron') return {ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)}};return load.call(this,name,...args);};
const {registerHandlers,unregisterWidgetHandlers}=require('../src/main/ipc.cjs');Module._load=load;
test('audio IPC limits mutation to the enabled audio tile and edit mode blocks writes',async()=>{
 const control={},tile={},other={};let editing=false,enabled=true;const calls=[];
 registerHandlers({getControlWindow:()=>({webContents:control}),store:{list:()=>[{id:'audio',typeId:'audio',enabled}]},widgetWindows:{windows:new Map([['audio',{webContents:tile,isDestroyed:()=>false}]]),get editMode(){return editing;}},audioService:{refresh:()=>({volume:24}),setVolume:value=>{calls.push(value);return {volume:value};},start:()=>calls.push('start'),stop:()=>calls.push('stop'),retry:()=>calls.push('retry')},openAudioFolder:()=>{}});
 const volume=handlers.get('audio:volume');assert.throws(()=>volume({sender:other},25),/开启的音频/);assert.throws(()=>volume({sender:control},25),/开启的音频/);
 assert.deepEqual(volume({sender:tile},25),{volume:25});editing=true;assert.throws(()=>volume({sender:tile},30),/开启的音频/);editing=false;enabled=false;assert.throws(()=>volume({sender:tile},30),/开启的音频/);
 assert.deepEqual(handlers.get('audio:snapshot')({sender:control}),{volume:24});handlers.get('audio:retry-save')({sender:control});assert.deepEqual(calls,[25,'retry']);
 unregisterWidgetHandlers();assert.equal(handlers.size,0);
});
