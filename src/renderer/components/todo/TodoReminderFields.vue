<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { todoCalendarDays } from '../../../shared/todo';

defineProps<{ disabled: boolean }>();
const date = defineModel<string>('date', { required: true });
const time = defineModel<string[]>('time', { required: true });
const open = ref<'date' | 'time' | null>(null);
const month = ref('');
const panel = ref<HTMLElement>();
const days = computed(() => todoCalendarDays(month.value));
const units = ['时', '分', '秒'];
const pad = (value: number) => String(value).padStart(2, '0');

async function toggle(kind: 'date' | 'time') {
  open.value = open.value === kind ? null : kind;
  if (open.value === 'date') month.value = date.value.slice(0, 7);
  await nextTick();
  panel.value?.scrollIntoView({ block: 'nearest' });
  panel.value?.querySelectorAll<HTMLElement>('[aria-selected="true"]').forEach(option => option.scrollIntoView({ block: 'nearest' }));
}
function moveMonth(offset: number) {
  const [year, number] = month.value.split('-').map(Number);
  const next = new Date(0);
  next.setFullYear(year!, number! - 1 + offset, 1);
  if (next.getFullYear() < 1 || next.getFullYear() > 9999) return;
  month.value = `${String(next.getFullYear()).padStart(4, '0')}-${pad(next.getMonth() + 1)}`;
}
function chooseTime(index: number, value: number) {
  time.value = time.value.map((part, i) => i === index ? pad(value) : part);
}
function timeKey(event: KeyboardEvent, index: number) {
  const count = index === 0 ? 24 : 60;
  let value = Number(time.value[index]);
  if (event.key === 'ArrowDown') value = (value + 1) % count;
  else if (event.key === 'ArrowUp') value = (value + count - 1) % count;
  else if (event.key === 'Home') value = 0;
  else if (event.key === 'End') value = count - 1;
  else return;
  event.preventDefault();
  chooseTime(index, value);
  const option = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-value="${pad(value)}"]`);
  option?.focus();option?.scrollIntoView({ block: 'nearest' });
}
</script>

<template>
  <div class="todo-reminder-fields" @keydown.esc.stop="open = null">
    <span>日期</span>
    <button type="button" class="todo-picker-trigger" aria-label="提醒日期" :aria-expanded="open === 'date'" :disabled="disabled" @click="toggle('date')">
      <span>{{ date.replaceAll('-', ' / ') }}</span><span aria-hidden="true">▾</span>
    </button>
    <div v-if="open === 'date'" ref="panel" class="todo-picker-panel" role="group" aria-label="选择提醒日期">
      <div class="todo-calendar-heading">
        <button type="button" aria-label="上个月" :disabled="disabled || month === '0001-01'" @click="moveMonth(-1)">‹</button>
        <strong>{{ month.replace('-', ' 年 ') }} 月</strong>
        <button type="button" aria-label="下个月" :disabled="disabled || month === '9999-12'" @click="moveMonth(1)">›</button>
      </div>
      <div class="todo-calendar-grid">
        <span v-for="day in ['一','二','三','四','五','六','日']" :key="day" class="todo-calendar-weekday">{{ day }}</span>
        <template v-for="(day, index) in days" :key="index">
          <button v-if="day" type="button" :aria-label="`${month}-${pad(day)}`" :aria-pressed="date === `${month}-${pad(day)}`" :disabled="disabled" @click="date = `${month}-${pad(day)}`; open = null">{{ day }}</button>
          <span v-else aria-hidden="true"></span>
        </template>
      </div>
    </div>
    <div class="todo-clock-fields">
      <div v-for="(unit,index) in units" :key="unit" class="todo-clock-unit">
        <span>{{ unit }}</span>
        <button type="button" class="todo-picker-trigger" :aria-label="`提醒${unit}`" :aria-expanded="open === 'time'" :disabled="disabled" @click="toggle('time')"><span>{{ time[index] }}</span><span aria-hidden="true">▾</span></button>
      </div>
    </div>
    <div v-if="open === 'time'" ref="panel" class="todo-picker-panel todo-time-panel" role="group" aria-label="选择提醒时间">
      <div class="todo-clock-fields">
        <div v-for="(unit,index) in units" :key="unit" class="todo-time-column">
          <span class="todo-time-heading">{{ unit }}</span>
          <div class="todo-time-options" role="listbox" :aria-label="`选择${unit}`" @keydown="timeKey($event, index)">
            <button v-for="value in index === 0 ? 24 : 60" :key="value" type="button" role="option" :data-value="pad(value - 1)" :aria-selected="time[index] === pad(value - 1)" :tabindex="time[index] === pad(value - 1) ? 0 : -1" :disabled="disabled" @click="chooseTime(index, value - 1)">{{ pad(value - 1) }}</button>
          </div>
        </div>
      </div>
      <button type="button" class="todo-picker-done" :disabled="disabled" @click="open = null">确定</button>
    </div>
    <small>按本机时间提醒，精确到秒</small>
  </div>
</template>

<style>
.todo-reminder-fields{margin-top:10px;display:grid;gap:6px;font-size:12px}
.todo-reminder-fields button{border:1px solid #24292C25;border-radius:7px;background:#FFFFFF70;min-width:0;padding:5px;font:inherit;color:inherit}
.todo-reminder-fields button:disabled{opacity:.5;cursor:default}
.todo-picker-trigger{display:flex;align-items:center;justify-content:space-between;gap:4px;width:100%;min-height:30px;background:var(--todo-yellow)!important}
.todo-picker-trigger[aria-expanded="true"]{border-color:#24292C55}
.todo-picker-panel{padding:7px;border:1px solid #24292C25;border-radius:10px;background:var(--todo-yellow)}
.todo-calendar-heading{display:flex;align-items:center;justify-content:space-between;gap:2px;margin-bottom:7px}
.todo-calendar-heading strong{font-size:11px;font-weight:500}
.todo-calendar-heading button{padding:0;width:24px;height:24px;font-size:20px;background:#FFFFFF70}
.todo-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;text-align:center}
.todo-calendar-weekday{font-size:10px;line-height:20px;color:#465D67}
.todo-calendar-grid button{padding:0;min-height:24px;font-size:11px;border-color:transparent;border-radius:5px}
.todo-calendar-grid button[aria-pressed="true"]{background:#FFFFFFD0;border-color:#24292C55;font-weight:600}
.todo-clock-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
.todo-clock-unit{display:grid;gap:3px;min-width:0}
.todo-time-column{min-width:0;text-align:center}
.todo-time-heading{display:block;font-size:10px;color:#465D67;padding-bottom:5px}
.todo-time-options{height:112px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#24292C35 transparent;display:flex;flex-direction:column;gap:3px}
.todo-time-options button{flex:none;min-height:28px;border-color:transparent}
.todo-time-options button[aria-selected="true"]{background:#FFFFFFD0;border-color:#24292C55;font-weight:600}
.todo-picker-done{display:block;margin:7px 0 0 auto;background:#FFFFFFA0!important;padding:4px 12px!important}
.todo-reminder-fields button:hover:not(:disabled){background:#FFFFFFD0}
.todo-reminder-fields small{font-size:10px}
</style>
