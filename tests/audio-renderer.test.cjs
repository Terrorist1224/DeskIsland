const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {ref,computed,nextTick}=require('vue');
const {transpile}=require('typescript');

function tile(bridge) {
  const source=readFileSync(require.resolve('../src/renderer/components/audio/AudioTile.vue'),'utf8');
  const script=source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
  const initial={volume:24,inputs:[{id:'mic',name:'测试麦克风'}],outputs:[{id:'speaker',name:'测试音箱'},{id:'headphones',name:'测试耳机'}],inputId:'mic',outputId:'speaker',recording:{status:'idle',elapsedMs:0},error:''};
  return new Function('defineProps','ref','computed','nextTick','onMounted','onBeforeUnmount','window',transpile(script)+';return {wheelVolume,selectDevice,accept,volume,state,picker,busy,error,changingVolume,statusMessage};')(
    ()=>({initial}),ref,computed,nextTick,()=>{},()=>{},{deskIsland:bridge});
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('successful recordings leave only the microphone while failures retain their message',()=>{
  const view=tile({});
  view.accept({...view.state.value,recording:{status:'idle',elapsedMs:1000,message:'已保存到桌面',savedPath:'test.mp3'}});
  assert.equal(view.statusMessage.value,'');
  view.accept({...view.state.value,recording:{status:'error',elapsedMs:1000,message:'测试保存失败'}});
  assert.equal(view.statusMessage.value,'测试保存失败');
  view.error.value='测试切换失败';assert.equal(view.statusMessage.value,'测试切换失败');
});

test('late volume broadcasts cannot rewind the display after the latest wheel request completes',async()=>{
  const view=tile({setSystemVolume:async volume=>({...view.state.value,volume,volumeRevision:2})});
  view.wheelVolume({deltaY:-120});await settle();assert.equal(view.volume.value,26);
  view.accept({...view.state.value,volume:24,volumeRevision:1});assert.equal(view.volume.value,26);
  assert.equal(view.state.value.volume,26);
  view.accept({...view.state.value,volume:32,volumeRevision:2});assert.equal(view.volume.value,32,'external Windows changes still synchronize');
});

test('wheel sends 2 points immediately, coalesces rapid changes and ignores stale displayed volume',async()=>{
  const requests=[];let finish;
  const view=tile({setSystemVolume:volume=>{requests.push(volume);return new Promise(resolve=>{finish=resolve;});}});
  view.wheelVolume({deltaY:-120});assert.deepEqual(requests,[26]);
  view.wheelVolume({deltaY:-120});view.wheelVolume({deltaY:-120});
  view.accept({...view.state.value,volume:24});assert.equal(view.volume.value,30);
  finish({...view.state.value,volume:26});await settle();assert.deepEqual(requests,[26,30]);
  finish({...view.state.value,volume:30});await settle();assert.equal(view.volume.value,30);assert.equal(view.changingVolume.value,false);
  view.wheelVolume({deltaY:120});assert.deepEqual(requests,[26,30,28]);
  finish({...view.state.value,volume:28});await settle();
});

test('wheel clamps at endpoints, ignores horizontal events and recovers after failure',async()=>{
  const requests=[];let failing=false;
  const view=tile({setSystemVolume:async volume=>{requests.push(volume);if(failing) throw new Error('测试音量失败');return {...view.state.value,volume};}});
  view.accept({...view.state.value,volume:99});view.wheelVolume({deltaY:-1});await settle();assert.equal(view.volume.value,100);
  view.wheelVolume({deltaY:-1});view.wheelVolume({deltaY:0});assert.deepEqual(requests,[100]);
  view.accept({...view.state.value,volume:1});view.wheelVolume({deltaY:1});await settle();assert.equal(view.volume.value,0);
  failing=true;view.wheelVolume({deltaY:-1});await settle();assert.equal(view.volume.value,0);assert.match(view.error.value,/测试音量失败/);
  failing=false;view.wheelVolume({deltaY:-1});await settle();assert.equal(view.volume.value,2);
});

test('device picker closes and label updates before Windows responds; failed switches restore actual device',async()=>{
  let finish,fail;
  const view=tile({setDefaultAudioDevice:()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject;}),getAudioSnapshot:async()=>({...view.state.value,outputId:'speaker'})});
  view.picker.value='output';const pending=view.selectDevice('headphones');
  assert.equal(view.picker.value,null);assert.equal(view.state.value.outputId,'headphones');assert.equal(view.busy.value,true);
  finish({...view.state.value});await pending;assert.equal(view.busy.value,false);
  view.accept({...view.state.value,outputId:'speaker'});view.picker.value='output';const failed=view.selectDevice('headphones');
  fail(new Error('测试设备失败'));await failed;assert.equal(view.state.value.outputId,'speaker');assert.match(view.error.value,/测试设备失败/);
});
