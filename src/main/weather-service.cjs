const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const PHOTON_URL = 'https://photon.komoot.io/api/';
const CACHE_TTL_MS = 60 * 60 * 1000;
const { getWeatherRegionPath } = require('./weather-regions.cjs');

function formatLocation(location, address = {}) {
  const known = [location.name, ...String(location.region ?? '').split('·')].map(value=>value.trim()).filter(Boolean);
  const values = (...items) => items.filter(value=>typeof value==='string' && value.trim()).map(value=>value.trim());
  const district = values(address.city_district, address.district, address.county, ...known).find(value=>/区$/.test(value) && !/(?:自治区|社区|小区|地区)$/.test(value));
  const county = values(address.county, address.district, ...known).find(value=>/县$/.test(value));
  const city = values(address.city, address.region, address.state_district, ...known).find(value=>/(?:市|自治州|地区|盟)$/.test(value));
  const state = values(address.state, ...known).find(value=>/(?:省|自治区|特别行政区)$/.test(value));
  const parts = district ? [district, city, state] : [county, city, state];
  return [...new Set(parts.filter(Boolean))].join(' ') || known.filter(value=>!/(?:街道|社区|小区|居委会|路|街|巷|号)$/.test(value)).join(' ') || '当前地区';
}

const conditions = new Map([
  [0, '晴朗'], [1, '大致晴朗'], [2, '局部多云'], [3, '阴'],
  [45, '有雾'], [48, '冻雾'], [51, '毛毛雨'], [53, '中等毛毛雨'], [55, '强毛毛雨'],
  [56, '轻微冻毛毛雨'], [57, '强冻毛毛雨'], [61, '小雨'], [63, '中雨'], [65, '大雨'], [66, '轻微冻雨'], [67, '强冻雨'], [71, '小雪'], [73, '中雪'], [75, '大雪'], [77, '雪粒'], [85, '小阵雪'], [86, '强阵雪'],
  [80, '阵雨'], [81, '中等阵雨'], [82, '强阵雨'], [95, '雷雨'], [96, '雷雨伴小冰雹'], [99, '雷雨伴冰雹'],
]);

class WeatherService {
  constructor({ fetchImpl = fetch, now = () => Date.now(), qweather = null, reverseUrl = process.env.DESKISLAND_GEOCODING_URL || 'https://nominatim.openstreetmap.org/reverse' } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.qweather = qweather;
    this.cache = new Map();
    this.pending = new Map();
    this.locationCache = new Map();
    this.addressCache = new Map();
    this.reverseUrl = reverseUrl;
    this.addressRequestAt = 0;
  }

