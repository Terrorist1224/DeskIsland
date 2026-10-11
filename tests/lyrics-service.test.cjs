const assert = require('node:assert/strict');
const test = require('node:test');
const { LyricsService, parseSyncedLyrics } = require('../src/main/lyrics-service.cjs');

test('parses LRC timestamps, multiple times, and ignores metadata tags', () => {
  assert.deepEqual(parseSyncedLyrics('[ar:Artist]\n[00:01.25][00:02.5]你好\n[00:03.125]世界'), [
    { timeSeconds: 1.25, text: '你好' },
    { timeSeconds: 2.5, text: '你好' },
    { timeSeconds: 3.125, text: '世界' },
  ]);
});

test('uses LRCLIB exact lookup and returns synchronized lines', async () => {
  const requests = [];
  const service = new LyricsService({ fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    return { status: 200, ok: true, json: async () => ({
      trackName: 'Song', artistName: 'Artist', syncedLyrics: '[00:04.00]Line one', plainLyrics: 'Line one',
    }) };
  } });

  const value = await service.getLyrics({ title: 'Song', artist: 'Artist', album: 'Album', durationSeconds: 120 });
  assert.equal(value.source, 'LRCLIB');
  assert.deepEqual(value.lines, [{ timeSeconds: 4, text: 'Line one' }]);
  assert.match(requests[0].url, /track_name=Song/);
  assert.match(requests[0].url, /duration=120/);
  assert.equal(requests[0].options.headers['User-Agent'], 'DeskIsland/0.1.0');
});

test('search fallback rejects mismatched titles and durations', async () => {
  let requestCount = 0;
  const service = new LyricsService({ fetchImpl: async (url) => {
    requestCount += 1;
    if (String(url).includes('musicu.fcg')) return { ok: true, json: async () => ({ code: 0, req_1: { code: 0, data: { body: { song: { list: [] } } } } }) };
    if (String(url).includes('/get?')) return { status: 404, ok: false };
    return { status: 200, ok: true, json: async () => [
      { trackName: 'Other Song', artistName: 'Artist', duration: 120, syncedLyrics: '[00:01.00]wrong' },
      { trackName: 'Song', artistName: 'Artist', duration: 160, syncedLyrics: '[00:01.00]wrong version' },
    ] };
  } });

  const value = await service.getLyrics({ title: 'Song', artist: 'Artist', durationSeconds: 120 });
  assert.equal(value, null);
  assert.equal(requestCount, 3);
});

test('caches successful lookups for the active track', async () => {
  let requestCount = 0;
  const service = new LyricsService({ fetchImpl: async () => {
    requestCount += 1;
    return { status: 200, ok: true, json: async () => ({ trackName: 'Song', artistName: 'Artist', plainLyrics: 'Line' }) };
  } });
  const track = { title: 'Song', artist: 'Artist' };
  assert.equal((await service.getLyrics(track)).plainLyrics, 'Line');
  assert.equal((await service.getLyrics(track)).plainLyrics, 'Line');
  assert.equal(requestCount, 1);
});

test('plain lyrics expire so a temporary fallback can recover synchronized lines', async () => {
  let now = 1000;
  let synchronized = false;
  let calls = 0;
  const service = new LyricsService({ now: () => now, fetchImpl: async () => {
    calls++;
    return { ok:true, json:async()=>({trackName:'Song',artistName:'Artist',plainLyrics:'测试纯文本',syncedLyrics:synchronized?'[00:01.00]恢复同步歌词':null}) };
  } });
  const track={title:'Song',artist:'Artist'};
  assert.equal((await service.getLyrics(track)).lines.length,0);
  synchronized=true;
  now+=29_999;
  assert.equal((await service.getLyrics(track)).lines.length,0);
  assert.equal(calls,1);
  now++;
  assert.equal((await service.getLyrics(track)).lines[0].text,'恢复同步歌词');
  assert.equal(calls,2);
});

const qqSong = { title: '测试歌曲', mid: 'TestMid', singer: [{ name: '测试歌手' }], album: { name: '测试专辑' }, interval: 120 };
const qqSearchResponse = (songs) => ({ ok: true, json: async () => ({ code: 0, req_1: { code: 0, data: { body: { song: { list: songs } } } } }) });

