const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const compiler = process.env.INNO_COMPILER || 'C:\\Program Files\\Inno Setup 7\\ISIDE.exe';

test('installer creates a shortcut at the physical desktop with RedirectionGuard enabled', { skip: process.platform !== 'win32' }, t => {
  const root = path.resolve('.tmp/tests', `installer-shortcut-${randomUUID()}`);
  const desktop = path.join(root, '测试实际桌面');
  const linked = path.join(root, '测试桌面联接');
  fs.mkdirSync(desktop, { recursive: true });
  fs.symlinkSync(desktop, linked, 'junction');
  // All installer writes, including its temp directory and shortcut, stay inside this disposable fixture.
  const temp = path.join(root, 'temp');fs.mkdirSync(temp);
  const env = { ...process.env, TEMP: temp, TMP: temp };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const helper = path.resolve('installer/resolve-shortcut-directory.ps1');
  const include = path.resolve('installer/shortcut-directory.iss');
  const script = `
[Setup]
AppName=DeskIsland Shortcut Test
AppVersion=0.0.0
PrivilegesRequired=lowest
RedirectionGuard=yes
Uninstallable=no
CreateAppDir=no
OutputDir=${root}
OutputBaseFilename=shortcut-test
[Files]
Source: "${helper}"; Flags: dontcopy
[Icons]
Name: "{code:GetTestDesktop}\\测试快捷方式"; Filename: "{sys}\\notepad.exe"
[Code]
#include "${include}"
function GetTestDesktop(Param: String): String;
begin
  Result := ResolveShortcutDirectory('${linked}');
end;
`;
  const file = path.join(root, 'check.iss');fs.writeFileSync(file, '\ufeff' + script);
  const args = path.basename(compiler).toLowerCase() === 'iside.exe' ? ['-cc', file] : [file];
  execFileSync(compiler, args, { env, windowsHide: true, timeout: 60000 });
  const installer = path.join(root, 'shortcut-test.exe');assert.ok(fs.existsSync(installer), 'Inno compilation failed');
  const log = path.join(root, 'install.log');
  execFileSync(installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${log}`], { env, windowsHide: true, timeout: 30000 });
  assert.ok(fs.existsSync(path.join(desktop, '测试快捷方式.lnk')));
  const output = fs.readFileSync(log, 'utf8');
  assert.match(output, /RedirectionGuard status for current process: Enabled in enforcing mode/i);
  assert.ok(output.includes(`Shortcut directory: ${linked} -> ${desktop}`));
  const result = path.join(root, 'resolved.txt');
  execFileSync('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-File',helper,'-Directory',linked,'-OutputPath',result], { windowsHide:true,timeout:10000 });
  assert.equal(fs.readFileSync(result,'utf8').replace(/^\ufeff/,''), desktop);
  assert.throws(() => execFileSync('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-File',helper,'-Directory',path.join(root,'missing'),'-OutputPath',result], { windowsHide:true,timeout:10000,stdio:'pipe' }));
});
