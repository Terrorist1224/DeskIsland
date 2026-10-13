import test from 'node:test';
import assert from 'node:assert/strict';
import { nameParts, searchText, resultLayout } from '../src/shared/desktop-search.ts';

test('desktop names match literal English and Chinese fragments and highlight every occurrence', () => {
  assert.deepEqual(nameParts('我的QQ资料qq', ' QQ '), [
    { text: '我的', matched: false }, { text: 'QQ', matched: true },
    { text: '资料', matched: false }, { text: 'qq', matched: true },
  ]);
  assert.deepEqual(nameParts('我的资料', '资料'), [{ text: '我的', matched: false }, { text: '资料', matched: true }]);
  for (const query of ['[', '.', '*', '<', '\\', '😀']) {
    const name = `测试${query}文件${query}`;
    const parts = nameParts(name, query);
    assert.equal(parts.map(part => part.text).join(''), name);
    assert.equal(parts.filter(part => part.matched).length, 2);
  }
  assert.deepEqual(nameParts('QQ', '  '), [{ text: 'QQ', matched: false }]);
  assert.deepEqual(nameParts('QQ', '资料'), [{ text: 'QQ', matched: false }]);
  assert.equal(searchText('资料QQ.exe'), '资料qq.exe');
  assert.deepEqual(nameParts('İQQ', 'qq'), [{ text: 'İ', matched: false }, { text: 'QQ', matched: true }]);
});

test('result layout follows available columns and desktop icon size, capped at three visible rows', () => {
  assert.deepEqual(resultLayout(320,0,48),{iconSize:48,columns:3,rowHeight:116,panelHeight:0});
  for (const count of [1,2,3]) assert.equal(resultLayout(320,count,48).panelHeight,142);
  for (const count of [4,5,6]) assert.equal(resultLayout(320,count,48).panelHeight,266);
  for (const count of [7,9,10,100]) assert.equal(resultLayout(320,count,48).panelHeight,390);
  assert.equal(resultLayout(240,3,48).columns,2);assert.equal(resultLayout(240,3,48).panelHeight,266);
  assert.equal(resultLayout(320,4,96).iconSize,96);assert.equal(resultLayout(320,4,96).columns,2);
  assert.ok(resultLayout(240,1,256).iconSize<240);
});
