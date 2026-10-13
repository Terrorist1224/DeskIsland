import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const runtime=path.join(root,'.tmp','audio-runtime');
const packages={
  'naudio.core':'794645dbfd30e4880663d52d9d9224d55c301fa54228ff623c95d572c7887347',
  'naudio.wasapi':'c8396b8dbab86a2619edfd9158beaf18c21cb86677099b5594950fd8651b9d1a',
};
fs.mkdirSync(runtime,{recursive:true});
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const [name,expected] of Object.entries(packages)) {
  const archive=path.join(runtime,name+'.zip');
  if(!fs.existsSync(archive)) {
    const response=await fetch(`https://api.nuget.org/v3-flatcontainer/${name}/2.2.1/${name}.2.2.1.nupkg`);
    if(!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    fs.writeFileSync(archive,Buffer.from(await response.arrayBuffer()));
  }
  if(hash(archive)!==expected) throw new Error(`${name}: package SHA256 mismatch`);
  const destination=path.join(runtime,name);
  execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(root,'scripts','expand-audio-runtime.ps1'),'-Archive',archive,'-Destination',destination],{windowsHide:true});
}
const ffmpeg=path.join(runtime,'ffmpeg.exe');
if(!fs.existsSync(ffmpeg)) {
  const source=process.argv[2];
  if(!source) throw new Error('Provide the FFmpeg 6.1.1 essentials executable path: npm run prepare:audio -- <path>');
  fs.copyFileSync(source,ffmpeg);
}
if(hash(ffmpeg)!=='04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00') throw new Error('FFmpeg SHA256 mismatch (expected Gyan 6.1.1 essentials)');
fs.copyFileSync(path.join(root,'THIRD_PARTY_NOTICES.md'),path.join(runtime,'THIRD_PARTY_NOTICES.md'));
console.log('Audio runtime ready: NAudio 2.2.1, FFmpeg 6.1.1');
