// Map provider conditions to the WMO codes used by the existing weather icons.
function toWmoCode(code) {
  const value = Number(code);
  if ([100, 150].includes(value)) return 0;
  if ([101, 102, 103, 151, 152, 153].includes(value)) return 2;
  if (value === 104) return 3;
  if ([302, 303, 304].includes(value)) return 95;
  if (value >= 300 && value < 400) return [313, 404, 405, 406].includes(value) ? 66 : 61;
  if (value >= 400 && value < 500) return [404, 405, 406, 456].includes(value) ? 66 : 73;
  if (value >= 500 && value < 600) return 45;
  return -1;
}

class QWeatherService {
  constructor(config, { fetchImpl = fetch } = {}) {
    if (!config || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.qweatherapi\.com$/i.test(config.host) ||
        typeof config.apiKey !== 'string' || !/^[a-zA-Z0-9._-]{8,256}$/.test(config.apiKey)) {
      throw new Error('和风天气配置无效');
    }
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async getForecast(location) {
    if (!Number.isFinite(location?.latitude) || Math.abs(location.latitude) > 90 ||
        !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) throw new TypeError('Invalid weather coordinates');
    const coordinates = `${location.latitude.toFixed(2)}/${location.longitude.toFixed(2)}`;
    const headers = { 'X-QW-Api-Key': this.config.apiKey };
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
    const request = async kind => {
      const url = new URL(`/weather/v1/${kind}/${coordinates}`, `https://${this.config.host}`);
      url.search = new URLSearchParams({ lang: 'zh', localTime: 'true', ...(kind === 'daily' ? { days: '1' } : {}) });
      // Never forward credentials to a redirected host.
      const response = await this.fetchImpl(url, { headers, redirect: 'error', signal });
      if (!response.ok) throw new Error(`和风天气暂时不可用（${response.status}）`);
      return response.json();
    };
    try {
      const [current, daily] = await Promise.all([request('current'), request('daily')]);
      const day = daily.days?.[0];
      const temperature = current.temperature?.value, apparentTemperature = current.feelsLike?.value;
      const high = day?.temperatureMax?.value, low = day?.temperatureMin?.value;
      if (![temperature, apparentTemperature, high, low].every(Number.isFinite) ||
          [current.temperature?.unit, current.feelsLike?.unit, day?.temperatureMax?.unit, day?.temperatureMin?.unit].some(unit => unit !== '°C') ||
          typeof current.condition?.text !== 'string' || !/^\d{3}$/.test(current.condition?.code)) {
        throw new Error('和风天气返回的数据不完整');
      }
      return { temperature, apparentTemperature, high, low, condition: current.condition.text,
        weatherCode: toWmoCode(current.condition.code), source: '和风天气',
        attribution: '和风天气 · https://developer.qweather.com/attribution.html' };
    } finally { controller.abort(); }
  }
}

module.exports = { QWeatherService, toWmoCode };
