const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { reactive } = require('vue');
const { transpile } = require('typescript');

function appFunction(name, end, bindings) {
  const source = readFileSync(require.resolve('../src/renderer/App.vue'), 'utf8');
  const code = source.slice(source.indexOf(`async function ${name}(`), source.indexOf(end));
  return new Function(...Object.keys(bindings), `${transpile(code)};return ${name};`)(...Object.values(bindings));
}

test('control owns pending saves across navigation and list replacement, including failures', async () => {
  const widgets = { value: [{ id: 'test', settings: { location: null } }] };
  const savingLocations = { value: {} }, errorMessage = { value: '' };
  let complete, fail, calls = 0;
  const bridge = { saveWeatherLocation: () => { calls++; return new Promise((resolve, reject) => { complete = resolve; fail = reject; }); } };
  const save = appFunction('saveWeatherLocation', 'async function toggleWidget', { bridge, widgets, savingLocations, errorMessage });
  const pending = save('test', '430105');
  assert.equal(savingLocations.value.test, true);
  await save('test', '430105');
  assert.equal(calls, 1);
  // Other UI actions may replace the list while a region resolves.
  widgets.value = [{ id: 'test', settings: { location: null } }];
  const location = { name: '测试地区', latitude: 28, longitude: 113 };
  complete(location);
  await pending;
  assert.deepEqual(widgets.value[0].settings.location, location);
  assert.equal(savingLocations.value.test, undefined);
  const failed = save('test', '330106');
  fail(new Error('测试保存失败'));
  await failed;
  assert.equal(errorMessage.value, '测试保存失败');
  assert.deepEqual(widgets.value[0].settings.location, location);
  assert.equal(savingLocations.value.test, undefined);
  const source = readFileSync(require.resolve('../src/renderer/App.vue'), 'utf8');
  assert.match(source, /v-show="!settingsPage && selectedType === 'weather'"/);
});

test('startup switch updates only on success and retains state on error', async () => {
  const startup = { value: { enabled: false, supported: true } };
  const errorMessage = { value: '' };
  const run = async action => { try { await action(); } catch (error) { errorMessage.value = error.message; } };
  const bridge = { setStartupSettings: async enabled => ({ enabled, supported: true }) };
  const change = appFunction('changeStartup', 'async function saveWeatherLocation', { startup, bridge, run });
  await change();
  assert.equal(startup.value.enabled, true);
  bridge.setStartupSettings = async () => { throw new Error('测试启动项失败'); };
  await change();
  assert.equal(startup.value.enabled, true);
  assert.equal(errorMessage.value, '测试启动项失败');
});

test('enabled weather loads once and refreshes hourly even when occluded; disabled weather never loads', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const source = readFileSync(require.resolve('../src/renderer/WidgetView.vue'), 'utf8');
  const load = source.slice(source.indexOf('async function loadWidget()'), source.indexOf('async function refreshMedia()'));
  const widget = { value: null }, message = { value: '' };
  let refreshes = 0;
  let enabled = true;
  const bridge = { listWidgets: async () => [{ id: 'test', typeId: 'weather', enabled, settings: { location: {} } }] };
  const loadWidget = new Function('window', 'widget', 'props', 'message', 'startTimers', 'selectedLocation', 'refreshWeather', 'setInterval', 'clearInterval', `let weatherTimer;${load};return loadWidget;`)(
    { deskIsland: bridge }, widget, { widgetId: 'test' }, message,
    () => {}, { value: {} }, async () => { refreshes++; }, setInterval, clearInterval);
  await loadWidget();
  assert.equal(refreshes, 1, 'a paused timer must not prevent the first weather snapshot');
  t.mock.timers.tick(60 * 60 * 1000 - 1);
  assert.equal(refreshes, 1);
  t.mock.timers.tick(1);
  assert.equal(refreshes, 2);
  enabled = false;
  await loadWidget();
  t.mock.timers.tick(2 * 60 * 60 * 1000);
  assert.equal(refreshes, 2);
});

test('weather refresh sends a cloneable location including reactive region codes', async () => {
  const source = readFileSync(require.resolve('../src/renderer/WidgetView.vue'), 'utf8');
  const refresh = source.slice(source.indexOf('async function refreshWeather()'), source.indexOf('async function configureWeather()'));
  const location = reactive({ name: '开福区', region: '长沙市 · 湖南省', latitude: 28.28, longitude: 113, regionCodes: ['43', '4301', '430105'] });
  const weather = { value: null }, message = { value: '' };
  const bridge = { getWeather: async payload => {
    assert.deepEqual(structuredClone(payload), structuredClone(JSON.parse(JSON.stringify(location))));
    return { location: '开福区 长沙市 湖南省' };
  } };
  await new Function('selectedLocation', 'window', 'weather', 'message', 'weatherRequestId', `${refresh};return refreshWeather();`)({ value: location }, { deskIsland: bridge }, weather, message, 0);
  assert.equal(message.value, '');
  assert.equal(weather.value?.location, '开福区 长沙市 湖南省');
});
