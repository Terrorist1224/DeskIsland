const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const runtime=path.resolve('.tmp/audio-runtime');
test('native audio timeline mixes both sources, pads silence, bounds buffers and restores device roles; zero-length sample reads are safe',{skip:process.platform!=='win32'||!fs.existsSync(path.join(runtime,'naudio.core/lib/netstandard2.0/NAudio.Core.dll'))},()=>{
 const output=execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',path.resolve('tests/audio-native-check.ps1'),'-RuntimePath',runtime],{windowsHide:true,encoding:'utf8',timeout:15000});
 assert.match(output,/AUDIO_NATIVE_LOGIC_PASSED/);
});
