const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { ref, computed, nextTick, watch } = require('vue');
const { transpile } = require('typescript');
const { searchText, resultLayout } = require('../src/shared/desktop-search.ts');

function tile(bridge, preview = false) {
  const source = readFileSync(require.resolve('../src/renderer/components/desktop-search/SearchTile.vue'), 'utf8');
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '');
  const mounted = [], cleanup = [];
  const heights = [];
  const view = new Function('defineProps','withDefaults','ref','computed','nextTick','watch','onMounted','onBeforeUnmount','searchText','resultLayout','window',
    transpile(script) + ';return {query,expanded,items,matches,icons,loading,error,opening,layout,status,desiredHeight,expand,load,open,collapse};')(
    () => ({ preview }), (props, defaults) => ({ ...defaults, ...props }), ref, computed, nextTick, watch,
    fn => mounted.push(fn), fn => cleanup.push(fn), searchText, resultLayout, { deskIsland: { resizeDesktopSearch: async height => { heights.push(height); }, ...bridge } });
  mounted.forEach(fn => fn());
  return { ...view, heights, unmount: () => cleanup.forEach(fn => fn()) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const entries = [{id:'qq',name:'我的QQ资料',kind:'folder',path:'测试桌面/我的QQ资料'},{id:'text',name:'测试[文档].txt',kind:'file',path:'测试桌面/测试[文档].txt'}];

test('click only focuses search, typing shows results, empty queries hide them and collapse clears the session', async () => {
  let collapsed, removed = false, launches = 0;
  const view = tile({
    onDesktopSearchCollapsed: fn => { collapsed = fn;return () => { removed = true; }; },
    openDesktopSearch: async () => { launches++; }, listDesktopSearchItems: async () => ({items:entries,warnings:[],iconSize:48}),
    getDesktopSearchIcon: async () => 'data:image/png;base64,test',
  });
  await view.expand();await settle();
  assert.equal(launches,1);assert.equal(view.expanded.value,true);assert.equal(view.matches.value.length,0);
  assert.equal(view.desiredHeight.value,64);assert.equal(view.status.value,'');assert.deepEqual(view.icons.value,{});
  await view.expand();assert.equal(launches,1);
  view.query.value=' qq ';await nextTick();assert.deepEqual(view.matches.value.map(item=>item.id),['qq']);
  assert.equal(view.layout.value.iconSize,48);assert.equal(view.heights.at(-1),214);
  view.query.value='[';assert.deepEqual(view.matches.value.map(item=>item.id),['text']);
  view.query.value='不存在';await nextTick();assert.equal(view.status.value,'该内容不存在');assert.equal(view.heights.at(-1),104);
  view.query.value=' ';await nextTick();assert.equal(view.status.value,'');assert.equal(view.heights.at(-1),64);
  collapsed();assert.equal(view.expanded.value,false);assert.equal(view.query.value,'');assert.deepEqual(view.items.value,[]);
  view.unmount();assert.equal(removed,true);
});

test('late desktop and icon replies cannot repopulate a collapsed or newer search', async () => {
  let finishList, finishIcon;
  const view = tile({ onDesktopSearchCollapsed: () => () => {}, openDesktopSearch: async () => {},
    listDesktopSearchItems: () => new Promise(resolve => {finishList=resolve;}), getDesktopSearchIcon: () => new Promise(resolve => {finishIcon=resolve;}) });
  await view.expand();await settle();view.collapse();finishList({items:entries,warnings:[],iconSize:48});await settle();assert.deepEqual(view.items.value,[]);
  await view.expand();await settle();view.query.value='qq';finishList({items:entries,warnings:[],iconSize:48});await settle();
  assert.ok(finishIcon);view.collapse();finishIcon('old icon');await settle();assert.deepEqual(view.icons.value,{});
  view.unmount();
});

test('preview has no desktop access and failed opens preserve expanded results without duplicate launches', async () => {
  const preview = tile({},true);await preview.expand();assert.equal(preview.expanded.value,false);preview.unmount();
  let rejectOpen, count=0;
  const view = tile({onDesktopSearchCollapsed:()=>()=>{},openDesktopSearch:async()=>{},listDesktopSearchItems:async()=>({items:entries,warnings:[],iconSize:48}),getDesktopSearchIcon:async()=>null,
    openDesktopSearchItem:()=>{count++;return new Promise((_resolve,reject)=>{rejectOpen=reject;});}});
  await view.expand();await settle();const pending=view.open(entries[0]);await view.open(entries[0]);assert.equal(count,1);
  rejectOpen(new Error('测试打开失败'));await pending;assert.equal(view.expanded.value,true);assert.match(view.error.value,/测试打开失败/);assert.equal(view.opening.value,false);
  view.unmount();
});

test('results grow to one, two and three rows; further rows scroll within the same panel height', async () => {
  const many = Array.from({length:10},(_,i)=>({id:String(i),name:`QQ ${i}`,kind:'file',path:`测试桌面/QQ ${i}`}));
  const view=tile({onDesktopSearchCollapsed:()=>()=>{},openDesktopSearch:async()=>{},listDesktopSearchItems:async()=>({items:many,warnings:[],iconSize:48}),getDesktopSearchIcon:async()=>null});
  await view.expand();await settle();view.query.value='QQ';await nextTick();
  assert.equal(view.layout.value.columns,3);assert.equal(view.desiredHeight.value,462);
  view.items.value=many.slice(0,3);await nextTick();assert.equal(view.desiredHeight.value,214);
  view.items.value=many.slice(0,4);await nextTick();assert.equal(view.desiredHeight.value,338);
  view.items.value=many.slice(0,7);await nextTick();assert.equal(view.desiredHeight.value,462);
  view.unmount();
});
