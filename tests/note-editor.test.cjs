const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { ref, computed } = require('vue');
const { transpile } = require('typescript');
const { noteTitle } = require('../src/shared/note.cjs');
const TODO_COLORS = require('../src/shared/todo-colors.json');

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
