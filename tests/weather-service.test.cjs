const assert = require('node:assert/strict');
const test = require('node:test');
const { WeatherService, formatLocation } = require('../src/main/weather-service.cjs');
const { getWeatherRegionPath } = require('../src/main/weather-regions.cjs');

test('simultaneous refreshes share one forecast request and release failed requests', async () => {
  let calls = 0, finish;
  const service = new WeatherService({ fetchImpl: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const location = { name: '开福区', latitude: 28.28, longitude: 113, regionCodes: ['43', '4301', '430105'] };
  const first = service.getWeather(location), second = service.getWeather(location);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  finish({ ok: true, json: async () => ({ current: { temperature_2m: 25 }, daily: {} }) });
  assert.deepEqual(await first, await second);
});

test('forecast timeouts are readable and a subsequent request can recover', async () => {
  let fail = true;
  const service = new WeatherService({ fetchImpl: async () => {
    if (fail) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    return { ok: true, json: async () => ({ current: { temperature_2m: 25 }, daily: {} }) };
  } });
  const location = { name: 'Test', latitude: 28, longitude: 113 };
  await assert.rejects(service.getWeather(location), /天气服务连接超时/);
  fail = false;
  assert.equal((await service.getWeather(location)).temperature, 25);
});

test('previously saved township paths stay readable and display only the parent county', async () => {
  const service = new WeatherService({ fetchImpl: async url => {
    assert.equal(new URL(url).hostname, 'api.open-meteo.com');
    return { ok: true, json: async () => ({ current: { temperature_2m: 25, weather_code: 0 }, daily: {} }) };
  } });
  const weather = await service.getWeather({ name: '白牙市镇', region: '东安县 · 永州市 · 湖南省', latitude: 26.4, longitude: 111.28, regionCodes: ['43', '4311', '431122', '431122100'] });
  assert.equal(weather.location, '东安县 永州市 湖南省');
});

test('selected district resolves exact parents, caches coordinates and keeps the chosen label', async () => {
  const path = getWeatherRegionPath('430105');
  let searches = 0;
  const service = new WeatherService({ fetchImpl: async url => {
    const request = new URL(url);
    if (request.pathname === '/search') {
      searches++;
      assert.equal(request.searchParams.get('q'), '开福区, 长沙市, 湖南省');
      assert.equal(request.searchParams.get('countrycodes'), 'cn');
      return { ok: true, json: async () => [
        { category: 'place', name: '开福区', lat: '28.2', lon: '113', address: { district: '开福区', region: '其他市', state: '湖南省', country_code: 'cn' } },
        { category: 'boundary', name: '开福区', lat: '28.2884', lon: '112.9966', address: { district: '开福区', region: '长沙市', state: '湖南省', country_code: 'cn' } },
      ] };
    }
    assert.equal(request.hostname, 'api.open-meteo.com');
    return { ok: true, json: async () => ({ current: { temperature_2m: 25, weather_code: 0 }, daily: {} }) };
  } });
  const location = await service.resolveRegion(path);
  assert.equal(location.latitude, 28.2884);
  assert.deepEqual(location.regionCodes, ['43', '4301', '430105']);
  assert.deepEqual(await service.resolveRegion(path), location);
  assert.equal(searches, 1);
  const weather = await service.getWeather(location);
  assert.equal(weather.location, '开福区 长沙市 湖南省');
  assert.match(weather.attribution, /Nominatim/);
});

test('county resolution refuses wrong cities, POIs, missing coordinates and incomplete responses', async () => {
  const path = getWeatherRegionPath('431122');
  assert.equal(path.at(-1).name, '东安县');
  let response = [];
  let ok = true;
  const service = new WeatherService({ fetchImpl: async () => ({ ok, status: 503, json: async () => response }) });
  const valid = { category: 'boundary', name: '东安县', lat: '26.4', lon: '111.28', address: { county: '东安县', region: '永州市', state: '湖南省', country_code: 'cn' } };
  response = [
    { ...valid, address: { ...valid.address, region: '其他市' } },
    { ...valid, category: 'amenity' },
    { ...valid, lat: '' },
    { ...valid, lon: '181' },
  ];
  await assert.rejects(service.resolveRegion(path), /原地点已保留/);
  service.addressRequestAt = 0;
  response = {};
  await assert.rejects(service.resolveRegion(path), /无效数据/);
  service.addressRequestAt = 0;
  ok = false;
  await assert.rejects(service.resolveRegion(path), /503/);
  service.addressRequestAt = 0;
  ok = true;
  response = [valid];
  const location = await service.resolveRegion(path);
  assert.equal(location.name, '东安县');
  assert.equal(location.region, '永州市 · 湖南省');
  await assert.rejects(service.resolveRegion([{ code: '431122100', name: '其他镇', level: 3 }]), TypeError);
});

test('location search requests localized city and district matches', async () => {
  let requestedUrl;
  const service = new WeatherService({
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return { ok: true, json: async () => ({ results: [{ name: '杭州', admin1: '浙江', country: '中国', latitude: 30.2, longitude: 120.1 }] }) };
    },
  });

  const results = await service.searchLocations('Hangzhou');
  assert.equal(requestedUrl.searchParams.get('language'), 'zh');
  assert.equal(requestedUrl.searchParams.get('name'), 'Hangzhou');
  assert.equal(results[0].region, '浙江');
});

test('weather data is cached for one hour and marked stale on provider failure', async () => {
  let now = 1_000;
  let fail = false;
  const service = new WeatherService({
    now: () => now,
    fetchImpl: async () => {
      if (fail) throw new Error('offline');
      return {
        ok: true,
        json: async () => ({
          current: { temperature_2m: 23, apparent_temperature: 22, weather_code: 1 },
          daily: { temperature_2m_max: [26], temperature_2m_min: [17] },
        }),
      };
    },
  });
  const location = { name: '杭州', region: '浙江', latitude: 30.2, longitude: 120.1 };

  const first = await service.getWeather(location);
  assert.equal(first.condition, '大致晴朗');
  assert.equal(first.weatherCode, 1);
  assert.equal(first.location, '杭州 浙江');
  assert.equal(first.stale, false);
  assert.equal((await service.getWeather(location)).updatedAt, first.updatedAt);

  now += 59 * 60 * 1000;
  assert.equal((await service.getWeather(location)).updatedAt, first.updatedAt);
  now += 60 * 1000;
  fail = true;
  const stale = await service.getWeather(location);
  assert.equal(stale.stale, true);
  assert.equal(stale.temperature, 23);
});

test('weather rejects coordinates outside valid ranges', async () => {
  const service = new WeatherService({ fetchImpl: async () => { throw new Error('must not fetch'); } });
  await assert.rejects(service.getWeather({ name: 'Bad', latitude: 120, longitude: 0 }), TypeError);
});

test('Chinese district search separates the full address, excludes POIs, and caches results', async () => {
  const requests = [];
  const service = new WeatherService({ fetchImpl: async (url) => {
    requests.push(new URL(url));
    const place = { type: 'city', name: '开福区', county: '开福区', state: '湖南省', country: '中国' };
    return { ok: true, json: async () => ({ features: [
      { properties: place, geometry: { type: 'Point', coordinates: [112.980669, 28.2593076] } },
      { properties: { ...place, type: 'house', name: '开福区政府站' }, geometry: { type: 'Point', coordinates: [112.9, 28.2] } },
      { properties: { ...place, type: 'locality', osm_value: 'street', name: '测试街道' }, geometry: { type: 'Point', coordinates: [112.9, 28.2] } },
      { properties: place, geometry: { type: 'Point', coordinates: [200, 28] } },
      { properties: place },
    ] }) };
  } });
  const results = await service.searchLocations('湖南省长沙市开福区');
  assert.equal(requests[0].hostname, 'photon.komoot.io');
  assert.equal(requests[0].searchParams.get('q'), '开福区 长沙市 湖南省');
  assert.equal(results.length, 1);
  assert.equal(results[0].latitude, 28.2593076);
  assert.equal(results[0].longitude, 112.980669);
  assert.equal(results[0].region, '湖南省');
  assert.match(results[0].attribution, /OpenStreetMap/);
  assert.deepEqual(await service.searchLocations('湖南省长沙市开福区'), results);
  assert.equal(requests.length, 1);
});

test('Chinese district search rejects malformed provider responses', async () => {
  const service = new WeatherService({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  await assert.rejects(service.searchLocations('开福区'), /invalid results/);
});

test('previously saved street locations display their parent district', async () => {
  const service=new WeatherService({fetchImpl:async()=>({ok:true,json:async()=>({current:{temperature_2m:25,weather_code:0},daily:{}})})});
  const weather=await service.getWeather({name:'洪山街道',region:'洪西社区 · 开福区 · 湖南省',latitude:28.25,longitude:113.02});
  assert.equal(weather.location,'开福区 湖南省');
});

test('Chinese location search retains villages and excludes finer administrative places', async () => {
  const service=new WeatherService({fetchImpl:async()=>({ok:true,json:async()=>({features:[
    {properties:{type:'city',osm_value:'village',name:'测试村'},geometry:{type:'Point',coordinates:[113,28]}},
    {properties:{type:'city',osm_value:'administrative',name:'洪山街道'},geometry:{type:'Point',coordinates:[113,28]}},
    {properties:{type:'locality',osm_value:'hamlet',name:'测试自然聚落'},geometry:{type:'Point',coordinates:[113,28]}},
  ]})})});
  assert.deepEqual((await service.searchLocations('测试村')).map(place=>place.name),['测试村']);
});

test('location labels show district or county, city and province without townships', () => {
  assert.equal(formatLocation({name:'洪山街道',region:'洪西社区 · 开福区 · 湖南省'}, {suburb:'洪山街道',district:'开福区',region:'长沙市',state:'湖南省'}),'开福区 长沙市 湖南省');
  assert.equal(formatLocation({name:'测试村'}, {village:'测试村',town:'白牙市镇',county:'东安县',region:'永州市',state:'湖南省'}),'东安县 永州市 湖南省');
  assert.equal(formatLocation({name:'开福区',region:'长沙市 · 湖南省'}, {district:'开福区',city:'长沙市',state:'湖南省'}),'开福区 长沙市 湖南省');
});

test('reverse location hierarchy is shared and cached for the selected coordinates', async () => {
  let reverseCalls=0;
  const service=new WeatherService({fetchImpl:async url=>{
    if(new URL(url).hostname==='nominatim.openstreetmap.org'){reverseCalls++;return {ok:true,json:async()=>({address:{district:'开福区',region:'长沙市',state:'湖南省'}})};}
    return {ok:true,json:async()=>({current:{temperature_2m:25,weather_code:0},daily:{}})};
  }});
  const location={name:'洪山街道',region:'开福区 · 湖南省',latitude:28.25,longitude:113.02};
  const results=await Promise.all([service.getWeather(location),service.getWeather(location)]);
  assert.ok(results.every(weather=>weather.location==='开福区 长沙市 湖南省'));
  assert.equal(reverseCalls,1);
});

test('a transient reverse lookup failure recovers the full location label', async () => {
  let attempts=0;
  const service=new WeatherService({fetchImpl:async url=>{
    if(new URL(url).hostname==='nominatim.openstreetmap.org'){
      if(++attempts===1) throw new Error('transient network outage');
      return {ok:true,json:async()=>({address:{district:'开福区',region:'长沙市',state:'湖南省'}})};
    }
    return {ok:true,json:async()=>({current:{temperature_2m:25,weather_code:0},daily:{}})};
  }});
  assert.equal((await service.getWeather({name:'洪山街道',region:'开福区 · 湖南省',latitude:28.25,longitude:113.02})).location,'开福区 长沙市 湖南省');
});