  async #locationLabel(location, key) {
    if (location.regionCodes) {
      // Older settings may include a township; keep its coordinates but display the parent county.
      const codes = location.regionCodes.slice(0, 3);
      const path = getWeatherRegionPath(codes.at(-1));
      if (JSON.stringify(path.map(item => item.code)) !== JSON.stringify(codes)) throw new TypeError('Invalid weather region path');
      return [...new Set(path.map(item => item.name).reverse())].join(' ');
    }
    if (!/\p{Script=Han}/u.test(location.name)) return [location.name, location.region].filter(Boolean).join(' ');
    if (!this.addressCache.has(key)) {
      // Photon omits prefecture-level cities; OSM reverse addresses restore the district/city/province hierarchy.
      const request = (async()=>{
        const url=new URL(this.reverseUrl);
        url.search=new URLSearchParams({lat:String(location.latitude),lon:String(location.longitude),format:'jsonv2',zoom:'14','accept-language':'zh-CN'});
        for(let attempt=0;attempt<2;attempt++) {
          try {
            const body=await this.#requestAddress(url);
            if(!body.address || typeof body.address!=='object') throw new Error('Invalid location hierarchy');
            return formatLocation(location,body.address);
          } catch(error) {if(attempt===1) throw error;}
        }
      })().catch(()=>{this.addressCache.delete(key);return formatLocation(location);});
      this.addressCache.set(key,request);
    }
    return this.addressCache.get(key);
  }

  async #requestAddress(url) {
    // Search and reverse geocoding share the same one-request-per-second queue.
    const delay = Math.max(0, this.addressRequestAt - Date.now());
    this.addressRequestAt = Date.now() + delay + 1000;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const response = await this.fetchImpl(url, { headers: { 'User-Agent': 'DeskIsland/0.1.0' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`地点服务暂时不可用（${response.status}），请重试`);
    return response.json();
  }

  async resolveRegion(path) {
    const leaf = path.at(-1);
    const canonical = getWeatherRegionPath(leaf?.code);
    if (JSON.stringify(path) !== JSON.stringify(canonical)) throw new TypeError('Invalid weather region path');
    const key = `region:${leaf.code}`;
    if (this.locationCache.has(key)) return this.locationCache.get(key);
    const names = [...new Set(path.map(item => item.name).reverse())];
    const url = new URL('search', this.reverseUrl);
    url.search = new URLSearchParams({ q: names.join(', '), format: 'jsonv2', addressdetails: '1', limit: '6', countrycodes: 'cn', 'accept-language': 'zh-CN' });
    const results = await this.#requestAddress(url);
    if (!Array.isArray(results)) throw new Error('地点服务返回了无效数据，请重试');
    const match = results.find(item =>
      ['boundary', 'place'].includes(item.category) && item.name === leaf.name && item.address?.country_code === 'cn' &&
      names.every(name => Object.values(item.address).includes(name)) &&
      typeof item.lat === 'string' && item.lat.trim() && typeof item.lon === 'string' && item.lon.trim() &&
      Number.isFinite(Number(item.lat)) && Math.abs(Number(item.lat)) <= 90 &&
      Number.isFinite(Number(item.lon)) && Math.abs(Number(item.lon)) <= 180);
    if (!match) throw new Error('暂时无法获取该地点的准确坐标，请重试或选择所属区县；原地点已保留');
    const location = {
      name: leaf.name, region: names.slice(1).join(' · '), country: '中国',
      latitude: Number(match.lat), longitude: Number(match.lon), timezone: 'Asia/Shanghai',
      regionCodes: path.map(item => item.code), attribution: 'Location data © OpenStreetMap contributors (Nominatim)',
    };
    this.locationCache.set(key, location);
    return location;
  }

  async searchLocations(query) {
    if (/\p{Script=Han}/u.test(query)) return this.#searchChineseLocations(query);
    const url = new URL(GEOCODING_URL);
    url.search = new URLSearchParams({ name: query, count: '6', language: 'zh', format: 'json' });
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Location search failed (${response.status})`);
    const body = await response.json();
    return (body.results ?? []).map((item) => ({
      name: item.name,
      region: item.admin1 ?? '',
      country: item.country ?? '',
      latitude: item.latitude,
      longitude: item.longitude,
      timezone: item.timezone ?? 'auto',
    }));
  }

  async #searchChineseLocations(query) {
    const cached = this.locationCache.get(query);
    if (cached) return cached;
    // Photon needs spaces between Chinese administrative levels, starting with the most specific place.
    const parts = query.trim().match(/^(.+?(?:省|自治区|特别行政区))?(.+?市)?(.+?(?:区|县))$/);
    const url = new URL(PHOTON_URL);
    url.search = new URLSearchParams({ q: parts ? parts.slice(1).filter(Boolean).reverse().join(' ') : query, limit: '6' });
    const response = await this.fetchImpl(url, {
      headers: { 'User-Agent': 'DeskIsland/0.1.0' }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Location search failed (${response.status})`);
    const body = await response.json();
    if (!Array.isArray(body.features)) throw new Error('Location provider returned invalid results');
    const results = body.features.filter((item) =>
      ['city', 'county', 'district', 'state', 'locality'].includes(item.properties?.type) &&
      (!item.properties?.osm_value || ['administrative', 'city', 'town', 'village', 'state', 'county', 'district'].includes(item.properties.osm_value)) &&
      typeof item.properties.name === 'string' && item.geometry?.type === 'Point' &&
      !/(?:街道|社区|小区|居委会|路|街|巷|号)$/.test(item.properties.name) &&
      Number.isFinite(item.geometry.coordinates?.[0]) && Math.abs(item.geometry.coordinates[0]) <= 180 &&
      Number.isFinite(item.geometry.coordinates?.[1]) && Math.abs(item.geometry.coordinates[1]) <= 90
    ).map(({ properties: place, geometry }) => ({
      name: place.name,
      region: [...new Set([place.city, place.county, place.state].filter(value => value && value !== place.name))].join(' · '),
      country: place.country ?? '',
      latitude: geometry.coordinates[1],
      longitude: geometry.coordinates[0],
      timezone: 'auto',
      attribution: 'Location data © OpenStreetMap contributors (Photon)',
    }));
    if (results.length) this.locationCache.set(query, results);
    return results;
  }

  async getWeather(location) {
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
        location.latitude < -90 || location.latitude > 90 || location.longitude < -180 || location.longitude > 180) {
      throw new TypeError('A valid selected location is required');
    }

    const key = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}${location.regionCodes ? `:${location.regionCodes.at(-1)}` : ''}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    if (this.pending.has(key)) return this.pending.get(key);
    const request = this.#loadWeather(location, key, cached);
    this.pending.set(key, request);
    try { return await request; }
    finally { if (this.pending.get(key) === request) this.pending.delete(key); }
  }

  setProvider(qweather) {
    this.qweather = qweather;
    this.cache.clear();
    this.pending.clear();
  }

  async #loadWeather(location, key, cached) {
    const provider = this.qweather;
    const url = new URL(FORECAST_URL);
    url.search = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: 'temperature_2m,apparent_temperature,weather_code,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      forecast_days: '1',
      timezone: 'auto',
    });

    try {
      const label=await this.#locationLabel(location,key);
      if (provider) {
        try {
          const forecast = await provider.getForecast(location);
          const value = { ...forecast, location: label, updatedAt: this.now(), stale: false };
          if (this.qweather === provider) this.cache.set(key, { value, expiresAt: this.now() + CACHE_TTL_MS });
          return value;
        } catch {
          console.warn('和风天气暂不可用，正在尝试备用天气源');
        }
      }
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`天气服务暂时不可用（${response.status}），请稍后重试`);
      const body = await response.json();
      const current = body.current;
      const daily = body.daily;
      if (!current || !daily || !Number.isFinite(current.temperature_2m)) {
        throw new Error('天气服务返回的数据不完整，请稍后重试');
      }
      const value = {
        location: label,
        temperature: current.temperature_2m,
        apparentTemperature: current.apparent_temperature,
        condition: conditions.get(current.weather_code) ?? '天气状况未知',
        weatherCode: current.weather_code,
        high: daily.temperature_2m_max?.[0] ?? null,
        low: daily.temperature_2m_min?.[0] ?? null,
        updatedAt: this.now(),
        stale: false,
        source: 'Open-Meteo',
        attribution: ['Weather data by Open-Meteo', location.regionCodes ? location.attribution : /\p{Script=Han}/u.test(location.name) ? 'Location data © OpenStreetMap contributors (Photon/Nominatim)' : location.attribution].filter(Boolean).join(' · '),
      };
      if (this.qweather === provider) this.cache.set(key, { value, expiresAt: this.now() + CACHE_TTL_MS });
      return value;
    } catch (error) {
      if (cached) return { ...cached.value, stale: true };
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('天气服务连接超时，请重试');
      if (error instanceof TypeError && /fetch/i.test(error.message)) throw new Error('无法连接天气服务，请检查网络后重试');
      throw error;
    }
  }
}

module.exports = { WeatherService, formatLocation };
