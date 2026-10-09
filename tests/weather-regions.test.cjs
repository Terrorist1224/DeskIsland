const assert = require('node:assert/strict');
const test = require('node:test');
const { listWeatherRegions, getWeatherRegionPath } = require('../src/main/weather-regions.cjs');

test('mainland menus stop at every district and county without township options', () => {
  const provinces = listWeatherRegions();
  assert.equal(provinces.length, 31);
  assert.ok(!provinces.some(item => /台湾|香港|澳门/.test(item.name)));
  const hunan = provinces.find(item => item.name === '湖南省');
  const changsha = listWeatherRegions(hunan.code).find(item => item.name === '长沙市');
  const kaifu = listWeatherRegions(changsha.code).find(item => item.name === '开福区');
  assert.deepEqual(listWeatherRegions(kaifu.code), []);
  assert.deepEqual(getWeatherRegionPath(kaifu.code).map(item => item.name), ['湖南省', '长沙市', '开福区']);
  const yongzhou = listWeatherRegions(hunan.code).find(item => item.name === '永州市');
  const dongan = listWeatherRegions(yongzhou.code).find(item => item.name === '东安县');
  assert.deepEqual(listWeatherRegions(dongan.code), []);
  assert.deepEqual(getWeatherRegionPath(dongan.code).map(item => item.name), ['湖南省', '永州市', '东安县']);
  assert.throws(() => getWeatherRegionPath('431122100'), TypeError);
  assert.throws(() => getWeatherRegionPath(changsha.code), /请选择/);
  assert.throws(() => listWeatherRegions('invalid'), TypeError);
  assert.throws(() => getWeatherRegionPath('110101001'), TypeError);
});

test('municipalities and direct-administered county cities retain usable hierarchy', () => {
  const beijing = listWeatherRegions().find(item => item.name === '北京市');
  const city = listWeatherRegions(beijing.code);
  assert.equal(city.length, 1);
  assert.equal(city[0].name, beijing.name);
  assert.ok(listWeatherRegions(city[0].code).some(item => item.name === '东城区'));
  const chongqing = listWeatherRegions().find(item => item.name === '重庆市');
  const chongqingCity = listWeatherRegions(chongqing.code);
  assert.deepEqual(chongqingCity.map(item => item.name), ['重庆市']);
  assert.ok(listWeatherRegions(chongqingCity[0].code).some(item => item.name === '城口县'));
  assert.deepEqual(getWeatherRegionPath('500229').map(item => item.name), ['重庆市', '重庆市', '城口县']);
  const hubei = listWeatherRegions().find(item => item.name === '湖北省');
  const xiantao = listWeatherRegions(hubei.code).find(item => item.name === '仙桃市');
  const district = listWeatherRegions(xiantao.code)[0];
  assert.equal(district.name, xiantao.name);
  assert.deepEqual(listWeatherRegions(district.code), []);
  const rows = require('../src/main/china-regions.json');
  assert.equal(new Set(rows.map(item => item[0])).size, rows.length);
  const byCode = new Map(rows.map(row => [row[0], row]));
  for (const [code, parent, level] of rows) {
    assert.ok(level <= 2);
    if (level === 0) assert.equal(parent, '0');
    else assert.equal(byCode.get(parent)?.[2], level - 1, code);
  }
});
