const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { WidgetStore } = require('../src/main/widget-store.cjs');

test('previous audio square bounds load as compact bounds without changing identity, settings or the source file',t=>{
  const directory=path.join(__dirname,'../.tmp/tests',`audio-size-${randomUUID()}`);fs.mkdirSync(directory,{recursive:true});
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new WidgetStore(directory),widget=store.create('audio');assert.equal(widget.width,240);assert.equal(widget.height,192);
  const file=path.join(directory,'deskisland.json'),saved=JSON.parse(fs.readFileSync(file,'utf8'));
  saved.widgets[0].height=240;const original=JSON.stringify(saved);fs.writeFileSync(file,original);
  const migrated=new WidgetStore(directory).list()[0];assert.deepEqual(migrated,{...widget,height:192});assert.equal(fs.readFileSync(file,'utf8'),original);
  saved.widgets[0].height=160;fs.writeFileSync(file,JSON.stringify(saved));
  assert.deepEqual(new WidgetStore(directory).list()[0],widget);
  saved.widgets[0].width=480;saved.widgets[0].height=480;fs.writeFileSync(file,JSON.stringify(saved));
  assert.equal(new WidgetStore(directory).list()[0].height,384);
  saved.widgets[0].width=241;saved.widgets[0].height=241;fs.writeFileSync(file,JSON.stringify(saved));
  assert.throws(()=>new WidgetStore(directory),/Invalid persisted widget size/);
});

test('multiple weather rows keep independent locations and switches under a persisted master switch', (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `weather-multiple-${randomUUID()}`);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new WidgetStore(directory);
  const first = store.create('weather', undefined, 'standard', false);
  const second = store.create('weather', undefined, 'standard', false);
  assert.notEqual(first.id, second.id);
  assert.equal(store.isVisible(first), false);
  assert.throws(() => store.create('weather', undefined, 'standard', 'true'), TypeError);
  store.updateSettings(first.id, { location: { name: '测试地区一' } });
  store.updateSettings(second.id, { location: { name: '测试地区二' } });
  store.setEnabled(first.id, true);
  const rows = store.list();
  assert.equal(store.isVisible(rows[0]), true);
  store.setWeatherEnabled(false);
  const restarted = new WidgetStore(directory);
  assert.equal(restarted.getWeatherEnabled(), false);
  assert.deepEqual(restarted.list(), rows);
  assert.ok(restarted.list().every(widget => !restarted.isVisible(widget)));
  restarted.setWeatherEnabled(true);
  assert.equal(restarted.isVisible(restarted.list()[0]), true);
  assert.equal(restarted.isVisible(restarted.list()[1]), false);
  restarted.remove(first.id);
  assert.deepEqual(restarted.list(), [rows[1]]);
  const original = fs.readFileSync(restarted.filePath, 'utf8');
  fs.mkdirSync(`${restarted.filePath}.tmp`);
  assert.throws(() => restarted.setWeatherEnabled(false));
  assert.equal(restarted.getWeatherEnabled(), true);
  assert.equal(fs.readFileSync(restarted.filePath, 'utf8'), original);
  assert.throws(() => restarted.setWeatherEnabled('false'), TypeError);
});

test('switching tiles off preserves configuration across restarts and rejects invalid states', (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `enabled-${randomUUID()}`);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new WidgetStore(directory);
  const widget = store.create('weather');
  store.updateSettings(widget.id, { location: { name: '测试地点' } });
  const configured = store.list()[0];
  assert.equal(configured.enabled, true);
  store.setEnabled(widget.id, false);
  const restarted = new WidgetStore(directory);
  assert.deepEqual(restarted.list()[0], { ...configured, enabled: false });
  assert.throws(() => restarted.setEnabled(widget.id, 'false'), TypeError);
  assert.throws(() => restarted.setEnabled('missing', true), /找不到/);
  assert.deepEqual(restarted.setEnabled(widget.id, true), configured);
  const legacy = { ...configured };
  delete legacy.enabled;
  fs.writeFileSync(store.filePath, JSON.stringify({ schemaVersion: 2, widgets: [legacy] }));
  assert.equal(new WidgetStore(directory).list()[0].enabled, true);
  legacy.enabled = 'false';
  const invalid = JSON.stringify({ schemaVersion: 2, widgets: [legacy] });
  fs.writeFileSync(store.filePath, invalid);
  assert.throws(() => new WidgetStore(directory), /enabled state/);
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), invalid);
});

test('widget instances persist across store restarts and unsupported types are rejected', (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `store-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const firstStore = new WidgetStore(directory);
  const created = firstStore.create('weather');
  assert.equal(created.typeId, 'weather');
  assert.equal(created.settings.location, null);
  assert.throws(() => firstStore.create('unknown'), TypeError);

  const secondStore = new WidgetStore(directory);
  assert.deepEqual(secondStore.list(), [created]);
  assert.equal(secondStore.remove(created.id), true);
  assert.deepEqual(new WidgetStore(directory).list(), []);
});

test('new tiles avoid overlapping and their positions and settings persist', (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `layout-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const store = new WidgetStore(directory);
  const music = store.create('music', { x: -1280, y: 40, width: 1280 });
  const weather = store.create('weather', { x: -1280, y: 40, width: 1280 });
  assert.equal(music.x + music.width <= weather.x || weather.x + weather.width <= music.x ||
    music.y + music.height <= weather.y || weather.y + weather.height <= music.y, true);
  assert.equal(store.updatePosition(weather.id, { x: -900, y: 72, monitorId: '2' }), true);
  assert.equal(store.updateSettings(weather.id, { location: {
    name: '上海', region: '上海市', country: '中国', latitude: 31.23, longitude: 121.47, timezone: 'Asia/Shanghai',
  } }), true);

  const restored = new WidgetStore(directory).list();
  assert.equal(restored[1].x, -900);
  assert.equal(restored[1].monitorId, '2');
  assert.equal(restored[1].settings.location.name, '上海');
});

