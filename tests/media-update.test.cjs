const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');const {transpile}=require('typescript');
test('native metadata deltas preserve first load, track changes, delayed covers and timing',{skip:process.platform!=='win32'},()=>{
  const output=execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',path.resolve('tests/media-metadata-check.ps1'),'-SourcePath',path.resolve('src/main/windows-host.ps1')],{windowsHide:true,encoding:'utf8',timeout:10000});
  assert.match(output,/METADATA_CHECK_PASSED/);
});
test('music renderer merges light snapshots and clears metadata when track or session changes',async()=>{
  const source=fs.readFileSync(path.resolve('src/renderer/WidgetView.vue'),'utf8');const code=source.slice(source.indexOf('async function refreshMedia()'),source.indexOf('async function sendMediaCommand('));
  const calls=[];let update;
  const media={value:null};
  const refresh=new Function('window','media',transpile(`let mediaRefreshing=false,commandPending={value:false},disposed=false,mediaVersion=0,expectedPlayback=null,observedMediaAt=0,message={value:''},lyricTrackKey='',lyrics={value:null},lyricsError={value:''},lyricRequestId=0,lyricAttempts=0,lyricRetryAt=0,lyricsLoading={value:false};${code};return refreshMedia;`))({deskIsland:{getMediaSnapshot:async key=>{calls.push(key);return update;},getLyrics:async()=>null}},media);
  update={available:true,metadataKey:'123/1',sourceId:'QQMusic.exe',title:'测试歌曲',artist:'测试歌手',thumbnailDataUrl:'test-cover',positionTicks:10};await refresh();
  update={available:true,metadataKey:'123/1',sourceId:'QQMusic.exe',positionTicks:20};await refresh();assert.equal(media.value.title,'测试歌曲');assert.equal(media.value.thumbnailDataUrl,'test-cover');assert.equal(media.value.positionTicks,20);assert.equal(calls.at(-1),'123/1');
  update={available:true,metadataKey:'123/2',title:'测试下一首',artist:'测试歌手',thumbnailDataUrl:null};await refresh();assert.equal(media.value.thumbnailDataUrl,null);assert.equal(media.value.title,'测试下一首');
  update={available:false};await refresh();assert.deepEqual(media.value,{available:false});
});
