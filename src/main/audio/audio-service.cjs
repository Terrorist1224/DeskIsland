const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { WindowsHostClient } = require('../windows-host-client.cjs');
const execute = promisify(execFile);

function recordingName(startedAt) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(startedAt)).map(item=>[item.type,item.value]));
  return `录音 ${values.year}年${values.month}月${values.day}日 ${values.hour}时${values.minute}分${values.second}秒.mp3`;
}
async function copyWithoutOverwrite(source, destination) {
  const parsed=path.parse(destination);
  for(let suffix=0;;suffix++) {
    const candidate=suffix?path.join(parsed.dir,`${parsed.name} (${suffix+1})${parsed.ext}`):destination;
    try { await fs.promises.copyFile(source,candidate,fs.constants.COPYFILE_EXCL);return candidate; }
    catch(error) {if(error.code!=='EEXIST') throw error;}
  }
}
function validateVolume(volume) {if(!Number.isFinite(volume)||volume<0||volume>100) throw new TypeError('音量必须在 0 到 100 之间');}

class AudioService {
  constructor({userDataPath,runtimePath,desktopPath,chooseSavePath,onChange=()=>{},createHost,encode}) {
    Object.assign(this,{runtimePath,desktopPath,chooseSavePath,onChange});
    this.directory=path.join(userDataPath,'recordings');
    this.createHost=createHost??(()=>new WindowsHostClient(path.join(__dirname,'audio-host.ps1'),['-RuntimePath',runtimePath]));
    this.encode=encode??(async(raw,mp3)=>{
      await execute(path.join(runtimePath,'ffmpeg.exe'),['-hide_banner','-loglevel','error','-nostdin','-y','-f','s16le','-ar','48000','-ac','2','-i',raw,'-c:a','libmp3lame','-b:a','192k','-ar','48000',mp3],{windowsHide:true,maxBuffer:1024*1024});
    });
    this.encoderPath=encode?null:path.join(runtimePath,'ffmpeg.exe');
    this.state={volume:null,volumeRevision:0,inputs:[],outputs:[],inputId:null,outputId:null,error:'',recording:{status:'idle',elapsedMs:0}};
    this.enabled=false;this.host=null;this.pending=null;this.operation=null;this.refreshing=false;this.closed=false;this.controlVersion=0;this.meterReading=false;
  }
  get snapshot(){return structuredClone(this.state);}
  emit(){this.onChange(this.snapshot);}
  getHost(){if(!this.host) this.host=this.createHost();return this.host;}
  watch(){if(!this.timer) {this.timer=setInterval(()=>void this.refresh(),1000);this.timer.unref?.();}}
  watchMeter(){if(!this.meterTimer) {this.meterTimer=setInterval(()=>void this.readMeter(),50);this.meterTimer.unref?.();}}
  stopMeter(){clearInterval(this.meterTimer);this.meterTimer=null;this.state.recording.levels=[];}
  async readMeter(){
    if(this.closed||this.meterReading||this.state.recording.status!=='recording'||!this.host) return;
    this.meterReading=true;
    try {
      const value=await this.host.request('audio.meter');
      if(this.state.recording.status==='recording') {this.state.recording.levels=value.levels??[];this.state.recording.elapsedMs=value.elapsedMs;this.emit();}
    } catch(error) {
      if(this.state.recording.status==='recording') {this.state.error=`录音读取失败：${error.message}`;void this.stop().catch(()=>{});}
    } finally {this.meterReading=false;}
  }
  acceptHost(value,controls=true){
    if(controls) Object.assign(this.state,{volume:value.volume,inputs:value.inputs??[],outputs:value.outputs??[],inputId:value.inputId,outputId:value.outputId,error:''});
    if(this.state.recording.status==='recording') {
      this.state.recording.elapsedMs=value.elapsedMs;
      if(value.devicesChanged||value.failure||!value.recording) {
        this.state.recording.message=value.devicesChanged?'录音设备已改变，已停止录音':value.failure||'录音设备已停止';
        void this.stop().catch(()=>{});
      }
    }
  }
  async setEnabled(enabled){this.enabled=enabled;if(enabled){this.watch();await this.refresh();}else if(this.state.recording.status==='recording') await this.stop();else if(this.state.recording.status==='starting') {await this.operation;await this.stop();}this.releaseIdleHost();}
  releaseIdleHost(){if(!this.enabled&&!this.pending&&!this.operation){clearInterval(this.timer);this.timer=null;this.host?.close();this.host=null;}}
  async refresh(){
    if(this.closed||this.refreshing||(!this.enabled&&!this.pending)) return this.snapshot;
    this.refreshing=true;
    const version=this.controlVersion;
    try {
      const value=await this.getHost().request('audio.snapshot');
      this.acceptHost(value,version===this.controlVersion);
    } catch(error) {
      this.state.error=`音频读取失败：${error.message}`;
      if(this.state.recording.status==='recording') void this.stop().catch(()=>{});
      this.host?.close();this.host=null;
    } finally {this.refreshing=false;this.emit();}
    return this.snapshot;
  }
  async setVolume(volume){
    validateVolume(volume);this.controlVersion++;
    const value=await this.getHost().request('audio.volume',{volume});
    this.state.volume=value.volume;this.state.volumeRevision++;this.emit();return this.snapshot;
  }
  async setDefault(kind,deviceId){
    if(!['input','output'].includes(kind)||typeof deviceId!=='string'||!deviceId||deviceId.length>512) throw new TypeError('音频设备无效');
    if(this.operation||this.pending) throw new Error('录音或保存期间不能切换设备');
    if(!(kind==='input'?this.state.inputs:this.state.outputs).some(item=>item.id===deviceId)) throw new Error('设备不可用或方向不符');
    this.controlVersion++;
    try {this.acceptHost(await this.getHost().request('audio.device',{kind,deviceId}));this.emit();}
    catch(error) {await this.refresh();throw error;}
    return this.snapshot;
  }
  run(action){if(this.operation) return this.operation;this.operation=action().finally(()=>{this.operation=null;this.releaseIdleHost();});return this.operation;}
  start(){
    if(this.operation||this.pending) return Promise.reject(new Error('已有录音正在处理，请先保存'));
    if(!this.enabled) return Promise.reject(new Error('音频磁贴未开启'));
    return this.run(async()=>{
      if(this.encoderPath&&!fs.existsSync(this.encoderPath)) throw new Error('MP3 编码器未准备，请先运行 npm run prepare:audio');
      await this.refresh();
      if(!this.state.inputId||!this.state.outputId) throw new Error('需要可用的输出设备和默认通信麦克风');
      fs.mkdirSync(this.directory,{recursive:true});
      this.pending={id:randomUUID(),startedAt:Date.now(),elapsedMs:0};this.writeManifest();
      this.state.recording={status:'starting',elapsedMs:0};this.emit();
      try {await this.getHost().request('audio.start',{file:this.file('.pcm')});this.state.recording.status='recording';this.watch();this.watchMeter();}
      catch(error){
        this.state.recording={status:'error',elapsedMs:0,message:`无法开始录音：${error.message}`};
        if(!fs.existsSync(this.file('.pcm'))||fs.statSync(this.file('.pcm')).size===0){this.cleanPending();this.state.recording.status='idle';}
        throw error;
      } finally {this.emit();}
      return this.snapshot;
    });
  }
  file(extension){return path.join(this.directory,this.pending.id+extension);}
  writeManifest(){const temporary=this.file('.json.tmp');fs.writeFileSync(temporary,JSON.stringify(this.pending),'utf8');fs.renameSync(temporary,this.file('.json'));}
  cleanPending(){for(const extension of ['.pcm','.mp3','.json.tmp','.json']) {const file=this.file(extension);if(fs.existsSync(file)) fs.unlinkSync(file);}this.pending=null;}
  stop(auto=false){
    if(this.operation) return this.operation;
    if(!this.pending) return Promise.resolve(this.snapshot);
    return this.run(async()=>{
      this.stopMeter();this.state.recording.status='processing';this.emit();
      try {
        if(this.host) {try {const value=await this.host.request('audio.stop');this.pending.elapsedMs=value.elapsedMs;}catch(error){this.state.error=`采集已中断：${error.message}`;this.host.close();this.host=null;}}
        this.writeManifest();return await this.save(auto);
      } catch(error){this.failed(error);throw error;}
    });
  }
  retry(){if(this.operation) return this.operation;if(!this.pending) return Promise.reject(new Error('没有待保存录音'));return this.run(async()=>{try{return await this.save(false);}catch(error){this.failed(error);throw error;}});}
  failed(error){this.state.recording={status:'error',elapsedMs:this.pending?.elapsedMs??0,message:`保存失败，录音已保留：${error.message}`};this.emit();}
  async save(auto){
    const raw=this.file('.pcm'),mp3=this.file('.mp3');
    if(!fs.existsSync(raw)||fs.statSync(raw).size<4) throw new Error('没有可恢复的音频数据');
    this.state.recording.status='processing';this.emit();
    await this.encode(raw,mp3);
    if(!fs.existsSync(mp3)||fs.statSync(mp3).size===0) throw new Error('MP3 编码未输出音频');
    this.state.recording.status='saving';this.emit();
    const name=recordingName(this.pending.startedAt);
    const chosen=auto?null:await this.chooseSavePath(name);
    const destination=chosen ? (/\.mp3$/i.test(chosen)?chosen:chosen+'.mp3') : path.join(this.desktopPath,name);
    const savedPath=await copyWithoutOverwrite(mp3,destination);
    if(fs.statSync(savedPath).size!==fs.statSync(mp3).size) throw new Error('保存后的文件大小不一致');
    const elapsedMs=this.pending.elapsedMs||fs.statSync(raw).size/192;
    this.state.recording={status:'idle',elapsedMs,message:chosen?'录音已保存':'已保存到桌面',savedPath};
    try {this.cleanPending();}catch(error){this.pending=null;this.state.recording.message+='；临时文件暂未清理';console.error('录音已保存，临时文件清理失败：',error.message);}
    this.emit();return this.snapshot;
  }
  async recover(){
    if(!fs.existsSync(this.directory)) return;
    const files=fs.readdirSync(this.directory).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).sort();
    for(const file of files) {
      try {
        const meta=JSON.parse(fs.readFileSync(path.join(this.directory,file),'utf8'));
        if(meta.id+'.json'!==file||!Number.isFinite(meta.startedAt)||meta.startedAt<=0) throw new Error('恢复信息无效，原文件已保留');
        this.pending=meta;
        if(!fs.existsSync(this.file('.pcm'))||fs.statSync(this.file('.pcm')).size===0){this.cleanPending();continue;}
        await this.run(()=>this.save(true));
      } catch(error){this.failed(error);break;}
    }
  }
  async shutdown(){
    try {if(this.operation) await this.operation.catch(()=>{});if(this.pending) await this.stop(true);}
    finally {this.closed=true;clearInterval(this.timer);this.stopMeter();this.host?.close();this.host=null;}
  }
}
module.exports={AudioService,recordingName,copyWithoutOverwrite,validateVolume};