test('QQ playback uses QQ lyrics first and matches title, artist, duration and album', async () => {
  const requests = [];
  const service = new LyricsService({ fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('musicu.fcg')) return qqSearchResponse([
      { ...qqSong, title: '其他歌曲' },
      { ...qqSong, singer: [{ name: '其他歌手' }] },
      { ...qqSong, interval: 160 },
      { ...qqSong, mid: 'OtherAlbum', album: { name: '其他专辑' } },
      qqSong,
    ]);
    assert.equal(new URL(url).searchParams.get('songmid'), 'TestMid');
    return { ok: true, json: async () => ({ code: 0, lyric: '[00:01.00]测试歌词' }) };
  } });
  const track = { title: '测试歌曲', artist: '测试歌手', album: '测试专辑', durationSeconds: 120, sourceId: 'QQMusic.exe' };
  const value = await service.getLyrics(track);
  assert.equal(value.source, 'QQ Music');
  assert.deepEqual(value.lines, [{ timeSeconds: 1, text: '测试歌词' }]);
  const body = JSON.parse(new URL(requests.find(request => request.url.includes('musicu.fcg')).url).searchParams.get('data'));
  assert.equal(body.comm.ct, 19);
  assert.equal(body.req_1.param.query, '测试歌曲 测试歌手');
  assert.equal(requests.find(request => request.url.includes('fcg_query_lyric')).options.headers.Referer, 'https://y.qq.com/');
  assert.equal(await service.getLyrics(track), value);
  assert.equal(requests.length, 2);
});

test('QQ business errors and network failures fall back to LRCLIB', async () => {
  for (const fail of [() => qqSearchResponse([]), () => ({ ok: true, json: async () => ({ code: 0, req_1: { code: 2001 } }) }), () => { throw new Error('offline'); }]) {
    const service = new LyricsService({ fetchImpl: async (url) => {
      if (String(url).includes('musicu.fcg')) return fail();
      return { ok: true, json: async () => ({ trackName: '测试歌曲', artistName: '测试歌手', syncedLyrics: '[00:01.00]测试歌词' }) };
    } });
    assert.equal((await service.getLyrics({ title: '测试歌曲', artist: '测试歌手', sourceId: 'QQMusic.exe' })).source, 'LRCLIB');
  }
});

test('LRCLIB outage can recover via QQ and total failure has a short cooldown', async () => {
  let fail = false;
  let now = 1000;
  let calls = 0;
  const service = new LyricsService({ now: () => now, fetchImpl: async (url) => {
    calls++;
    if (fail || String(url).includes('lrclib.net')) throw new Error('offline');
    if (String(url).includes('musicu.fcg')) return qqSearchResponse([qqSong]);
    return { ok: true, json: async () => ({ code: 0, lyric: '[00:01.00]测试歌词' }) };
  } });
  const track = { title: '测试歌曲', artist: '测试歌手' };
  fail = true;
  const failure = await service.getLyrics(track);
  assert.match(failure.error, /offline/);
  const failedCalls = calls;
  assert.deepEqual(await service.getLyrics(track), failure);
  assert.equal(calls, failedCalls);
  fail = false;
  now += 10_001;
  assert.equal((await service.getLyrics(track)).source, 'QQ Music');
});

test('invalid player identifiers are rejected before requesting lyrics', async () => {
  const service = new LyricsService({ fetchImpl: async () => { throw new Error('must not fetch'); } });
  await assert.rejects(service.getLyrics({ title: 'Song', artist: 'Artist', sourceId: {} }), TypeError);
});

test('QQ transient 2001 response is retried using GET data and recovers without LRCLIB', async () => {
  let searches = 0;
  const service = new LyricsService({ fetchImpl: async (url, options) => {
    assert.ok(!options.method || options.method === 'GET');
    if (String(url).includes('musicu.fcg')) {
      assert.ok(new URL(url).searchParams.has('data'));
      if (++searches === 1) return { ok: true, json: async () => ({ code: 0, req_1: { code: 2001 } }) };
      return qqSearchResponse([qqSong]);
    }
    assert.equal(new URL(url).hostname, 'c.y.qq.com');
    return { ok: true, json: async () => ({ code: 0, lyric: '[00:01.00]测试歌词' }) };
  } });
  assert.equal((await service.getLyrics({ title: '测试歌曲', artist: '测试歌手', sourceId: 'QQMusic.exe' })).source, 'QQ Music');
  assert.equal(searches, 2);
});

test('concurrent lyrics requests share one lookup and a missing result expires quickly', async () => {
  let calls = 0;
  let now = 1000;
  let resolve;
  const waiting = new Promise(done => { resolve = done; });
  const service = new LyricsService({ now: () => now, fetchImpl: async () => {
    calls++;
    await waiting;
    return { ok: true, json: async () => ({ trackName: 'Song', artistName: 'Artist', syncedLyrics: '[00:01.00]Test' }) };
  } });
  const track = { title: 'Song', artist: 'Artist' };
  const first = service.getLyrics(track);
  const second = service.getLyrics(track);
  resolve();
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);

  let searches = 0;
  const missing = new LyricsService({ now: () => now, fetchImpl: async (url) => {
    searches++;
    if (String(url).includes('musicu.fcg')) return qqSearchResponse([]);
    if (String(url).includes('/get?')) return { ok: false, status: 404 };
    return { ok: true, json: async () => [] };
  } });
  assert.equal(await missing.getLyrics(track), null);
  assert.equal(await missing.getLyrics(track), null);
  assert.equal(searches, 3);
  now += 31_000;
  assert.equal(await missing.getLyrics(track), null);
  assert.equal(searches, 6);
});