test('invalid persisted data fails without replacing the original file', (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `store-invalid-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'deskisland.json');
  const original = '{not-json';
  fs.writeFileSync(filePath, original, 'utf8');

  assert.throws(() => new WidgetStore(directory), SyntaxError);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
});

test('music stays a singleton; variant switching preserves identity, position and settings', (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `variants-${randomUUID()}`);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new WidgetStore(directory);
  const music = store.create('music');
  assert.equal(music.variantId, 'square');
  assert.equal(music.width, music.height);
  assert.throws(() => store.create('music'), /音乐/);
  assert.throws(() => store.setVariant(music.id, 'standard'), TypeError);
  const wide = store.setVariant(music.id, 'wide');
  assert.equal(wide.id, music.id);
  assert.equal(wide.x, music.x);
  assert.equal(wide.y, music.y);
  assert.deepEqual(wide.settings, music.settings);
  assert.equal(wide.width, 416);
  assert.equal(wide.height, 208);
  assert.equal(new WidgetStore(directory).list()[0].variantId, 'wide');
  store.create('weather');
  assert.equal(store.list().length, 2);
});

test('legacy tiles keep their data and migrate to the matching variant without rewriting on read', (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `legacy-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const widget = { id: 'old', typeId: 'music', x: 70, y: 90, width: 352, height: 184, monitorId: '2', groupId: null, settings: {} };
  const original = JSON.stringify({ schemaVersion: 1, widgets: [widget] });
  const filePath = path.join(directory, 'deskisland.json');
  fs.writeFileSync(filePath, original);
  const migrated = new WidgetStore(directory).list()[0];
  assert.equal(migrated.variantId, 'wide');
  assert.equal(migrated.id, widget.id);
  assert.equal(migrated.x, widget.x);
  assert.equal(migrated.y, widget.y);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
});

test('failed persistence leaves singleton creation and variant changes retryable', (t) => {
  const directory = path.join(__dirname, '../.tmp/tests', `write-failure-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new WidgetStore(directory);
  const temporary = `${store.filePath}.tmp`;
  fs.mkdirSync(temporary);
  assert.throws(() => store.create('music'));
  assert.deepEqual(store.list(), []);
  fs.rmdirSync(temporary);
  const music = store.create('music');
  const original = fs.readFileSync(store.filePath, 'utf8');
  fs.mkdirSync(temporary);
  assert.throws(() => store.setVariant(music.id, 'wide'));
  assert.equal(store.list()[0].variantId, 'square');
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), original);
});

test('scaled bounds survive restart and variant changes preserve the nearest legal scale', (t) => {
  const directory=path.join(__dirname,'../.tmp/tests',`scaled-${randomUUID()}`);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new WidgetStore(directory);
  const widget=store.create('music');
  const bounds={x:-960,y:64,width:320,height:320,monitorId:'2'};
  store.updateBounds(widget.id,bounds);
  assert.deepEqual(new WidgetStore(directory).list()[0],{...widget,...bounds});
  const wide=store.setVariant(widget.id,'wide');
  assert.equal(wide.width,544);assert.equal(wide.height,272);
  assert.equal(wide.id,widget.id);
  const original=fs.readFileSync(store.filePath,'utf8');
  fs.mkdirSync(`${store.filePath}.tmp`);
  assert.throws(()=>store.updateBounds(widget.id,{...bounds,width:576,height:288}));
  assert.deepEqual(store.list()[0],wide);
  assert.equal(fs.readFileSync(store.filePath,'utf8'),original);
  assert.throws(()=>store.updateBounds(widget.id,{...bounds,width:545,height:272}),/Invalid/);
});

test('failed weather configuration persistence restores the previous settings',t=>{
  const directory=path.join(__dirname,'../.tmp/tests',`settings-failure-${randomUUID()}`);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new WidgetStore(directory);const widget=store.create('weather');
  const original=fs.readFileSync(store.filePath,'utf8');
  fs.mkdirSync(`${store.filePath}.tmp`);
  assert.throws(()=>store.updateSettings(widget.id,{location:{name:'测试地点',latitude:0,longitude:0}}));
  assert.equal(store.list()[0].settings.location,null);
  assert.equal(fs.readFileSync(store.filePath,'utf8'),original);
});

test('compact sizes persist and style switching retains scale below the default',t=>{
  const directory=path.join(__dirname,'../.tmp/tests',`compact-${randomUUID()}`);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new WidgetStore(directory);
  const music=store.create('music');
  store.updateBounds(music.id,{...music,width:160,height:160});
  assert.equal(new WidgetStore(directory).list()[0].width,160);
  const wide=store.setVariant(music.id,'wide');
  assert.equal(wide.width,288);assert.equal(wide.height,144);
  const square=store.setVariant(music.id,'square');
  assert.equal(square.width,160);assert.equal(square.id,music.id);
  assert.throws(()=>store.updateBounds(music.id,{...square,width:144,height:144}),/Invalid/);
  const weather=store.create('weather');
  store.updateBounds(weather.id,{...weather,width:160,height:128});
  assert.equal(new WidgetStore(directory).list()[1].height,128);
});
