<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { TodoColor } from '../../../shared/contracts';
import { TODO_COLORS } from '../../../shared/todo';
import { noteTitle } from '../../../shared/note';
import PaletteIcon from '../PaletteIcon.vue';

const text = ref(''), color = ref<TodoColor>('blue'), ready = ref(false), busy = ref(false), confirming = ref(false), palette = ref(false), error = ref('');
const input = ref<HTMLTextAreaElement>();
const locked = ref(false);
const fontSize = ref(16);
function zoom(event: WheelEvent) {
  if (!event.ctrlKey) return;
  event.preventDefault();
  if (event.deltaY) fontSize.value = Math.max(12, Math.min(32, fontSize.value + (event.deltaY < 0 ? 2 : -2)));
}
const title = computed(() => noteTitle(text.value));
const background = computed(() => TODO_COLORS.find(choice => choice.id === color.value)!.value);
const snapshot = () => ({ text: input.value?.value ?? text.value, color: color.value });
const removers: (() => void)[] = [];
function failed(cause: unknown) { error.value = cause instanceof Error ? cause.message.replace(/^Error invoking remote method 'note:\w+': (?:Error: )?/, '') : '保存失败，请重试'; }
function update() {
  if (!ready.value) return;
  text.value = input.value?.value ?? text.value;
  void window.noteEditor.update(snapshot()).catch(failed);
}
function choose(value: TodoColor) { color.value = value;palette.value = false;update(); }
async function action(kind: 'close' | 'delete' | 'save', token?: number) {
  if (!ready.value || ((busy.value || locked.value) && token === undefined)) return;
  busy.value = true;
  try {
    if (kind === 'delete') await window.noteEditor.delete();
    else if (kind === 'close') await window.noteEditor.close(snapshot());
    else await window.noteEditor.save(snapshot(), token);
    error.value = '';
  } catch (cause) { failed(cause); }
  finally { busy.value = false; }
}
onMounted(async () => {
  removers.push(window.noteEditor.onSaveRequest(token => { void action('save', token); }));
  removers.push(window.noteEditor.onLock(value => { locked.value = value; }));
  removers.push(window.noteEditor.onError(message => { error.value = message; }));
  removers.push(window.noteEditor.onSaved(() => { error.value = ''; }));
  try {
    const note = await window.noteEditor.get();text.value = note.text;color.value = note.color;ready.value = true;
    await nextTick();input.value?.focus();
  } catch (cause) { failed(cause); }
});
onBeforeUnmount(() => removers.forEach(remove => remove()));
</script>

<template>
  <main class="note-editor" :style="{ background }" @wheel="zoom">
    <header class="note-titlebar">
      <span :title="title">{{ title }}</span>
      <button type="button" aria-label="选择便签颜色" :aria-expanded="palette" :disabled="!ready || busy || locked" @click="palette = !palette"><PaletteIcon /></button>
      <button type="button" aria-label="保存并关闭便签" :disabled="!ready || busy || locked" @click="action('close')">×</button>
    </header>
    <div v-if="palette" class="note-palette" aria-label="便签颜色">
      <button v-for="choice in TODO_COLORS" :key="choice.id" type="button" :aria-label="choice.name" :aria-pressed="color === choice.id" :style="{ background: choice.value }" :disabled="busy || locked" @click="choose(choice.id)"></button>
    </div>
    <textarea ref="input" v-model="text" :style="{ fontSize: `${fontSize}px` }" aria-label="便签正文，首行为标题" placeholder="首行作为标题，从这里开始记录…" :disabled="!ready || busy || locked" maxlength="1000000" spellcheck="false" @input="update"></textarea>
    <footer>
      <div v-if="confirming" class="note-delete-confirm" role="group" aria-label="确认删除便签">
        <span>删除这张便签？</span>
        <button type="button" :disabled="busy || locked" @click="action('delete')">是</button>
        <button type="button" :disabled="busy || locked" @click="confirming = false">否</button>
      </div>
      <button v-else type="button" :disabled="!ready || busy || locked" @click="confirming = true; palette = false">删除</button>
      <span v-if="error" class="note-save-error" role="alert">{{ error }} <button type="button" :disabled="busy || locked" @click="action('save')">重试保存</button></span>
    </footer>
  </main>
</template>

<style>
.note-editor{display:flex;flex-direction:column;height:100%;color:#24292C;color-scheme:light;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;position:relative}.note-editor *{box-sizing:border-box}.note-editor button{font:inherit;color:inherit;cursor:pointer;border:1px solid #24292C25;border-radius:8px;background:#FFFFFF85;padding:6px 12px}.note-editor button:focus-visible{outline:2px solid #293F4A;outline-offset:-2px}.note-titlebar{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid #24292C18;app-region:drag}.note-titlebar span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;font-weight:600}.note-titlebar button{app-region:no-drag;min-width:36px}.note-titlebar svg{display:block;width:20px;height:20px}.note-titlebar button:last-child{font-size:24px;line-height:1;padding:5px 9px}.note-editor textarea{scrollbar-width:none;outline:none;flex:1;min-height:0;resize:none;display:block;width:100%;border:0;background:transparent;color:inherit;padding:18px;font:16px/1.65 "Segoe UI","Microsoft YaHei UI",sans-serif;overflow-wrap:anywhere}.note-editor textarea::-webkit-scrollbar{display:none}.note-editor footer{display:flex;gap:12px;align-items:center;flex-wrap:wrap;min-height:52px;padding:8px 12px;border-top:1px solid #24292C18;font-size:13px}.note-delete-confirm{display:flex;gap:8px;align-items:center}.note-delete-confirm button:first-of-type{background:#BEDCCD}.note-delete-confirm button:last-child{background:#EACCD0}.note-save-error{color:#8C2020;overflow-wrap:anywhere;flex:1}.note-palette{position:absolute;z-index:2;right:56px;top:55px;display:flex;gap:8px;background:#FFFFFFDD;border:1px solid #24292C25;border-radius:12px;padding:12px;box-shadow:0 4px 16px #0002}.note-palette button{width:28px;height:28px;border-radius:50%;padding:0;border:1px solid #24292C40}.note-palette [aria-pressed="true"]{outline:2px solid #293F4A;outline-offset:2px}
</style>
