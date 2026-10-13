const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');const {execFileSync}=require('node:child_process');
test('Windows Shell extracts high-resolution icons and shortcut icon resources while preserving alpha',{skip:process.platform!=='win32'},t=>{
  const directory=path.resolve('.tmp/tests',`desktop-icons-${randomUUID()}`);fs.mkdirSync(directory,{recursive:true});
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const output=execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',path.resolve('tests/desktop-search-icons-check.ps1'),'-Directory',directory],{windowsHide:true,encoding:'utf8',timeout:20000});
  assert.match(output,/DESKTOP_HIGH_RES_ICON_PASSED/);
});
