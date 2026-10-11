<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { ReminderItem } from '../../../shared/contracts';
import { TODO_COLORS, formatTodoTime } from '../../../shared/todo';
const items = ref<ReminderItem[]>([]);
const now = ref(Date.now());
const error = ref('');
let timer: ReturnType<typeof setInterval>;
let unsubscribe: (() => void) | undefined;
onMounted(async () => {
  timer = setInterval(() => { now.value = Date.now(); }, 250);
  unsubscribe = window.todoReminder.onItems(value => { items.value = value; });
  try { items.value = await window.todoReminder.getItems(); }
  catch { error.value = '读取提醒失败，请关闭提醒'; }
});
onBeforeUnmount(() => { clearInterval(timer);unsubscribe?.(); });
async function dismiss() {
  try { await window.todoReminder.dismiss(); }
  catch { error.value = '关闭失败，请按Esc退出'; }
}
</script>

<template>
  <main class="reminder-page">
    <header><p>{{ formatTodoTime(now).split(' ')[0] }}</p><time>{{ formatTodoTime(now).split(' ')[1] }}</time></header>
    <h1>{{ items.every(item => item.source === 'countdown') ? '倒计时结束' : items.some(item => item.source === 'countdown') ? '到期提醒' : '待办时间到了' }}</h1>
    <section class="reminder-items" aria-label="到期提醒" tabindex="0">
      <article v-for="item in items" :key="item.id" :style="{ background: TODO_COLORS.find(color => color.id === item.color)!.value }"><p>{{ item.text }}</p><small>{{ formatTodoTime(item.remindAt!) }}</small></article>
    </section>
    <footer><p v-if="error" role="alert">{{ error }}</p><button type="button" @click="dismiss">关闭</button></footer>
  </main>
</template>

<style>
*{box-sizing:border-box}html,body,#app{margin:0;height:100%;overflow:hidden}body{background:transparent;color:#F4F4F5;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif}.reminder-page{height:100%;display:flex;flex-direction:column;align-items:center;padding:clamp(16px,4vh,56px) clamp(16px,8vw,160px);gap:16px}.reminder-page header{text-align:center;flex:none}.reminder-page header p{margin:0;font-size:18px;color:#BCC1CA}.reminder-page time{font-size:clamp(32px,7vw,88px);font-variant-numeric:tabular-nums}.reminder-page h1{font-size:24px;font-weight:500;margin:0;flex:none}.reminder-items{width:100%;max-width:1000px;min-height:0;overflow:auto;flex:1;scrollbar-width:none;overscroll-behavior:contain}.reminder-items article{color:#24292C;border-radius:20px;margin:12px 0;padding:24px}.reminder-items article p{margin:0 0 12px;font-size:clamp(20px,3vw,36px);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}.reminder-items small{font-size:14px}.reminder-page footer{flex:none;text-align:center}.reminder-page footer button{font:inherit;font-size:18px;color:#24292C;background:#F1F3F5;border:0;border-radius:12px;min-height:48px;padding:12px 36px;cursor:pointer}.reminder-page footer p{color:#BCC1CA;font-size:13px;margin:12px 0 0}.reminder-page button:focus-visible,.reminder-items:focus-visible{outline:2px solid #BEDAE4;outline-offset:4px}
</style>
