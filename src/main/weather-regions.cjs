// AreaCity 2025.251231.260403: mainland province/city/district names only.
const rows = require('./china-regions.json');
const regions = new Map(rows.map(([code, parent, level, name]) => [code, { code, parent, level, name }]));
const children = new Map();
for (const region of regions.values()) {
  if (!children.has(region.parent)) children.set(region.parent, []);
  children.get(region.parent).push(region);
}

function getRegion(code) {
  if (typeof code !== 'string' || !regions.has(code)) throw new TypeError('Invalid weather region');
  return regions.get(code);
}

function listWeatherRegions(parentCode = '0') {
  if (parentCode !== '0') {
    const parent = getRegion(parentCode);
    if (parent.level === 2) return [];
  }
  return (children.get(parentCode) ?? []).map(({ code, name, level }) => ({ code, name, level }));
}

function getWeatherRegionPath(code) {
  const region = getRegion(code);
  if (region.level !== 2) throw new TypeError('请选择区或县');
  const path = [region];
  while (path[0].parent !== '0') path.unshift(getRegion(path[0].parent));
  return path.map(({ code, name, level }) => ({ code, name, level }));
}

module.exports = { listWeatherRegions, getWeatherRegionPath };
