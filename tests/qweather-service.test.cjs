const test = require('node:test');
const assert = require('node:assert/strict');
const { QWeatherService, toWmoCode } = require('../src/main/qweather-service.cjs');
const { WeatherService } = require('../src/main/weather-service.cjs');
const config = { host: 'test.qweatherapi.com', apiKey: 'TEST_ONLY_API_KEY' };
const location = { name: '开福区', latitude: 28.2884, longitude: 112.9966, regionCodes: ['43','4301','430105'] };
const current = { temperature: { value: 27, unit: '°C' }, feelsLike: { value: 26, unit: '°C' }, condition: { text: '晴（测试数据）', code: '100' } };
const daily = { days: [{ temperatureMax: { value: 29, unit: '°C' }, temperatureMin: { value: 20, unit: '°C' } }] };

test('personal API KEY uses only a header and never credentials in the URL', async () => {
  let calls = 0;
  const provider = new QWeatherService({ host: config.host, apiKey: 'TEST_ONLY_API_KEY' }, { fetchImpl: async (url, options) => {
    calls++;
    assert.deepEqual(options.headers, { 'X-QW-Api-Key': 'TEST_ONLY_API_KEY' });
    assert.equal(new URL(url).searchParams.has('key'), false);
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => String(url).includes('/current/') ? current : daily };
  } });
  assert.equal((await provider.getForecast(location)).source, '和风天气');
  assert.equal(calls, 2);
  assert.throws(() => new QWeatherService({ host: config.host, apiKey: 'bad\nheader' }), /配置/);
});

test('changing the account ignores old in-flight snapshots when caching', async () => {
  let finish;
  const old = { getForecast: () => new Promise(resolve => { finish = resolve; }) };
  const service = new WeatherService({ qweather: old });
  const pending = service.getWeather(location);
  await new Promise(resolve => setImmediate(resolve));
  service.setProvider({ getForecast: async () => ({ temperature: 10, source: 'new test account' }) });
  await service.getWeather(location);
  finish({ temperature: 20, source: 'old test account' });
  await pending;
  assert.equal((await service.getWeather(location)).temperature, 10);
});

test('QWeather sends API KEY to parallel current/daily requests', async () => {
  const finish = [], requests = [];
  const provider = new QWeatherService(config, { fetchImpl: (url, options) => {
    requests.push({ url: new URL(url), options });
    return new Promise(resolve => finish.push(() => resolve({ ok: true, json: async () => String(url).includes('/current/') ? current : daily })));
  } });
  const pending = provider.getForecast(location);
  assert.equal(requests.length, 2, 'both endpoints must start before either returns');
  for (const { url, options } of requests) {
    assert.equal(url.host, config.host);
    assert.match(url.pathname, /28\.29\/113\.00$/);
    assert.equal(url.searchParams.get('lang'), 'zh');
    assert.equal(url.searchParams.get('localTime'), 'true');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { 'X-QW-Api-Key': config.apiKey });
  }
  finish.forEach(resolve => resolve());
  const forecast = await pending;
  assert.equal(forecast.temperature, 27);assert.equal(forecast.high, 29);assert.equal(forecast.low, 20);
  assert.equal(forecast.source, '和风天气');assert.equal(forecast.weatherCode, 0);
});

test('QWeather validates host, coordinates, complete temperatures and units; failures abort the sibling request', async () => {
  assert.throws(() => new QWeatherService({ ...config, host: 'test.qweatherapi.com.evil.example' }), /配置/);
  assert.throws(() => new QWeatherService({ ...config, host: 'test.qweatherapi.com/path' }), /配置/);
  let signal, ok = false, body = {};
  const provider = new QWeatherService(config, { fetchImpl: async (_url, options) => {
    signal = options.signal;return { ok, status: 401, json: async () => body };
  } });
  await assert.rejects(provider.getForecast(location), /401/);assert.ok(signal.aborted);
  ok = true;await assert.rejects(provider.getForecast(location), /不完整/);
  body = { ...current, temperature: { value: 70, unit: '°F' } };await assert.rejects(provider.getForecast(location), /不完整/);
  await assert.rejects(provider.getForecast({ ...location, longitude: 181 }), TypeError);
  assert.deepEqual(['100','101','104','302','305','400','501','999'].map(toWmoCode), [0,2,3,95,61,73,45,-1]);
});

test('weather prefers QWeather, merges duplicate refreshes and uses one complete fallback snapshot on failure', async () => {
  let primaryCalls = 0, fallbackCalls = 0, fail = false, now = 1000;
  const primary = { getForecast: async () => { primaryCalls++;if (fail) throw new Error('test primary outage');return { temperature: 27, high: 29, low: 20, source: '和风天气' }; } };
  const service = new WeatherService({ qweather: primary, now: () => now, fetchImpl: async () => {
    fallbackCalls++;return { ok: true, json: async () => ({ current: { temperature_2m: 23, weather_code: 3 }, daily: { temperature_2m_max: [25], temperature_2m_min: [18] } }) };
  } });
  const snapshots = await Promise.all([service.getWeather(location), service.getWeather(location)]);
  assert.equal(primaryCalls, 1);assert.equal(fallbackCalls, 0);assert.equal(snapshots[0].location, '开福区 长沙市 湖南省');
  assert.deepEqual(snapshots[0], snapshots[1]);
  fail = true;now += 61 * 60 * 1000;
  const fallback = await service.getWeather(location);
  assert.equal(fallback.source, 'Open-Meteo');assert.equal(fallback.temperature, 23);assert.equal(fallback.high, 25);
  assert.equal(fallbackCalls, 1);
});
