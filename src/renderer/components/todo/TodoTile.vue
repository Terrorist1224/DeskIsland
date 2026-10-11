<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { TodoColor, TodoItem } from '../../../shared/contracts';
import { TODO_COLORS, formatTodoTime, parseTodoTime } from '../../../shared/todo';

const props = defineProps<{ items: TodoItem[]; preview?: boolean; editing?: boolean }>();
const emit = defineEmits<{ saved: [items: TodoItem[]] }>();
const root = ref<HTMLElement>();
const list = ref<HTMLElement>();
const input = ref<HTMLTextAreaElement>();
const creating = ref(false);
const text = ref('');
const color = ref<TodoColor>('blue');
const paletteOpen = ref(false);
const reminderOpen = ref(false);
const date = ref('');
const time = ref(['00', '00', '00']);
const confirming = ref('');
const busy = ref(false);
const error = ref('');
const ordered = ref<TodoItem[] | null>(null);
const displayed = computed(() => ordered.value ?? props.items);
const dragging = ref<TodoItem | null>(null);
const dragTop = ref(0);
const dragHeight = ref(0);
const settling = ref(false);
let gesture: { id: number; item: TodoItem; startY: number; y: number; offset: number } | undefined;
let frame = 0;
let suppressClick = false;

function background(id: TodoColor) { return TODO_COLORS.find(item => item.id === id)!.value; }
function cancelDrag() {
  cancelAnimationFrame(frame);
  if (gesture && root.value?.hasPointerCapture(gesture.id)) root.value.releasePointerCapture(gesture.id);
  gesture = undefined;dragging.value = null;ordered.value = null;settling.value = false;
  setTimeout(() => { suppressClick = false; }, 0);
}
function collapse() { cancelDrag();confirming.value = '';creating.value = false;paletteOpen.value = false; }
function outside(event: PointerEvent) {
  const target = event.target as HTMLElement;
  if (!root.value?.contains(target)) collapse();
  else if (!target.closest('.todo-confirm-actions') && !target.closest('[data-todo-id]')) confirming.value = '';
}

