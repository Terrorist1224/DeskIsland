const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');

test('desktop pause hints cannot freeze visible music metadata, lyrics or playback state', async () => {
  const source = readFileSync(require.resolve('../src/renderer/WidgetView.vue'), 'utf8');
  const timersSource = source.slice(source.indexOf('function stopTimers()'), source.indexOf('async function loadWidget()'));
  const activeSource = source.slice(source.indexOf('function handleActiveChange('), source.indexOf('onMounted(async'));
  const refreshSource = source.slice(source.indexOf('async function refreshMedia()'), source.indexOf('async function sendMediaCommand('));
  const intervals = new Map();
  const document = { visibilityState: 'visible' };
  let now = 1000, sequence = 0;
  let snapshot = { available: true, sourceId: 'QQMusic.exe', title: '测试歌曲', artist: '测试歌手', playbackStatus: 'Paused', positionTicks: 8_000_000, durationTicks: 120_000_000, canToggle: true };
  const bridge = {
    getMediaSnapshot: async () => ({ ...snapshot }),
    getLyrics: async () => ({ lines: [{ timeSeconds: 0, text: '测试开头' }, { timeSeconds: 2, text: '测试下一句' }] }),
  };
  const harness = new Function('window', 'document', 'Date', 'setInterval', 'clearInterval', ts.transpileModule(`
    const media={value:null},lyrics={value:null},message={value:''},lyricsError={value:''},lyricsLoading={value:false},commandPending={value:false};
    const active={value:true},widget={value:{typeId:'music'}},positionPulse={value:0};
    let mediaTimer,positionTimer,mediaRefreshing=false,disposed=false,mediaVersion=0,expectedPlayback=null,observedMediaAt=0,lyricTrackKey='',lyricRequestId=0,lyricAttempts=0,lyricRetryAt=0;
    ${timersSource}${refreshSource}${activeSource}
    return {startTimers,stopTimers,handleActiveChange,handleVisibilityChange,media,lyrics};
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(
    { deskIsland: bridge }, document, { now: () => now },
    callback => { const id = ++sequence; intervals.set(id, callback); return id; }, id => intervals.delete(id));
  harness.startTimers();
  await new Promise(setImmediate);
  harness.handleActiveChange(false);
  await new Promise(setImmediate);
  snapshot = { ...snapshot, playbackStatus: 'Playing', positionTicks: 30_000_000 };
  now += 1000;
  for (const callback of [...intervals.values()]) callback();
  await new Promise(setImmediate);
  assert.equal(harness.media.value.playbackStatus, 'Playing', 'visible tile must keep reading QQ after a desktop pause hint');
  const { activeLyric } = require('../src/shared/lyrics.ts');
  assert.equal(activeLyric(harness.lyrics.value.lines, harness.media.value.positionTicks / 10_000_000).text, '测试下一句');
  document.visibilityState = 'hidden';
  harness.handleVisibilityChange();
  await new Promise(setImmediate);
  snapshot = { ...snapshot, title: '测试新歌', playbackStatus: 'Paused', positionTicks: 0 };
  now += 1000;
  for (const callback of [...intervals.values()]) callback();
  await new Promise(setImmediate);
  assert.equal(harness.media.value.title, '测试新歌', 'hidden tiles must detect track changes');
  assert.equal(harness.media.value.playbackStatus, 'Paused');
  assert.equal(activeLyric(harness.lyrics.value.lines, harness.media.value.positionTicks / 10_000_000).text, '测试开头');
  document.visibilityState = 'visible';
  harness.handleVisibilityChange();
  await new Promise(setImmediate);
  assert.equal(harness.media.value.title, '测试新歌');
  assert.doesNotMatch(source, /:animation-active="active"/, 'global foreground hints must not freeze a still-visible lyric animation');
  assert.match(source, /:animation-active="true"/, 'Vue Boolean props default to false when omitted; explicitly enable visible lyric animation');
  harness.stopTimers();
});

function refreshHarness(bridge, now = () => Date.now()) {
  const source = readFileSync(require.resolve('../src/renderer/WidgetView.vue'), 'utf8');
  const refresh = ts.transpileModule(source.slice(source.indexOf('async function refreshMedia()'), source.indexOf('async function sendMediaCommand(')), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('window', 'Date', `
    const media={value:null},lyrics={value:null},message={value:''},lyricsError={value:''},lyricsLoading={value:false},commandPending={value:false};
    let mediaRefreshing=false,disposed=false,mediaVersion=0,expectedPlayback=null,observedMediaAt=0,lyricTrackKey='',lyricRequestId=0,lyricAttempts=0,lyricRetryAt=0;
    ${refresh}
    return {refreshMedia,media,lyrics,message,lyricsLoading};
  `)({ deskIsland: bridge }, { now });
}

test('plain fallback retries without switching songs and recovers synchronized lyrics', async () => {
  let now=1000;
  let calls=0;
  const harness=refreshHarness({
    getMediaSnapshot:async()=>({available:true,sourceId:'QQMusic.exe',title:'测试歌曲',artist:'测试歌手'}),
    getLyrics:async()=>++calls===1?{lines:[],plainLyrics:'测试整首纯文本'}:{lines:[{timeSeconds:1,text:'恢复换句'}],plainLyrics:null},
  },()=>now);
  await harness.refreshMedia();
  await new Promise(setImmediate);
  now+=29_999;
  await harness.refreshMedia();
  assert.equal(calls,1,'must not poll the lyrics provider every media refresh');
  now++;
  await harness.refreshMedia();
  await new Promise(setImmediate);
  assert.equal(calls,2);
  assert.equal(harness.lyrics.value.lines[0].text,'恢复换句');
});

test('lyrics outage backs off and media failures cannot reset exhausted retries', async () => {
  let now = 1000;
  let fail = false;
  let requests = 0;
  let title = '测试歌曲';
  const harness = refreshHarness({
    getMediaSnapshot: async () => { if (fail) throw Error('读取失败'); return { available:true, sourceId:'QQMusic.exe', title, artist:'测试歌手' }; },
    getLyrics: async () => { requests++; return { error:'测试歌词服务不可用' }; },
  }, () => now);
  await harness.refreshMedia();
  await new Promise(setImmediate);
  assert.equal(harness.lyrics.value, null);
  now += 9999;
  await harness.refreshMedia();
  assert.equal(requests, 1);
  now++;
  await harness.refreshMedia();
  await new Promise(setImmediate);
  now += 20_000;
  await harness.refreshMedia();
  await new Promise(setImmediate);
  assert.equal(requests, 3);
  fail = true;
  await harness.refreshMedia();
  fail = false;
  now += 60_000;
  await harness.refreshMedia();
  assert.equal(requests, 3);
  title = '另一首测试歌曲';
  await harness.refreshMedia();
  await new Promise(setImmediate);
  assert.equal(requests, 4);
});

test('late lyrics for the old track cannot replace the new song', async () => {
  let title = '第一首';
  const pending = new Map();
  const harness = refreshHarness({
    getMediaSnapshot: async () => ({ available:true,sourceId:'QQMusic.exe',title,artist:'测试歌手' }),
    getLyrics: track => new Promise(resolve => pending.set(track.title,resolve)),
  });
  await harness.refreshMedia();
  title='第二首';
  await harness.refreshMedia();
  pending.get('第二首')({ lines:[{timeSeconds:1,text:'新歌词'}] });
  await new Promise(setImmediate);
  pending.get('第一首')({ lines:[{timeSeconds:1,text:'过期歌词'}] });
  await new Promise(setImmediate);
  assert.equal(harness.media.value.title,'第二首');
  assert.equal(harness.lyrics.value.lines[0].text,'新歌词');
});

test('media read failure clears controls and pending lyrics, then recovers', async () => {
  let fail = false;
  let requests = 0;
  let oldResolve;
  const harness = refreshHarness({
    getMediaSnapshot: async () => { if (fail) throw Error('读取失败'); return {available:true,sourceId:'QQMusic.exe',title:'测试歌曲',artist:'测试歌手',canToggle:true}; },
    getLyrics: () => { requests++; if(requests===1) return new Promise(resolve=>{oldResolve=resolve;}); return Promise.resolve({lines:[{timeSeconds:1,text:'恢复歌词'}]}); },
  });
  await harness.refreshMedia();
  assert.equal(harness.lyricsLoading.value,true);
  fail=true;
  await harness.refreshMedia();
  assert.equal(harness.media.value,null);
  assert.equal(harness.lyricsLoading.value,false);
  fail=false;
  await harness.refreshMedia();
  await new Promise(setImmediate);
  oldResolve({lines:[{timeSeconds:1,text:'旧歌词'}]});
  await new Promise(setImmediate);
  assert.equal(requests,2);
  assert.equal(harness.lyrics.value.lines[0].text,'恢复歌词');
});
