<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import type { CountdownPreset, CountdownState, DesktopIslandBridge } from '../../../shared/contracts';
import { TODO_COLORS } from '../../../shared/todo';
import TimeWheels from './TimeWheels.vue';
const props = defineProps<{ preview?: boolean; compact?: boolean }>();
const state = ref<CountdownState>({status:'idle',seconds:0,name:'',remainingMs:0,deadline:null,color:TODO_COLORS[2]!.value});
const seconds = ref(0), draftSeconds = ref(180), name = ref(''), error = ref(''), busy = ref(false);
const presets = ref<CountdownPreset[]>([]);
const page = ref<'timer'|'presets'|'add'>('timer');
const now = ref(Date.now());
let frame = 0, unsubscribe: (()=>void) | undefined;
let request = 0;
let selected: number | null = null;
const remaining = computed(() => Math.max(0, state.value.status === 'running' ? (state.value.deadline ?? now.value)-now.value : state.value.remainingMs));
const running = computed(() => state.value.status !== 'idle');
function format(value: number) { const s=Math.ceil(value);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':'); }
const progress = computed(() => state.value.seconds ? Math.min(1, remaining.value / (state.value.seconds * 1000)) : 0);
const scrollTargets = new WeakMap<HTMLElement,number>();
function resetNameScroll(event: Event) { scrollTargets.delete(event.currentTarget as HTMLElement); }
function scrollName(event: WheelEvent) {
  const element=event.currentTarget as HTMLElement;
  if(element.scrollWidth<=element.clientWidth) return;
  event.preventDefault();
  const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
  const left=Math.max(0,Math.min(element.scrollWidth-element.clientWidth,(scrollTargets.get(element) ?? element.scrollLeft)+delta));
  scrollTargets.set(element,left);element.scrollTo({left});
}
// Only the running display follows animation frames; deadlines remain owned by the main process.
function advanceFrame() { now.value=Date.now();frame=requestAnimationFrame(advanceFrame); }
watch(()=>state.value.status, status=>{
  cancelAnimationFrame(frame);now.value=Date.now();
  if(status==='running') frame=requestAnimationFrame(advanceFrame);
});
async function load() {
  if(props.preview || busy.value) return;
  const token=++request;
  try {
    const result=await window.deskIsland.countdown('get');
    if(token!==request) return;
    state.value=result.state;seconds.value=result.seconds;presets.value=result.presets;
    if(running.value) page.value='timer';
  } catch(e) { error.value=e instanceof Error?e.message:'读取倒计时失败'; }
}
async function act(action: Parameters<DesktopIslandBridge['countdown']>[0], input?: Parameters<DesktopIslandBridge['countdown']>[1]) {
  if(props.preview || busy.value) return;
  busy.value=true;error.value='';++request;
  try {
    const result=await window.deskIsland.countdown(action,input);
    state.value=result.state;seconds.value=result.seconds;presets.value=result.presets;
    if(action==='start'||action==='cancel'||action==='acknowledge') page.value='timer';
    if(action==='add') {page.value='presets';name.value='';}
  } catch(e) {error.value=e instanceof Error?e.message:'操作失败';}
  finally {busy.value=false;}
}
async function select(value: number) {
  seconds.value=value;selected=value;
  if(props.preview || busy.value) return;
  busy.value=true;error.value='';++request;
  try {
    while(selected!==null) {const next=selected;selected=null;await window.deskIsland.countdown('select',{seconds:next});}
  } catch(e) {selected=null;error.value=e instanceof Error?e.message:'保存时长失败';}
  finally {busy.value=false;}
}
onMounted(()=>{if(!props.preview){void load();unsubscribe=window.deskIsland.onWidgetSettingsChange(()=>void load());}});
onBeforeUnmount(()=>{cancelAnimationFrame(frame);unsubscribe?.();++request;});
</script>
<template>
  <section class="countdown" :class="{'countdown--running':running,'countdown--compact':compact}" :style="{'--timer-color':state.color}" :aria-busy="busy">
    <header><strong v-if="page==='timer'">倒计时</strong><button v-else type="button" aria-label="返回" @click="page=page==='add'?'presets':'timer'">←</button><small v-if="preview">预览示例</small><strong v-if="page==='add'">新增预设</strong><button v-if="!running && page!=='add'" type="button" :aria-label="page==='presets'?'新增预设':'打开预设'" @click="page=page==='presets'?'add':'presets'"><span v-if="page==='presets'">＋</span><span v-else class="two-dots"><i></i><i></i></span></button></header>
    <template v-if="page==='timer'">
      <div v-if="state.status==='finished'" class="countdown-finished" role="status"><p class="finished-name scroll-name" tabindex="0" :title="state.name || '倒计时'" @wheel="scrollName" @scrollend="resetNameScroll" @pointerdown="resetNameScroll"><span>{{ state.name || '倒计时' }}</span></p><p class="finished-label">结束</p></div>
      <div v-else-if="running" class="clock">
        <svg viewBox="0 0 160 160" role="progressbar" aria-label="倒计时剩余进度" :aria-valuenow="Math.round(progress*100)" :aria-valuemin="0" :aria-valuemax="100"><circle cx="80" cy="80" r="65" fill="#10151bb3" /><circle cx="80" cy="80" r="73" fill="none" stroke="#ffffff12" stroke-width="12" />
          <circle class="progress-ring" cx="80" cy="80" r="73" fill="none" :stroke="state.color" stroke-width="12" stroke-linecap="round" pathLength="100" stroke-dasharray="100" :stroke-dashoffset="(1-progress)*100" transform="rotate(-90 80 80)" />
        </svg>
        <div class="clock-value"><small v-if="state.name" class="scroll-name" tabindex="0" :title="state.name" @wheel="scrollName" @scrollend="resetNameScroll" @pointerdown="resetNameScroll"><span>{{ state.name }}</span></small><time>{{ format(remaining/1000) }}</time></div>
      </div>
      <TimeWheels v-else :model-value="seconds" @update:model-value="select" />
      <footer v-if="state.status==='finished'"><button class="timer-control" type="button" aria-label="确认结束" title="确认结束" :disabled="busy" @click="act('acknowledge')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12L10 17L19 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></button></footer>
      <footer v-else-if="running">
        <button class="timer-control" type="button" :aria-label="state.status==='paused'?'继续':'暂停'" :title="state.status==='paused'?'继续':'暂停'" :disabled="busy" @click="act(state.status==='paused'?'resume':'pause')"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="state.status==='paused'" d="M8 5L19 12L8 19Z" fill="currentColor" /><g v-else fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></g></svg></button>
        <button class="timer-control" type="button" aria-label="取消" title="取消" :disabled="busy" @click="act('cancel')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg></button>
      </footer>
      <footer v-else><button class="start" type="button" aria-label="开始倒计时" :disabled="preview || busy || seconds===0" @click="act('start',{seconds})">▶</button></footer>
    </template>
    <div v-else-if="page==='presets'" class="presets"><p v-if="!presets.length">暂无预设，点击＋添加</p><article v-for="preset in presets" :key="preset.id"><span :title="preset.name">{{ preset.name }}</span><time>{{ format(preset.seconds) }}</time><button type="button" :aria-label="`启动${preset.name}`" :disabled="busy" @click="act('start',{id:preset.id})"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5L19 12L8 19Z" fill="currentColor" /></svg></button><button type="button" :aria-label="`删除${preset.name}`" :disabled="busy" @click="act('delete',{id:preset.id})"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg></button></article></div>
    <form v-else @submit.prevent="act('add',{name,seconds:draftSeconds})"><input v-model="name" aria-label="预设名称" placeholder="预设名称，例如泡面" maxlength="40" required /><TimeWheels v-model="draftSeconds" /><button class="preset-save" type="submit" :disabled="busy || !name.trim() || !draftSeconds">保存</button></form>
    <p v-if="error" class="countdown-error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.countdown{height:240px;width:240px;padding:10px 14px;color:#f4f4f5;display:flex;flex-direction:column;gap:5px;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif}.countdown header{height:27px;display:flex;align-items:center;justify-content:space-between;flex:none}.countdown strong{font-size:16px;font-weight:500}.countdown button{font:inherit;color:inherit;border:0;background:#ffffff12;border-radius:8px;cursor:pointer;min-width:42px;min-height:42px}.countdown button:disabled{opacity:.4;cursor:default}.countdown button:focus-visible,.countdown input:focus-visible{outline:2px solid #bedae4;outline-offset:2px}.countdown header button{background:none;font-size:30px}.countdown header small{font-size:18px;color:#b5b8c1}.two-dots{display:flex;flex-direction:column;align-items:center;gap:3px}.two-dots i{width:7px;height:7px;border:1.5px solid currentColor;border-radius:50%}.countdown footer{display:flex;justify-content:center;gap:14px;margin-top:auto}.countdown--running{gap:0;padding-top:6px;padding-bottom:8px}.countdown--running header{height:28px}.countdown footer .start{border-radius:50%;width:48px;height:48px;font-size:24px;background:#c72d35;box-shadow:0 4px 16px #be202033}.clock{width:156px;height:156px;position:relative;margin:0 auto}.clock svg{width:156px;height:156px}.timer-control{display:grid;place-items:center;width:42px;height:42px;padding:7px;border-radius:50%!important}.timer-control svg{display:block;width:28px;height:28px}.clock-value{position:absolute;inset:0 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;pointer-events:none}.clock-value time{font-size:27px;font-weight:400;letter-spacing:-.5px;font-variant-numeric:tabular-nums}.clock-value small{display:block;width:100%;text-align:center;font-size:27px;line-height:1.25;font-weight:700;color:var(--timer-color);text-shadow:0 1px 3px #0008;pointer-events:auto}.presets{overflow:auto;flex:1;scrollbar-width:none}.presets p{font-size:18px;color:#b5b8c1;text-align:center}.presets article{display:grid;grid-template-columns:minmax(0,1fr) 48px 48px;align-items:center;column-gap:8px;row-gap:4px;min-height:64px;padding:12px 0;border-bottom:1px solid #ffffff18;font-size:24px}.presets article span{grid-column:1;min-width:0;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}.presets time{grid-column:1;grid-row:2;font-variant-numeric:tabular-nums;font-size:21px}.presets button{grid-row:1/3;display:grid;place-items:center;width:48px;height:48px;padding:7px}.presets button:first-of-type{grid-column:2}.presets button:last-of-type{grid-column:3}.presets button svg{width:32px;height:32px;display:block}.countdown form{display:flex;flex-direction:column;gap:4px}.countdown input{width:100%;background:#ffffff12;border:1px solid #ffffff26;border-radius:6px;color:inherit;padding:5px;font:inherit;font-size:18px;user-select:text}.countdown-finished{height:156px;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:12px;text-align:center}.countdown-finished p{margin:0;max-width:100%;overflow-wrap:anywhere}.finished-name{width:100%;font-size:33px;font-weight:700;line-height:1.3;color:var(--timer-color);text-shadow:0 1px 3px #0008}.finished-label{font-size:24px;line-height:1.3;color:#f4f4f5}.clock-value small:focus-visible,.finished-name:focus-visible{outline:2px solid var(--timer-color);outline-offset:2px;border-radius:4px}.countdown form :deep(.time-wheels),.countdown form :deep(.time-wheel){height:100px}.countdown form :deep(.wheel-track){top:-16px}.countdown form :deep(.time-wheel small){top:31px}.countdown form .preset-save{align-self:center;width:96px;height:42px;margin-top:-4px;font-size:18px}.countdown-error{position:absolute;bottom:4px;left:8px;right:8px;background:#24171fee;color:#ffc6aa;padding:5px;border-radius:5px;font-size:18px;overflow-wrap:anywhere;margin:0}
.countdown--compact strong{font-size:21px}
.scroll-name{overflow-x:auto;overflow-y:hidden;scrollbar-width:none;white-space:nowrap;touch-action:pan-x;scroll-behavior:smooth}.scroll-name::-webkit-scrollbar{display:none}.scroll-name span{display:block;width:max-content;min-width:100%;text-align:center}
@media(prefers-reduced-motion:reduce){.scroll-name{scroll-behavior:auto}}
</style>
