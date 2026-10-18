const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { ref, computed } = require('vue');
const { transpile } = require('typescript');
const { noteTitle } = require('../src/shared/note.cjs');
const TODO_COLORS = require('../src/shared/todo-colors.json');

function editor(bridge) {
  const source = readFileSync(require.resolve('../src/renderer/components/note/NoteEditor.vue'), 'utf8');
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '');
  let mounted;
  const state = new Function('ref', 'computed', 'onMounted', 'onBeforeUnmount', 'nextTick', 'noteTitle', 'TODO_COLORS', 'window',
    transpile(script) + ';return {togglePin,alwaysOnTop,pinning,pinError,error,ready,busy,locked};')(
    ref, computed, callback => { mounted = callback; }, () => {}, async () => {}, noteTitle, TODO_COLORS, { noteEditor: bridge });
  return { ...state, mount: () => mounted() };
}

test('pin toggle initializes from window state, prevents repeat requests and preserves state on failure', async () => {
  let resolve, reject, calls = [];
  const state = editor({
    get: async () => ({ text: '测试', color: 'blue', alwaysOnTop: true }),
    onSaveRequest() {}, onLock() {}, onError() {}, onSaved() {},
    setAlwaysOnTop: value => { calls.push(value);return new Promise((yes, no) => { resolve = yes;reject = no; }); },
  });
  await state.togglePin();assert.equal(calls.length, 0);
  await state.mount();assert.equal(state.alwaysOnTop.value, true);
  for (const flag of [state.busy, state.locked]) {
    flag.value = true;await state.togglePin();flag.value = false;
  }
  assert.equal(calls.length, 0);
  const first = state.togglePin();assert.equal(state.pinning.value, true);
  await state.togglePin();assert.deepEqual(calls, [false]);
  resolve(false);await first;
  assert.equal(state.alwaysOnTop.value, false);assert.equal(state.pinning.value, false);
  const failed = state.togglePin();reject(new Error('测试置顶失败'));await failed;
  assert.equal(state.alwaysOnTop.value, false);assert.equal(state.pinning.value, false);
  assert.match(state.pinError.value, /置顶切换失败/);assert.equal(state.error.value, '');
  const retried = state.togglePin();resolve(true);await retried;
  assert.equal(state.alwaysOnTop.value, true);assert.equal(state.pinError.value, '');
});

test('note Ctrl-wheel changes only body size within bounds; ordinary wheel remains scrollable', () => {
  const source = readFileSync(require.resolve('../src/renderer/components/note/NoteEditor.vue'), 'utf8');
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '');
  const { zoom, fontSize } = new Function('ref', 'computed', 'onMounted', 'onBeforeUnmount', 'noteTitle', 'TODO_COLORS',
    transpile(script) + ';return {zoom,fontSize};')(ref, computed, () => {}, () => {}, noteTitle, TODO_COLORS);
  let prevented = 0;
  const wheel = (ctrlKey, deltaY) => zoom({ ctrlKey, deltaY, preventDefault: () => prevented++ });
  wheel(false, -100);assert.equal(fontSize.value, 16);assert.equal(prevented, 0);
  wheel(true, -100);assert.equal(fontSize.value, 18);wheel(true, 100);assert.equal(fontSize.value, 16);
  for (let i = 0; i < 30; i++) wheel(true, -1);
  assert.equal(fontSize.value, 32);
  for (let i = 0; i < 30; i++) wheel(true, 1);
  assert.equal(fontSize.value, 12);wheel(true, 0);assert.equal(fontSize.value, 12);assert.equal(prevented, 63);
});
