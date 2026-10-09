import test from 'node:test';
import assert from 'node:assert/strict';
import { activeLyric } from '../src/shared/lyrics.ts';

test('lyrics follow timeline including pauses and backward seeks', () => {
  const lines = [{ timeSeconds: 1, text: '第一句' }, { timeSeconds: 4, text: '第二句' }];
  assert.equal(activeLyric(lines, .5), undefined);
  assert.equal(activeLyric(lines, 4)?.text, '第二句');
  assert.equal(activeLyric(lines, 4)?.text, '第二句');
  assert.equal(activeLyric(lines, 2)?.text, '第一句');
  assert.equal(activeLyric([], 5), undefined);
});
