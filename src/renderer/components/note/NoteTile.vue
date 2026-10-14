<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { NoteItem, TodoColor } from '../../../shared/contracts';
import { TODO_COLORS } from '../../../shared/todo';
import { noteTitle } from '../../../shared/note';
import { useListDrag } from '../useListDrag';

const props = defineProps<{ items: NoteItem[]; preview?: boolean; editing?: boolean }>();
const emit = defineEmits<{ saved: [items: NoteItem[]] }>();
const root = ref<HTMLElement>(), list = ref<HTMLElement>(), busy = ref(false), error = ref('');
const { displayed, dragging, dragTop, dragHeight, settling, suppressClick, cancelDrag, startDrag, moveDrag, endDrag, lostCapture } = useListDrag(root, list, {
  items: () => props.items, blocked: () => !!props.preview || !!props.editing, busy, error,
  save: (id, beforeId) => window.deskIsland.moveNote(id, beforeId), saved: items => emit('saved', items),
});
function background(color: TodoColor) { return TODO_COLORS.find(choice => choice.id === color)!.value; }
async function open(id?: string) {
  if (props.preview || props.editing || busy.value || suppressClick.value) return;
  busy.value = true;error.value = '';
  try { await window.deskIsland.openNote(id); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '打开便签失败，请重试'; }
  finally { busy.value = false; }
}
function rowKey(event: KeyboardEvent, id: string) {
  if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault();void open(id); }
}
onMounted(() => window.addEventListener('blur', cancelDrag));
onBeforeUnmount(() => window.removeEventListener('blur', cancelDrag));
watch(() => props.editing, editing => { if (editing) cancelDrag(); });
</script>

<template>
  <section ref="root" class="todo-face note-face" :inert="editing" aria-label="便签列表" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="cancelDrag" @lostpointercapture="lostCapture">
    <div ref="list" class="todo-list" tabindex="0" aria-label="便签列表，可滚动">
      <TransitionGroup name="todo-reorder" tag="div">
        <div v-for="item in displayed" :key="item.id" :data-note-id="item.id" :data-list-id="item.id" class="todo-row" :class="{ 'todo-row--dragging': dragging?.id === item.id }" :style="{ background: background(item.color) }" role="button" :tabindex="preview ? -1 : 0" :title="noteTitle(item.text)" @pointerdown="startDrag($event, item)" @click="open(item.id)" @keydown="rowKey($event, item.id)">
          <span class="todo-text">{{ noteTitle(item.text) }}</span>
        </div>
      </TransitionGroup>
      <p v-if="!items.length" class="todo-empty">点击＋添加便签</p>
    </div>
    <div v-if="dragging" class="todo-row todo-drag-ghost" :class="{ 'todo-drag-ghost--settling': settling }" aria-hidden="true" :style="{ background: background(dragging.color), height: `${dragHeight}px`, transform: `translateY(${dragTop}px)` }"><span class="todo-text">{{ noteTitle(dragging.text) }}</span></div>
    <footer class="todo-footer">
      <span class="todo-label">便签</span>
      <button type="button" class="todo-add" aria-label="添加便签" :disabled="preview || busy" @click="open()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" stroke-width="2" /></svg></button>
    </footer>
    <p v-if="error" class="todo-error todo-error--floating" role="alert">{{ error }}</p>
  </section>
</template>

<style src="../list.css"></style>
