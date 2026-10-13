<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { AudioSnapshot } from '../../../shared/contracts';

const props = defineProps<{ preview?: boolean; initial?: AudioSnapshot }>();
const sample: AudioSnapshot = { volume: 68, inputs: [{id:'example-mic',name:'通信麦克风 · 示例'}], outputs: [{id:'example-speaker',name:'音箱 · 示例'}], inputId:'example-mic', outputId:'example-speaker', recording: {status:'idle',elapsedMs:0}, error:'' };
const state = ref<AudioSnapshot>(props.initial ?? (props.preview ? sample : {volume:null, inputs:[], outputs:[], inputId:null, outputId:null, recording:{status:'idle',elapsedMs:0}, error:''}));
const busy = ref(false);
const picker = ref<'input'|'output'|null>(null);
const pickerKind = ref<'input'|'output'>('output');
const root = ref<HTMLElement>();
const volume = ref(state.value.volume ?? 0);
const changingVolume = ref(false);
const error = ref('');
let pendingVolume: number | undefined;
let disposed = false;
let removeListener: (()=>void)|undefined;
const recording = computed(()=>state.value.recording.status==='recording');
const processing = computed(()=>['starting','processing','saving'].includes(state.value.recording.status));
const statusMessage = computed(()=>error.value || state.value.error || (state.value.recording.status==='error' ? state.value.recording.message : '') || '');
const devices = computed(()=>pickerKind.value==='input' ? state.value.inputs : state.value.outputs);
const levels = computed(()=>Array.from({length:20},(_,index)=>Math.min(1,Math.sqrt(state.value.recording.levels?.[index] ?? 0)*2)));
const elapsed = computed(()=>{
  const seconds=Math.floor(state.value.recording.elapsedMs/1000);
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(value=>String(value).padStart(2,'0')).join(':');
});
function accept(value: AudioSnapshot) {
  // An IPC broadcast may arrive after a newer invoke reply; keep the acknowledged volume.
  if((value.volumeRevision ?? 0)<(state.value.volumeRevision ?? 0)) value={...value,volume:state.value.volume,volumeRevision:state.value.volumeRevision};
  state.value=value;
  if(!changingVolume.value) volume.value=value.volume ?? 0;
  if(value.recording.status!=='idle') picker.value=null;
}
function name(kind:'input'|'output') { return (kind==='input'?state.value.inputs:state.value.outputs).find(item=>item.id===(kind==='input'?state.value.inputId:state.value.outputId))?.name ?? '无可用设备'; }
async function run(action:()=>Promise<AudioSnapshot>) {
  if(busy.value) return;
  busy.value=true;error.value='';
  try { accept(await action()); } catch(cause) { error.value=cause instanceof Error?cause.message:String(cause); }
  finally { busy.value=false; }
}
async function openPicker(kind:'input'|'output') {
  pickerKind.value=kind;
  picker.value=picker.value===kind?null:kind;
  await nextTick();
  (root.value?.querySelector<HTMLButtonElement>('.audio-picker [aria-selected="true"]') ?? root.value?.querySelector<HTMLButtonElement>('.audio-picker button'))?.focus();
}
function closePicker() { picker.value=null; }
function outside(event: PointerEvent) {
  const target=event.target as Element;
  if(!root.value?.contains(target) || (!target.closest('.audio-picker') && !target.closest('[data-device]'))) closePicker();
}
function focusOutside(event: FocusEvent) {
  if(!root.value?.contains(event.relatedTarget as Node|null)) closePicker();
}
async function selectDevice(id:string) {
  const kind=picker.value;
  if(!kind || busy.value) return;
  closePicker();
  const previous=state.value;
  state.value={...state.value,[kind==='input'?'inputId':'outputId']:id};
  root.value?.querySelector<HTMLButtonElement>(`[data-device="${kind}"]`)?.focus();
  if(props.preview) return;
  busy.value=true;error.value='';
  try {accept(await window.deskIsland.setDefaultAudioDevice(kind,id));}
  catch(cause) {
    state.value=previous;
    error.value=cause instanceof Error?cause.message:String(cause);
    try {accept(await window.deskIsland.getAudioSnapshot());} catch { /* Keep the switch error and previous device visible. */ }
  } finally {busy.value=false;}
}
async function flushVolume() {
  if(changingVolume.value) return;
  changingVolume.value=true;error.value='';
  try {
    // Send immediately, then keep the latest wheel target while Windows acknowledges it.
    while(pendingVolume!==undefined && !disposed) {
      const target=pendingVolume;pendingVolume=undefined;
      accept(await window.deskIsland.setSystemVolume(target));
    }
  } catch(cause) {pendingVolume=undefined;error.value=cause instanceof Error?cause.message:String(cause);}
  finally {changingVolume.value=false;volume.value=state.value.volume ?? 0;}
}
function wheelVolume(event: WheelEvent) {
  if(state.value.volume===null || event.deltaY===0) return;
  const target=Math.max(0,Math.min(100,volume.value+(event.deltaY<0?2:-2)));
  if(target===volume.value) return;
  volume.value=target;
  if(props.preview) {state.value={...state.value,volume:target};return;}
  pendingVolume=target;void flushVolume();
}
async function record() {
  if(props.preview) return;
  await run(()=>recording.value?window.deskIsland.stopAudioRecording():state.value.recording.status==='error'?window.deskIsland.retrySaveAudioRecording():window.deskIsland.startAudioRecording());
}
function pickerKeys(event:KeyboardEvent) {
  if(event.key==='Escape') {event.preventDefault();picker.value=null;return;}
  if(!picker.value || !['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
  event.preventDefault();const buttons=[...root.value!.querySelectorAll<HTMLButtonElement>('.audio-picker button')];
  const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
  buttons[next]?.focus();
}
onMounted(()=>{
  document.addEventListener('pointerdown',outside);
  window.addEventListener('blur',closePicker);
  if(props.preview) return;
  removeListener=window.deskIsland.onAudioChanged(accept);
  void run(()=>window.deskIsland.getAudioSnapshot());
});
onBeforeUnmount(()=>{
  disposed=true;pendingVolume=undefined;removeListener?.();
  document.removeEventListener('pointerdown',outside);
  window.removeEventListener('blur',closePicker);
});
</script>

<template>
  <section ref="root" class="audio-face" aria-label="多媒体" @keydown="pickerKeys" @focusout="focusOutside">
    <h2 class="audio-title">多媒体</h2>
    <header class="audio-header">
      <span>音量</span>
      <div class="audio-slider" :class="{'audio-slider--disabled':state.volume===null}" role="slider" :tabindex="state.volume===null?-1:0" aria-label="系统音量，仅滚轮调节，每次 2 格" title="滚轮调节音量，每次 2 格" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="volume" :aria-valuetext="state.volume===null?'不可用':volume+'%'" :aria-disabled="state.volume===null" @wheel.prevent="wheelVolume" @pointerdown.prevent>
        <span class="audio-slider-track"><span class="audio-slider-fill" :style="{width:volume+'%'}"></span><span class="audio-slider-thumb" :style="{left:volume+'%'}"></span></span>
      </div>
      <span class="audio-volume">{{ state.volume===null?'—':volume+'%' }}</span>
      <span v-if="preview" class="audio-example">示例</span>
    </header>
    <div class="audio-devices">
      <div v-for="kind in (['output','input'] as const)" :key="kind" class="audio-device">
        <span>{{ kind==='output'?'输出':'输入' }}</span>
        <button type="button" :data-device="kind" :aria-label="(kind==='output'?'输出设备':'默认通信输入设备')+'：'+name(kind)" :title="name(kind)" aria-haspopup="listbox" :aria-expanded="picker===kind" :disabled="busy || recording || processing || !(kind==='output'?state.outputs:state.inputs).length" @click="openPicker(kind)"><span>{{ name(kind) }}</span><svg class="audio-chevron" :class="{'audio-chevron--open':picker===kind}" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button>
      </div>
    </div>
    <div class="audio-record">
      <template v-if="recording">
        <time>{{ elapsed }}</time>
        <button type="button" class="audio-stop" aria-label="停止录音" title="停止录音" :disabled="busy" @click="record">
          <span class="audio-waveform" aria-hidden="true"><span v-for="(level,index) in levels" :key="index" :style="{height:(2+level*22)+'px'}"></span></span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
        </button>
      </template>
      <span v-else-if="processing" role="status">{{ state.recording.status==='starting'?'正在开始…':'正在处理…' }}</span>
      <button v-else-if="state.recording.status==='error'" type="button" class="audio-retry" :disabled="busy" @click="record">重试保存</button>
      <button v-else type="button" class="audio-start" aria-label="开始录音" title="开始录音" :disabled="busy || !state.inputId || !state.outputId" @click="record"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3m-3 0h6" /></svg></button>
      <p v-if="statusMessage" class="audio-status" role="status" :title="statusMessage">{{ statusMessage }}</p>
    </div>
    <Transition name="audio-picker">
      <div v-if="picker" :key="picker" class="audio-picker-backdrop" @pointerdown.self="closePicker">
        <div class="audio-picker" role="listbox" :aria-label="pickerKind==='input'?'选择默认通信麦克风':'选择输出设备'">
          <button v-for="item in devices" :key="item.id" type="button" role="option" :aria-selected="item.id===(pickerKind==='input'?state.inputId:state.outputId)" :title="item.name" @click="selectDevice(item.id)"><span>{{ item.name }}</span><span v-if="item.id===(pickerKind==='input'?state.inputId:state.outputId)" aria-hidden="true">✓</span></button>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style>
.audio-face{height:100%;padding:10px;color:#fafafa;display:flex;flex-direction:column;position:relative;user-select:none;font-size:14px;font-weight:400;line-height:1.35;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif}
.audio-title{margin:0 0 4px;font:inherit;flex:none;color:#e6e2e6}
.audio-header{display:flex;align-items:center;gap:9px;min-height:24px;font-size:inherit;color:#e6e2e6;flex:none}
.audio-header>span{flex:none}.audio-volume{font-size:inherit;font-variant-numeric:tabular-nums;min-width:42px;text-align:right}.audio-example{font-size:inherit}
.audio-slider{flex:1;min-width:0;height:24px;display:flex;align-items:center;padding:0 4px;cursor:ns-resize}.audio-slider-track{height:4px;width:100%;position:relative;border-radius:3px;background:#ffffff29}.audio-slider-fill{position:absolute;inset:0 auto 0 0;border-radius:inherit;background:#eee9ef}.audio-slider-thumb{position:absolute;top:50%;width:9px;height:9px;border-radius:50%;background:#fafafa;transform:translate(-50%,-50%);box-shadow:0 1px 4px #0004}.audio-slider--disabled{opacity:.45;cursor:default}
.audio-devices{display:grid;gap:6px;margin-top:6px}.audio-device{display:flex;align-items:center;gap:9px;font-size:inherit;min-width:0}.audio-device>span{flex:none;color:#e6e2e6}.audio-device button{display:flex;justify-content:space-between;align-items:center;gap:6px;min-width:0;flex:1;height:28px;border:1px solid #ffffff26;border-radius:10px;background:#ffffff10;color:inherit;padding:0 9px;font:inherit;text-align:left;cursor:pointer}.audio-device button>span:first-child{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.audio-chevron{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;transition:transform 220ms ease}.audio-chevron--open{transform:rotate(180deg)}
.audio-record{margin:0 0 -10px;display:flex;align-items:center;justify-content:center;gap:8px;min-height:40px;flex:1;font-size:inherit}.audio-record button{font:inherit;border:1px solid #ffffff26;background:#ffffff14;color:#fafafa;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 180ms ease,transform 180ms ease}.audio-record button:hover{background:#ffffff24}.audio-record button:active{transform:scale(.96)}.audio-record .audio-start{width:40px;height:40px;border-radius:50%;padding:9px}.audio-start svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.audio-record .audio-stop{height:40px;padding:0 10px;gap:10px;border-radius:22px;color:#f39494}.audio-stop svg{width:24px;height:24px;flex:none;fill:currentColor}.audio-waveform{height:26px;display:flex;align-items:center;gap:2px}.audio-waveform>span{width:2px;border-radius:2px;background:currentColor;transition:height 50ms linear}.audio-record time{font-size:inherit;font-variant-numeric:tabular-nums}.audio-record .audio-retry{border-radius:10px;padding:8px 13px}
.audio-status{min-width:0;max-width:calc(100% - 48px);font:inherit;margin:0;color:#e6e2e6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none}
.audio-picker-backdrop{position:absolute;inset:0;z-index:1;background:#080a0e44;display:flex;align-items:center;padding:12px;border-radius:inherit}.audio-picker{max-height:calc(100% - 8px);overflow:auto;width:100%;padding:5px;border:1px solid #ffffff30;background:#17191fe6;border-radius:14px;box-shadow:0 8px 24px #0005;scrollbar-width:thin;scrollbar-color:#ffffff40 transparent}.audio-picker button{width:100%;display:flex;align-items:center;gap:8px;justify-content:space-between;text-align:left;padding:10px 8px;border:0;background:transparent;border-radius:9px;color:#fafafa;font:inherit;cursor:pointer;transition:background 150ms ease}.audio-picker button>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.audio-picker button:hover,.audio-picker button[aria-selected=true]{background:#ffffff14}
.audio-picker-enter-active,.audio-picker-leave-active{transition:opacity 220ms cubic-bezier(.2,.8,.2,1)}.audio-picker-enter-active .audio-picker,.audio-picker-leave-active .audio-picker{transition:transform 220ms cubic-bezier(.2,.8,.2,1),opacity 220ms ease}.audio-picker-enter-from,.audio-picker-leave-to{opacity:0}.audio-picker-enter-from .audio-picker,.audio-picker-leave-to .audio-picker{opacity:0;transform:translateY(-7px) scale(.97)}.audio-picker-leave-active{pointer-events:none}
.audio-face button:disabled{opacity:.45;cursor:default}.audio-face button:focus-visible,.audio-slider:focus-visible{outline:2px solid #eee9ef;outline-offset:2px}
@media(prefers-reduced-motion:reduce){.audio-face *{transition:none!important}}
</style>
