<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { TodoColor, TodoItem } from '../../../shared/contracts';
import { TODO_COLORS, formatTodoTime, parseTodoTime } from '../../../shared/todo';
import TodoReminderFields from './TodoReminderFields.vue';
import PaletteIcon from '../PaletteIcon.vue';
import { useListDrag } from '../useListDrag';

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
const { displayed, dragging, dragTop, dragHeight, settling, suppressClick, cancelDrag, startDrag, moveDrag, endDrag, lostCapture } = useListDrag(root, list, {
  items: () => props.items, blocked: () => !!props.preview || !!props.editing, busy, error,
  save: (id, beforeId) => window.deskIsland.moveTodo(id, beforeId), saved: items => emit('saved', items), onStart: () => { creating.value = false; },
});

function background(id: TodoColor) { return TODO_COLORS.find(item => item.id === id)!.value; }
function collapse() { cancelDrag();confirming.value = '';creating.value = false;paletteOpen.value = false; }
function outside(event: PointerEvent) {
  const target = event.target as HTMLElement;
  if (!root.value?.contains(target)) collapse();
  else if (!target.closest('.todo-confirm-actions') && !target.closest('[data-todo-id]')) confirming.value = '';
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
  if (props.preview || busy.value || suppressClick.value) return;
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
  if (confirming.value && !items.some(item => item.id === confirming.value)) confirming.value = '';
});
</script>

<template>
  <section ref="root" class="todo-face" :inert="editing" aria-label="待办列表" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="cancelDrag" @lostpointercapture="lostCapture">
    <div ref="list" class="todo-list" tabindex="0" aria-label="待办事项，可滚动">
      <TransitionGroup name="todo-reorder" tag="div">
      <div v-for="item in displayed" :key="item.id" :data-todo-id="item.id" :data-list-id="item.id" class="todo-row" :class="{ 'todo-row--dragging': dragging?.id === item.id }" :style="{ background: background(item.color) }" :role="confirming === item.id ? 'group' : 'button'" :tabindex="preview ? -1 : 0" @pointerdown="startDrag($event,item)" @click="confirm(item.id)" @keydown="rowKey($event, item.id)">
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
    <form v-if="creating" class="todo-composer" :style="{ background: background(color), '--todo-yellow': background('yellow') }" @submit.prevent="submit">
      <textarea ref="input" v-model="text" rows="2" maxlength="2000" placeholder="请输入待办，回车创建" aria-label="待办内容" :disabled="busy" @keydown="enter"></textarea>
      <div class="todo-tools">
        <button type="button" aria-label="选择待办颜色" :aria-expanded="paletteOpen" :disabled="busy" @click="paletteOpen = !paletteOpen">
          <PaletteIcon />
        </button>
        <button type="button" aria-label="设置或取消提醒" :aria-pressed="reminderOpen" :disabled="busy" @click="toggleReminder">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5l3 2M4 2 1 5M20 2l3 3M6 20l-2 3m14-3 2 3" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <button type="submit" class="todo-submit" :disabled="busy">创建</button>
      </div>
      <div v-if="paletteOpen" class="todo-palette" aria-label="预设低饱和颜色">
        <button v-for="choice in TODO_COLORS" :key="choice.id" type="button" :aria-label="choice.name" :aria-pressed="color === choice.id" :style="{ background: choice.value }" :disabled="busy" @click="color = choice.id; paletteOpen = false"></button>
      </div>
      <TodoReminderFields v-if="reminderOpen" v-model:date="date" v-model:time="time" :disabled="busy" />
      <p v-if="error" class="todo-error" role="alert">{{ error }}</p>
    </form>
    <p v-else-if="error" class="todo-error todo-error--floating" role="alert">{{ error }}</p>
  </section>
</template>

<style src="../list.css"></style>
