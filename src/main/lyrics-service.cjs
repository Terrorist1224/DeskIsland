const API_BASE = 'https://lrclib.net/api';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_DURATION_TOLERANCE_SECONDS = 8;
function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
}

function parseSyncedLyrics(value) {
  if (typeof value !== 'string') return [];
  const lines = [];
  const timeTag = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const rawLine of value.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const tags = [...rawLine.matchAll(timeTag)];
    const text = rawLine.replace(timeTag, '').trim();
    if (!text || tags.length === 0) continue;
    // Some LRC rows share one lyric across several timestamps; fraction digits are centiseconds or milliseconds.
    for (const [, minuteText, secondText, fractionText = ''] of tags) {
      const fractionMs = Number(fractionText.padEnd(3, '0').slice(0, 3));
      lines.push({
        timeSeconds: Number(minuteText) * 60 + Number(secondText) + fractionMs / 1000,
        text,
      });
    }
  }
  return lines.sort((left, right) => left.timeSeconds - right.timeSeconds);
}

class LyricsService {
  constructor({ fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cache = new Map();
    this.pending = new Map();
  }

  async getLyrics(track) {
    if (!track || typeof track.title !== 'string' || track.title.trim().length < 1 || track.title.length > 200 ||
        typeof track.artist !== 'string' || track.artist.trim().length < 1 || track.artist.length > 200 ||
        (track.album != null && (typeof track.album !== 'string' || track.album.length > 200)) ||
        (track.sourceId != null && (typeof track.sourceId !== 'string' || track.sourceId.length > 200)) ||
        (track.durationSeconds != null && (!Number.isFinite(track.durationSeconds) || track.durationSeconds < 1 || track.durationSeconds > 3600))) {
      throw new TypeError('Valid track title and artist are required');
    }

    const key = JSON.stringify([track.title, track.artist, track.album ?? '', track.durationSeconds ?? null, track.sourceId ?? '']);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    if (this.pending.has(key)) return this.pending.get(key);
    const request = this.#lookup(track).then(value => {
      this.cache.set(key, { value, expiresAt: this.now() + (value?.error ? 10_000 : value ? CACHE_TTL_MS : 30_000) });
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  async #lookup(track) {
    const providers = /qqmusic/i.test(track.sourceId ?? '')
      ? [() => this.#lookupQQ(track), () => this.#lookupLrcLib(track)]
      : [() => this.#lookupLrcLib(track), () => this.#lookupQQ(track)];
    const errors = [];
    for (const lookup of providers) {
      try {
        const value = await lookup();
        if (value) return value;
      } catch (error) { errors.push(error); }
    }
    if (errors.length) {
      const error = `Lyrics lookup failed: ${errors.map(error => error.message).join('; ')}`;
      // Provider outages are recoverable results; keep diagnostics without Electron IPC exception stacks.
      console.warn(`[lyrics] ${error}`);
      return { error };
    }
    return null;
  }

  async #lookupQQ(track) {
    // Request flow follows Lyricify-Lyrics-Helper (Apache-2.0); desktop identity is required for useful results.
    const searchUrl = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg');
    // GET with data avoids the intermittent 2001 responses observed for the equivalent desktop POST.
    searchUrl.search = new URLSearchParams({ data: JSON.stringify({
        comm: { ct: 19, cv: 1859, uin: 0, format: 'json' },
        req_1: { module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop',
          param: { query: `${track.title} ${track.artist}`, num_per_page: 10, page_num: 1, search_type: 0 } },
      }) });
    const body = await this.#requestQQ(searchUrl);
    const songs = body.req_1?.data?.body?.song?.list;
    if (body.code !== 0 || body.req_1?.code !== 0 || !Array.isArray(songs)) {
      throw new Error(`QQ Music search returned invalid results (${body.req_1?.code ?? body.code})`);
    }
    const matches = songs.filter(song =>
      typeof song.mid === 'string' && /^[a-zA-Z0-9]+$/.test(song.mid) &&
      normalizeName(song.title ?? song.name) === normalizeName(track.title) &&
      Array.isArray(song.singer) && normalizeName(song.singer.map(singer => singer.name).join(' ')) === normalizeName(track.artist) &&
      (!track.durationSeconds || (Number.isFinite(song.interval) && Math.abs(song.interval - track.durationSeconds) <= SEARCH_DURATION_TOLERANCE_SECONDS)));
    matches.sort((left, right) =>
      Number(normalizeName(right.album?.name) === normalizeName(track.album)) - Number(normalizeName(left.album?.name) === normalizeName(track.album)) ||
      Math.abs((left.interval ?? 0) - (track.durationSeconds ?? 0)) - Math.abs((right.interval ?? 0) - (track.durationSeconds ?? 0)));
    for (const song of matches.slice(0, 3)) {
      const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
      url.search = new URLSearchParams({ songmid: song.mid, format: 'json', nobase64: '1', g_tk: '5381', platform: 'yqq',
        loginUin: '0', hostUin: '0', inCharset: 'utf8', outCharset: 'utf-8', needNewCode: '0' });
      const record = await this.#requestQQ(url);
      const lines = parseSyncedLyrics(record.lyric);
      if (lines.length) return { source: 'QQ Music', trackName: song.title ?? song.name,
        artistName: song.singer.map(singer => singer.name).join(' / '), lines, plainLyrics: null };
    }
    return null;
  }

  async #requestQQ(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'DeskIsland/0.1.0' }, signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) throw new Error(`QQ Music request failed (${response.status})`);
        const body = await response.json();
        if (body.code !== 0 || (body.req_1 && body.req_1.code !== 0)) {
          throw new Error(`QQ Music returned an error (${body.req_1?.code ?? body.code})`);
        }
        return body;
      } catch (error) {
        if (attempt === 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  }

  async #lookupLrcLib(track) {
    const exactParams = new URLSearchParams({
      track_name: track.title,
      artist_name: track.artist,
    });
    if (track.album?.trim()) exactParams.set('album_name', track.album);
    if (track.durationSeconds) exactParams.set('duration', String(Math.round(track.durationSeconds)));

    const exact = await this.#getRecord(`${API_BASE}/get?${exactParams}`);
    if (exact && this.#hasLyrics(exact)) return this.#toSnapshot(exact);

    const searchParams = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
    const response = await this.#request(`${API_BASE}/search?${searchParams}`);
    if (!response.ok) throw new Error(`Lyrics search failed (${response.status})`);
    const records = await response.json();
    if (!Array.isArray(records)) throw new Error('Lyrics provider returned invalid search results');

    const titleKey = normalizeName(track.title);
    const artistKey = normalizeName(track.artist);
    // The exact endpoint allows about 2 seconds of duration drift; search allows a little more for player metadata,
    // but still requires exact normalized title and artist to avoid displaying lyrics for a different recording.
    const matches = records.filter((record) =>
      normalizeName(record.trackName) === titleKey &&
      normalizeName(record.artistName) === artistKey &&
      this.#hasLyrics(record) &&
      (!track.durationSeconds || !Number.isFinite(record.duration) ||
        Math.abs(record.duration - track.durationSeconds) <= SEARCH_DURATION_TOLERANCE_SECONDS));
    matches.sort((left, right) => {
      const leftAlbum = normalizeName(left.albumName) === normalizeName(track.album) ? 0 : 1;
      const rightAlbum = normalizeName(right.albumName) === normalizeName(track.album) ? 0 : 1;
      if (leftAlbum !== rightAlbum) return leftAlbum - rightAlbum;
      return Math.abs((left.duration ?? 0) - (track.durationSeconds ?? 0)) -
        Math.abs((right.duration ?? 0) - (track.durationSeconds ?? 0));
    });
    return matches.length ? this.#toSnapshot(matches[0]) : null;
  }

  async #getRecord(url) {
    const response = await this.#request(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Lyrics lookup failed (${response.status})`);
    const record = await response.json();
    return record && typeof record === 'object' ? record : null;
  }

  #request(url) {
    return this.fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'DeskIsland/0.1.0' },
      signal: AbortSignal.timeout(6000),
    });
  }

  #hasLyrics(record) {
    return (typeof record?.syncedLyrics === 'string' && record.syncedLyrics.trim().length > 0) ||
      (typeof record?.plainLyrics === 'string' && record.plainLyrics.trim().length > 0);
  }

  #toSnapshot(record) {
    return {
      source: 'LRCLIB',
      trackName: record.trackName ?? record.name ?? '',
      artistName: record.artistName ?? '',
      lines: parseSyncedLyrics(record.syncedLyrics),
      plainLyrics: record.plainLyrics ?? null,
    };
  }
}

module.exports = { LyricsService, normalizeName, parseSyncedLyrics };