function startDrag(event: PointerEvent, item: TodoItem) {
  if (event.button !== 0 || !event.isPrimary || props.preview || props.editing || busy.value) return;
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  gesture = { id: event.pointerId, item, startY: event.clientY, y: event.clientY, offset: event.clientY - bounds.top };
  dragHeight.value = bounds.height;
}
function moveDrag(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.id) return;
  gesture.y = event.clientY;
  if (!dragging.value && Math.abs(event.clientY - gesture.startY) >= 6) {
    root.value?.setPointerCapture(event.pointerId);
    ordered.value = [...props.items];dragging.value = gesture.item;
    creating.value = false;suppressClick = true;
    frame = requestAnimationFrame(dragFrame);
  }
  if (dragging.value) event.preventDefault();
}
function dragFrame() {
  if (!gesture || !dragging.value || !list.value || !root.value || !ordered.value) return;
  const bounds = list.value.getBoundingClientRect();
  // Edge scrolling is frame-based so a held pointer can reach rows outside the viewport.
  const edge = 28;
  const speed = gesture.y < bounds.top + edge ? -Math.min(10, (bounds.top + edge - gesture.y) / 3)
    : gesture.y > bounds.bottom - edge ? Math.min(10, (gesture.y - bounds.bottom + edge) / 3) : 0;
  list.value.scrollTop += speed;
  dragTop.value = Math.max(bounds.top, Math.min(gesture.y - gesture.offset, Math.max(bounds.top, bounds.bottom - dragHeight.value))) - root.value.getBoundingClientRect().top;
  const y = gesture.y - bounds.top + list.value.scrollTop;
  const rows = [...list.value.querySelectorAll<HTMLElement>('[data-todo-id]')].filter(row => row.dataset.todoId !== gesture!.item.id);
  const index = rows.filter(row => y > row.offsetTop + row.offsetHeight / 2).length;
  const current = ordered.value.findIndex(item => item.id === gesture!.item.id);
  if (index !== current) {
    const items = ordered.value.filter(item => item.id !== gesture!.item.id);
    items.splice(index, 0, gesture.item);ordered.value = items;
  }
  frame = requestAnimationFrame(dragFrame);
}
async function endDrag(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.id) return;
  if (!dragging.value || !ordered.value) { gesture = undefined;return; }
  const itemId = gesture.item.id;
  const index = ordered.value.findIndex(item => item.id === itemId);
  const beforeId = ordered.value[index + 1]?.id ?? null;
  const changed = ordered.value.some((item, index) => item.id !== props.items[index]?.id);
  cancelAnimationFrame(frame);
  if (root.value?.hasPointerCapture(gesture.id)) root.value.releasePointerCapture(gesture.id);
  gesture = undefined;
  setTimeout(() => { suppressClick = false; }, 0);
  busy.value = true;error.value = '';
  settling.value = true;
  const row = [...(list.value?.querySelectorAll<HTMLElement>('[data-todo-id]') ?? [])].find(row => row.dataset.todoId === itemId);
  if (row && list.value && root.value) dragTop.value = row.offsetTop - list.value.scrollTop + list.value.getBoundingClientRect().top - root.value.getBoundingClientRect().top;
  try {
    const [items] = await Promise.all([
      changed ? window.deskIsland.moveTodo(itemId, beforeId) : Promise.resolve(props.items),
      new Promise(resolve => setTimeout(resolve, 180)),
    ]);
    if (changed) emit('saved', items);
    await nextTick();
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '排序保存失败，请重试'; }
  finally { ordered.value = null;dragging.value = null;settling.value = false;busy.value = false; }
}
async function create() {
  if (props.preview || busy.value) return;
  confirming.value = '';
  creating.value = true;
  await nextTick();input.value?.focus();
}
function toggleReminder() {
  reminderOpen.value = !reminderOpen.value;
  if (reminderOpen.value && !date.value) {
    const [day, clock] = formatTodoTime(Date.now()).split(' ');
    date.value = day!;time.value = clock!.split(':');
  }
}
async function submit() {
  if (busy.value || props.preview) return;
  error.value = '';
  const remindAt = reminderOpen.value ? parseTodoTime(`${date.value}T${time.value.join(':')}`) : null;
  if (!text.value.trim()) { error.value = '请输入待办内容';return; }
  if (reminderOpen.value && (remindAt === null || remindAt <= Date.now())) { error.value = '请选择有效的未来提醒时间';return; }
  busy.value = true;
  try {
    const items = await window.deskIsland.addTodo({ text: text.value, color: color.value, remindAt });
    emit('saved', items);
    text.value = '';color.value = 'blue';date.value = '';time.value = ['00', '00', '00'];reminderOpen.value = false;
    collapse();
    await nextTick();if (list.value) list.value.scrollTop = list.value.scrollHeight;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败，请重试'; }
  finally { busy.value = false; }
}
function enter(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();void submit();
}
async function confirm(id: string) {
  if (props.preview || busy.value || suppressClick) return;
  creating.value = false;confirming.value = id;error.value = '';
  await nextTick();
  const row = [...(list.value?.querySelectorAll<HTMLElement>('[data-todo-id]') ?? [])].find(row => row.dataset.todoId === id);
  if (!row || !list.value || confirming.value !== id) return;
  const bounds = row.getBoundingClientRect(), viewport = list.value.getBoundingClientRect();
  const delta = bounds.top < viewport.top ? bounds.top - viewport.top : bounds.bottom > viewport.bottom ? bounds.bottom - viewport.bottom : 0;
  if (delta) list.value.scrollBy({ top: delta, behavior: 'smooth' });
}
async function complete(id: string) {
  if (busy.value) return;
  busy.value = true;
  try { emit('saved', await window.deskIsland.completeTodo(id));confirming.value = '';error.value = ''; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败，请重试'; }
  finally { busy.value = false; }
}
function rowKey(event: KeyboardEvent, id: string) {
  if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault();confirm(id); }
}
function escape(event: KeyboardEvent) { if (event.key === 'Escape') collapse(); }
onMounted(() => {
  document.addEventListener('pointerdown', outside);
  window.addEventListener('blur', collapse);
  window.addEventListener('keydown', escape);
});
onBeforeUnmount(() => {
  cancelDrag();
  document.removeEventListener('pointerdown', outside);
  window.removeEventListener('blur', collapse);
  window.removeEventListener('keydown', escape);
});
watch(() => props.editing, editing => { if (editing) collapse(); });
watch(() => props.items, items => {
  if (gesture) cancelDrag();
  if (confirming.value && !items.some(item => item.id === confirming.value)) confirming.value = '';
});
</script>

<template>
  <section ref="root" class="todo-face" :inert="editing" aria-label="待办列表" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="cancelDrag" @lostpointercapture="gesture && cancelDrag()">
    <div ref="list" class="todo-list" tabindex="0" aria-label="待办事项，可滚动">
      <TransitionGroup name="todo-reorder" tag="div">
      <div v-for="item in displayed" :key="item.id" :data-todo-id="item.id" class="todo-row" :class="{ 'todo-row--dragging': dragging?.id === item.id }" :style="{ background: background(item.color) }" :role="confirming === item.id ? 'group' : 'button'" :tabindex="preview ? -1 : 0" @pointerdown="startDrag($event,item)" @click="confirm(item.id)" @keydown="rowKey($event, item.id)">
        <span v-if="confirming === item.id" class="todo-text todo-confirm">完成待办</span>
        <template v-else>
          <span class="todo-text">{{ item.text }}</span>
          <small v-if="item.remindAt !== null" class="todo-time">{{ formatTodoTime(item.remindAt) }}<span v-if="item.reminderState === 'notified'"> · 已提醒</span><span v-else-if="item.reminderState === 'missed'"> · 已过期</span></small>
        </template>
      </div>
      </TransitionGroup>
      <p v-if="!items.length" class="todo-empty">点击＋添加待办</p>
    </div>
    <div v-if="dragging" class="todo-row todo-drag-ghost" :class="{ 'todo-drag-ghost--settling': settling }" aria-hidden="true" :style="{ background: background(dragging.color), height: `${dragHeight}px`, transform: `translateY(${dragTop}px)` }">
      <span class="todo-text">{{ confirming === dragging.id ? '完成待办' : dragging.text }}</span>
      <small v-if="confirming !== dragging.id && dragging.remindAt !== null" class="todo-time">{{ formatTodoTime(dragging.remindAt) }}</small>
    </div>
    <footer class="todo-footer">
      <div v-if="confirming" class="todo-confirm-actions" role="group" aria-label="确认完成待办">
        <button type="button" :style="{ background: background('green') }" :disabled="busy" @click="complete(confirming)">是</button>
        <button type="button" :style="{ background: background('pink') }" :disabled="busy" @click="confirming = ''">否</button>
      </div>
      <span v-else class="todo-label">待办</span>
      <button type="button" class="todo-add" aria-label="添加待办" :disabled="preview || busy" @click="create"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
    </footer>
    <form v-if="creating" class="todo-composer" :style="{ background: background(color) }" @submit.prevent="submit">
      <textarea ref="input" v-model="text" rows="2" maxlength="2000" placeholder="请输入待办，回车创建" aria-label="待办内容" :disabled="busy" @keydown="enter"></textarea>
      <div class="todo-tools">
        <button type="button" aria-label="选择待办颜色" :aria-expanded="paletteOpen" :disabled="busy" @click="paletteOpen = !paletteOpen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="9" r="2" fill="#D9AFB5"/><circle cx="15" cy="8" r="2" fill="#94B2A2"/><circle cx="17" cy="14" r="2" fill="#89AAB7"/><circle cx="9" cy="16" r="2" fill="#C2B661"/></svg>
        </button>
        <button type="button" aria-label="设置或取消提醒" :aria-pressed="reminderOpen" :disabled="busy" @click="toggleReminder">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5l3 2M4 2 1 5M20 2l3 3M6 20l-2 3m14-3 2 3" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <button type="submit" class="todo-submit" :disabled="busy">创建</button>
      </div>
      <div v-if="paletteOpen" class="todo-palette" aria-label="预设低饱和颜色">
        <button v-for="choice in TODO_COLORS" :key="choice.id" type="button" :aria-label="choice.name" :aria-pressed="color === choice.id" :style="{ background: choice.value }" :disabled="busy" @click="color = choice.id; paletteOpen = false"></button>
      </div>
      <div v-if="reminderOpen" class="todo-reminder-fields">
        <label>日期<input v-model="date" type="date" required aria-label="提醒日期" :disabled="busy" /></label>
        <div class="todo-clock-fields"><label v-for="(unit,index) in ['时','分','秒']" :key="unit">{{ unit }}<select v-model="time[index]" :aria-label="`提醒${unit}`" :disabled="busy"><option v-for="value in index === 0 ? 24 : 60" :key="value" :value="String(value - 1).padStart(2, '0')">{{ String(value - 1).padStart(2, '0') }}</option></select></label></div>
        <small>按本机时间提醒，精确到秒</small>
      </div>
      <p v-if="error" class="todo-error" role="alert">{{ error }}</p>
    </form>
    <p v-else-if="error" class="todo-error todo-error--floating" role="alert">{{ error }}</p>
  </section>
</template>

<style>
.todo-clock-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.todo-clock-fields select{width:100%;min-width:0;font:inherit;color:inherit;background:#FFFFFFA0;border:1px solid #24292C35;border-radius:6px;padding:4px 0}.todo-clock-fields select:focus-visible{outline:2px solid #293F4A;outline-offset:-2px}
.todo-face{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:#BEDAE4;color:#24292C;overflow:hidden;border-radius:inherit;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;color-scheme:light}
.todo-face *{box-sizing:border-box}.todo-face button,.todo-face input,.todo-face textarea{font:inherit;color:inherit}.todo-face button{cursor:pointer}.todo-face button:focus-visible,.todo-face input:focus-visible,.todo-face textarea:focus-visible,.todo-row:focus-visible,.todo-list:focus-visible{outline:2px solid #293F4A;outline-offset:-3px}
.todo-list{position:relative;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}.todo-list::-webkit-scrollbar,.todo-composer::-webkit-scrollbar{display:none}.todo-row{min-height:64px;padding:16px;display:flex;flex-direction:column;justify-content:center;gap:6px;border-bottom:1px solid #24292C18;cursor:pointer;touch-action:pan-y;user-select:none}.todo-row--dragging{opacity:0}.todo-reorder-move{transition:transform 180ms ease}.todo-drag-ghost{position:absolute;top:0;left:0;right:0;z-index:2;pointer-events:none;box-shadow:0 4px 16px #0002;overflow:hidden}.todo-drag-ghost--settling{transition:transform 180ms ease}.todo-text{font-size:18px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}.todo-time{font-size:11px;line-height:1.5;overflow-wrap:anywhere;color:#3E4B50}.todo-empty{font-size:13px;text-align:center;margin:24px 12px;color:#465D67}
.todo-footer{flex:none;height:48px;display:flex;align-items:center;justify-content:space-between;padding:4px 12px 4px 16px}.todo-label{font-size:18px;line-height:1.45}.todo-add{border:0;background:#FFFFFFDD;border-radius:50%;width:38px;height:38px;display:grid;place-items:center;padding:0;flex:none}.todo-add svg{display:block;width:24px;height:24px}.todo-confirm-actions{display:flex;gap:8px;align-items:center;font-size:18px}.todo-confirm-actions button{border:1px solid #24292C25;border-radius:7px;min-width:32px;min-height:32px;padding:0 6px;line-height:1.45}
.todo-composer{position:absolute;inset:auto 6px 6px;max-height:calc(100% - 12px);overflow:auto;scrollbar-width:none;padding:10px;border:1px solid #24292C35;border-radius:14px;box-shadow:0 4px 18px #0002}.todo-composer textarea{display:block;width:100%;min-width:0;resize:none;border:0;border-radius:6px;background:#FFFFFF70;padding:8px;font-size:14px;line-height:1.5}.todo-tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center}.todo-tools button{border:1px solid #24292C25;border-radius:8px;background:#FFFFFF85;min-width:32px;min-height:32px;padding:5px}.todo-tools svg{display:block;width:20px;height:20px}.todo-tools [aria-pressed="true"]{background:#FFF;border-color:#293F4A}.todo-submit{margin-left:auto}.todo-palette{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.todo-palette button{width:28px;height:28px;border-radius:50%;border:1px solid #24292C40}.todo-palette [aria-pressed="true"]{outline:2px solid #293F4A;outline-offset:2px}.todo-reminder-fields{margin-top:10px;display:grid;gap:6px;font-size:12px}.todo-reminder-fields label{display:grid;gap:3px;min-width:0}.todo-reminder-fields input{display:block;min-width:0;max-width:100%;width:100%;border:1px solid #24292C35;border-radius:6px;background:#FFFFFFA0;padding:5px;font-size:12px}.todo-reminder-fields small{font-size:10px}.todo-error{font-size:12px;line-height:1.4;color:#8C2020;overflow-wrap:anywhere;margin:8px 0 0}.todo-error--floating{position:absolute;bottom:50px;left:8px;right:8px;background:#FFF1E8;padding:8px;border-radius:8px}
</style>
