const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
const {AudioService,recordingName,validateVolume}=require('../src/main/audio/audio-service.cjs');

function fixture(t,options={}) {
  const directory=path.resolve('.tmp/audio-tests',randomUUID());fs.mkdirSync(path.join(directory,'desktop'),{recursive:true});
  const calls=[];let recording=false;let failDevice=false;
  const value={volume:24,inputs:[{id:'mic',name:'测试麦克风'}],outputs:[{id:'speaker',name:'测试音箱'}],inputId:'mic',outputId:'speaker',elapsedMs:1000,levels:[0,0.25,0.5]};
  const host={request:async(method,args)=>{
    calls.push([method,args]);
    if(method==='audio.start'){fs.writeFileSync(args.file,Buffer.alloc(192000));recording=true;}
    if(method==='audio.stop') recording=false;
    if(method==='audio.volume') value.volume=args.volume;
    if(method==='audio.device'&&failDevice) throw new Error('测试设备切换失败');
    return {...value,recording};
  },close(){calls.push(['close']);}};
  const service=new AudioService({userDataPath:directory,runtimePath:directory,desktopPath:path.join(directory,'desktop'),createHost:()=>host,chooseSavePath:async()=>null,encode:async(_,file)=>fs.writeFileSync(file,Buffer.from('test mp3')),...options});
  t.after(async()=>{await service.shutdown().catch(()=>{});fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  return {service,calls,directory,value,setFailDevice:()=>{failDevice=true;}};
}

test('audio volume validates finite range and devices validate flow/id; failed switches refresh actual state',async t=>{
  const {service,calls,setFailDevice}=fixture(t);await service.setEnabled(true);
  for(const invalid of [-1,101,NaN,Infinity,'50',null]) assert.throws(()=>validateVolume(invalid));
  assert.equal((await service.setVolume(35)).volume,35);
  await assert.rejects(service.setDefault('other','mic'),/无效/);await assert.rejects(service.setDefault('input','speaker'),/方向/);
  setFailDevice();await assert.rejects(service.setDefault('output','speaker'),/切换失败/);assert.equal(calls.at(-1)[0],'audio.snapshot');
});

test('recording snapshots are copied; duplicate start is rejected; stop is coalesced; cancelled save falls back to desktop without overwrite',async t=>{
  const {service,calls,directory}=fixture(t);await service.setEnabled(true);await service.start();
  const startedAt=service.pending.startedAt;const first=path.join(directory,'desktop',recordingName(startedAt));fs.writeFileSync(first,'existing');
  const copy=service.snapshot;copy.recording.status='idle';assert.equal(service.snapshot.recording.status,'recording');
  await assert.rejects(service.start(),/已有录音/);await assert.rejects(service.setDefault('input','mic'),/期间/);
  const a=service.stop(),b=service.stop();assert.equal(a,b);const result=await a;
  assert.equal(calls.filter(call=>call[0]==='audio.stop').length,1);assert.equal(fs.readFileSync(first,'utf8'),'existing');
  assert.match(result.recording.savedPath,/\(2\)\.mp3$/);assert.equal(result.recording.message,'已保存到桌面');assert.equal(service.pending,null);
});

test('encoding failure preserves PCM and metadata, retry recovers',async t=>{
  let failing=true;const {service}=fixture(t,{encode:async(_,file)=>{if(failing) throw new Error('测试编码失败');fs.writeFileSync(file,'mp3');}});
  await service.setEnabled(true);await service.start();const raw=service.file('.pcm');await assert.rejects(service.stop(),/测试编码失败/);
  assert.equal(service.snapshot.recording.status,'error');assert.ok(fs.existsSync(raw));assert.ok(fs.existsSync(service.file('.json')));
  failing=false;await service.retry();assert.equal(service.snapshot.recording.status,'idle');assert.equal(fs.existsSync(raw),false);
});

test('chosen destination failure preserves recording; retry can save elsewhere',async t=>{
  let target='missing';const {service,directory}=fixture(t,{chooseSavePath:async()=>path.join(directory,target,'audio.mp3')});
  await service.setEnabled(true);await service.start();const raw=service.file('.pcm');await assert.rejects(service.stop(),/ENOENT/);assert.ok(fs.existsSync(raw));
  target='desktop';const saved=await service.retry();assert.equal(saved.recording.savedPath,path.join(directory,'desktop','audio.mp3'));
});

test('disabling tile stops recording; shutdown auto-saves without opening dialog',async t=>{
  let dialogs=0;const {service}=fixture(t,{chooseSavePath:async()=>{dialogs++;return null;}});
  await service.setEnabled(true);await service.start();await service.setEnabled(false);assert.equal(dialogs,1);assert.equal(service.snapshot.recording.status,'idle');
  await service.setEnabled(true);await service.start();await service.shutdown();assert.equal(dialogs,1);assert.equal(service.closed,true);assert.equal(service.pending,null);
});

test('default device changes stop and preserve the captured audio',async t=>{
  const {service,value}=fixture(t);await service.setEnabled(true);await service.start();value.devicesChanged=true;
  await service.refresh();await service.operation;assert.equal(service.snapshot.recording.status,'idle');assert.ok(service.snapshot.recording.savedPath);
});

test('unfinished PCM is recovered on startup, without automatically recording',async t=>{
  const {service,directory,calls}=fixture(t);const id=randomUUID();fs.mkdirSync(service.directory,{recursive:true});
  fs.writeFileSync(path.join(service.directory,id+'.json'),JSON.stringify({id,startedAt:Date.UTC(2026,9,13,6,5,9),elapsedMs:1000}));
  fs.writeFileSync(path.join(service.directory,id+'.pcm'),Buffer.alloc(192000));
  await service.recover();assert.equal(service.snapshot.recording.status,'idle');assert.equal(calls.some(call=>call[0]==='audio.start'),false);
  assert.ok(fs.existsSync(path.join(directory,'desktop','录音 2026年10月13日 14时05分09秒.mp3')));
});

test('recording names use the beginning time in Shanghai',()=>assert.equal(recordingName(Date.UTC(2026,9,13,6,5,9)),'录音 2026年10月13日 14时05分09秒.mp3'));

test('volume and device updates use their host response without redundant device enumeration',async t=>{
  const {service,calls}=fixture(t);await service.setEnabled(true);calls.length=0;
  assert.equal((await service.setVolume(26)).volume,26);
  assert.equal(service.snapshot.volumeRevision,1);
  assert.deepEqual(calls.map(call=>call[0]),['audio.volume']);calls.length=0;
  await service.setDefault('input','mic');
  assert.deepEqual(calls.map(call=>call[0]),['audio.device']);
});

test('unchanged audio polls emit nothing; volume, error recovery and recording meters still propagate',async t=>{
  const changes=[];const {service,value}=fixture(t,{onChange:state=>changes.push(state)});
  await service.setEnabled(true);assert.equal(changes.length,1);
  await service.refresh();await service.refresh();assert.equal(changes.length,1);
  value.volume=32;await service.refresh();assert.equal(changes.at(-1).volume,32);assert.equal(changes.length,2);
  service.state.error='测试读取失败';service.emit();await service.refresh();assert.equal(changes.at(-1).error,'');
  await service.start();const count=changes.length;value.levels=[0.1];await service.readMeter();assert.equal(changes.length,count+1);
});

test('a snapshot started before a wheel change cannot overwrite the acknowledged volume',async t=>{
  const {service}=fixture(t);await service.setEnabled(true);
  let release;const host=service.host,request=host.request.bind(host);
  host.request=(method,args)=>method==='audio.snapshot'?new Promise(resolve=>{release=resolve;}):request(method,args);
  const refresh=service.refresh();await service.setVolume(28);
  release({volume:24,inputs:[],outputs:[],inputId:null,outputId:null});await refresh;
  assert.equal(service.snapshot.volume,28);assert.equal(service.snapshot.inputId,'mic');
});

test('recording meters carry real host levels and are cleared when stopping',async t=>{
  const {service,value,calls}=fixture(t);await service.setEnabled(true);await service.start();
  await service.readMeter();assert.deepEqual(service.snapshot.recording.levels,value.levels);
  const copy=service.snapshot;copy.recording.levels[1]=1;assert.equal(service.snapshot.recording.levels[1],0.25);
  value.levels=[0,0,0];await service.readMeter();assert.deepEqual(service.snapshot.recording.levels,[0,0,0]);
  await service.stop();assert.equal(service.meterTimer,null);
  const count=calls.length;await service.readMeter();assert.equal(calls.length,count);
  assert.equal(service.snapshot.recording.levels,undefined);
});

test('a pending meter response cannot restore waveform data after stop',async t=>{
  const {service}=fixture(t);await service.setEnabled(true);await service.start();
  let release;const host=service.host,request=host.request.bind(host);
  host.request=(method,args)=>method==='audio.meter'?new Promise(resolve=>{release=resolve;}):request(method,args);
  const meter=service.readMeter();await service.stop();
  release({levels:[1,1,1],elapsedMs:2000});await meter;
  assert.equal(service.snapshot.recording.status,'idle');assert.equal(service.snapshot.recording.levels,undefined);
});
