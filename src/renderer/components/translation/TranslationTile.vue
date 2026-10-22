<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import catalog from '../../../shared/translation-catalog.json';
import { TranslationController } from './translation-controller';
const props = defineProps<{ preview?: boolean; editing?: boolean }>();
const controller = new TranslationController(window.deskIsland, value => { state.value = value; });
const state = ref(controller.state), ready = ref(Boolean(props.preview)), copied = ref(false), copyError = ref('');
let composing = false, copyTimer: ReturnType<typeof setTimeout> | undefined;
if (props.preview) state.value = { ...state.value, text: 'Hello, world!', result: '你好，世界！', status: 'done' };
function change() {
  if (props.preview || props.editing || !ready.value) return;
  copied.value = false; copyError.value = '';
  void controller.change({ text: state.value.text, provider: state.value.provider, target: state.value.target });
}
function submit() {
  if (props.preview || props.editing || !ready.value || composing) return;
  copied.value = false; copyError.value = '';
  void controller.submit({ text: state.value.text, provider: state.value.provider, target: state.value.target });
}
function keydown(event: KeyboardEvent) {
  // IME confirmation may report Enter or keyCode 229; neither submits the draft.
  if (event.key !== 'Enter' || event.isComposing || composing || event.keyCode === 229) return;
  event.preventDefault();
  if (event.repeat) return;
  if (event.ctrlKey) {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.setRangeText('\n', textarea.selectionStart, textarea.selectionEnd, 'end');
    input(event);
  } else submit();
}
function input(event: Event) { state.value.text = (event.target as HTMLTextAreaElement).value; change(); }
function composition(event: CompositionEvent, active: boolean) { composing = active; input(event); }
function select(event: Event) {
  state.value.target = (event.target as HTMLSelectElement).value as typeof state.value.target; change();
}
function clear() { state.value.text = ''; change(); }
async function copy() {
  try { await window.deskIsland.copyTranslation(); copied.value = true; clearTimeout(copyTimer); copyTimer = setTimeout(() => { copied.value = false; }, 1500); }
  catch { copyError.value = '复制失败，请重试'; }
}
watch(() => props.editing, editing => { if (!props.preview) { if (editing) controller.pause(); else void controller.load(); } });
onMounted(async () => { if (!props.preview) { await controller.load(); ready.value = true; } });
onBeforeUnmount(() => { clearTimeout(copyTimer); if (!props.preview) controller.dispose(); });
</script>

<template>
  <section class="translation-face" :aria-busy="state.status === 'loading'">
    <header><strong>翻译</strong><small v-if="preview">预览示例</small></header>
    <div class="translation-selects">
      <select aria-label="目标语言" title="自动：中文译成英文，其他语言译成简体中文" :value="state.target" :disabled="preview || editing || !ready" @change="select"><option value="auto">自动</option><option v-for="item in catalog.languages" :key="item.id" :value="item.id">{{ item.name }}</option></select>
    </div>
    <textarea :value="state.text" aria-label="待翻译原文" placeholder="Enter 翻译，Ctrl+Enter 换行" spellcheck="false" :disabled="preview || editing || !ready" @input="input" @keydown="keydown" @compositionstart="composition($event, true)" @compositionend="composition($event, false)"></textarea>
    <div class="translation-divider"><span>{{ state.status === 'loading' ? '翻译中…' : '译文' }}</span><div class="translation-actions"><button class="translation-clear" type="button" aria-label="清空原文和译文" :disabled="preview || editing || !ready || !state.text" @click="clear">清空</button><button type="button" :title="copied ? '已复制' : '复制译文'" :aria-label="copied ? '已复制' : '复制译文'" :disabled="preview || editing || state.status !== 'done'" @click="copy"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="copied" d="m5 12 4 4L19 6"/><template v-else><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/></template></svg></button></div></div>
    <div class="translation-output" tabindex="0" aria-label="翻译结果" aria-live="polite">{{ state.result || (state.status === 'loading' ? '正在翻译…' : '译文将在这里显示') }}</div>
    <footer><span :class="{ 'translation-error': state.text.length > catalog.maxText }">{{ state.text.length }} / {{ catalog.maxText }}</span><button type="button" :disabled="editing || preview || !ready || !state.text.trim() || state.text.length > catalog.maxText || state.status === 'loading'" @click="submit">{{ state.status === 'error' ? '重试' : '翻译' }}</button></footer>
    <p v-if="state.error || copyError" class="translation-error" role="alert">{{ state.error || copyError }}</p>
  </section>
</template>

<style scoped>
.translation-face{height:100%;min-height:0;padding:10px 12px;display:flex;flex-direction:column;gap:6px;color:#fafafa;font:13px/1.4 "Segoe UI","Microsoft YaHei UI",sans-serif}
header,.translation-divider,footer{display:flex;align-items:center;justify-content:space-between;gap:6px;flex:none}header{height:27px}header strong{font-size:16px;font-weight:500;color:#f4f4f5}header small,footer{font-size:11px;color:#e6e2e6}
button{display:grid;place-items:center;width:25px;height:24px;padding:3px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;cursor:pointer}button:hover{background:#ffffff18}.translation-actions{display:flex;align-items:center;gap:4px}.translation-clear{width:auto;padding:0 5px}button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}button:disabled{opacity:.4;cursor:default}
.translation-selects{display:flex;gap:6px;flex:none}.translation-selects select{min-width:0;width:45%;border:1px solid #ffffff26;border-radius:9px;background:#24242be6;color:inherit;padding:5px;font:inherit}.translation-selects select:last-child{flex:1}
textarea,.translation-output{flex:1 1 0;min-height:30px;width:100%;margin:0;border:0;border-radius:8px;background:#ffffff08;padding:7px;color:inherit;font:inherit;line-height:1.5;overflow:auto;overflow-wrap:anywhere;white-space:pre-wrap;user-select:text;scrollbar-width:thin;scrollbar-color:#ffffff40 transparent}textarea{resize:none}textarea::placeholder{color:#bbb8bf}textarea:disabled{opacity:.8}.translation-divider{height:19px;color:#e6e2e6;font-size:11px}.translation-output:focus-visible,textarea:focus-visible,select:focus-visible,button:focus-visible{outline:2px solid #eee9ef;outline-offset:1px}footer{min-height:17px}footer button{width:auto;height:20px;padding:0 6px}.translation-error{color:#ffc6aa}p.translation-error{margin:0;font-size:11px;max-height:48px;flex:none;overflow:auto;overflow-wrap:anywhere}
</style>
