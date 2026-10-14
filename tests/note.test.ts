import test from 'node:test';
import assert from 'node:assert/strict';
import { noteTitle } from '../src/shared/note.ts';

test('note titles use the literal first line, allow duplicate names and preserve Markdown characters', () => {
  assert.equal(noteTitle('  同名标题  \r\n正文'), '同名标题');
  assert.equal(noteTitle('# 一级标题\n正文'), '# 一级标题');
  assert.equal(noteTitle('\n第二行'), '无标题便签');
  assert.equal(noteTitle('   '), '无标题便签');
});
