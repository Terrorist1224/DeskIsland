<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue';
const props = defineProps<{ modelValue: number }>();
const emit = defineEmits<{ 'update:modelValue': [number] }>();
const units = [{label:'时',factor:3600,max:24},{label:'分',factor:60,max:59},{label:'秒',factor:1,max:59}];
const tracks: HTMLElement[] = [];
const animations: (Animation | undefined)[] = [];
watch(() => units.map((_,index) => value(index)), (next, previous) => {
  next.forEach((number,index) => {
    const track=tracks[index];
    if (!track || number===previous[index]) return;
    const range=units[index]!.max+1;
    let delta=number-previous[index]!;
    if(delta>range/2) delta-=range;
    if(delta < -range/2) delta+=range;
    // Preserve the current translation when wheel inputs interrupt an unfinished slide.
    const offset=new DOMMatrixReadOnly(getComputedStyle(track).transform).m42;
    animations[index]?.cancel();
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animations[index]=track.animate([{transform:`translateY(${offset+Math.sign(delta)*Math.min(2,Math.abs(delta))*26}px)`},{transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.2,.7,.2,1)'});
  });
}, {flush:'post'});
onBeforeUnmount(()=>animations.forEach(animation=>animation?.cancel()));
function value(index: number) { return Math.floor(props.modelValue / units[index]!.factor) % (index === 0 ? 25 : 60); }
function change(index: number, delta: number) {
  const unit = units[index]!;
  const next = (value(index) + delta + unit.max + 1) % (unit.max + 1);
  let seconds = props.modelValue + (next - value(index)) * unit.factor;
  if (index === 0 && next === 24) seconds = 86400;
  else if (index !== 0 && props.modelValue === 86400) seconds = next * unit.factor;
  emit('update:modelValue', seconds);
}
let drag: {index: number; y: number; scale: number} | null = null;
function down(event: PointerEvent, index: number) {
  const element = event.currentTarget as HTMLElement;
  drag = {index, y:event.clientY, scale:element.getBoundingClientRect().height / element.offsetHeight};element.setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (!drag) return;
  const steps = Math.trunc((drag.y - event.clientY) / (26 * drag.scale));
  if (steps) { change(drag.index, steps);drag.y -= steps * 26 * drag.scale; }
}
</script>
<template>
  <div class="time-wheels">
    <div v-for="(unit,index) in units" :key="unit.label" class="time-wheel" role="spinbutton" tabindex="0" :aria-label="unit.label" :aria-valuemin="0" :aria-valuemax="unit.max" :aria-valuenow="value(index)"
      @wheel.prevent="change(index,$event.deltaY > 0 ? 1 : -1)" @keydown.up.prevent="change(index,-1)" @keydown.down.prevent="change(index,1)"
      @pointerdown="down($event,index)" @pointermove="move" @pointerup="drag=null" @pointercancel="drag=null" @lostpointercapture="drag=null">
      <div :ref="element=>{if(element) tracks[index]=element as HTMLElement}" class="wheel-track"><button v-for="offset in [-3,-2,-1,0,1,2,3]" :key="offset" type="button" tabindex="-1" :style="{top:`${53+offset*26}px`}" :class="{'wheel-selected':offset===0,'wheel-far':Math.abs(offset)>=2}" @click="change(index,offset)">{{ String((value(index)+offset+unit.max+1)%(unit.max+1)).padStart(2,'0') }}</button></div><small>{{ unit.label }}</small>
    </div>
  </div>
</template>
<style scoped>
 .time-wheels{display:flex;justify-content:space-between;width:100%;height:132px}.time-wheel{position:relative;overflow:hidden;width:32%;height:132px;touch-action:none;cursor:ns-resize;mask-image:linear-gradient(transparent,#000 18%,#000 82%,transparent)}.wheel-track{position:absolute;inset:0;will-change:transform}.time-wheel button{position:absolute;left:0;height:26px;line-height:26px;border:0;background:none;color:#ffffff55;font:inherit;font-size:17px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;width:100%;cursor:inherit}.time-wheel .wheel-selected{color:#f4f4f5;font-size:29px}.time-wheel .wheel-far{color:#ffffff20;font-size:12px}.time-wheel small{position:absolute;right:0;top:53px;height:26px;display:flex;align-items:center;font-size:10px;color:#b5b8c1;pointer-events:none}.time-wheel:focus-visible{outline:2px solid #bedae4;border-radius:8px}
</style>
