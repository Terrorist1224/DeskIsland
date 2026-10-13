const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

test('Windows desktop enumeration is shallow, filters hidden/system entries, handles empty arrays and partial failures', { skip: process.platform !== 'win32' }, t => {
  const directory = path.resolve('.tmp/tests', `desktop-native-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.resolve('src/main/windows-host.ps1').replaceAll("'", "''");
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile('${source}', [ref]$null, [ref]$errors)
if ($errors.Count) { throw 'Invalid PowerShell syntax' }
Invoke-Expression ($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-DesktopItems' }, $true)[0].Extent.Text)
$script:mode = 'normal'
$script:called = @()
function Get-ChildItem {
  param($LiteralPath, $ErrorAction)
  $script:called += $LiteralPath
  if ($script:mode -eq 'empty') { return }
  if ($script:mode -eq 'partial' -and $LiteralPath -eq [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonDesktopDirectory)) { throw 'test denied' }
  [pscustomobject]@{ Name='TestQQ.lnk'; FullName=(Join-Path $LiteralPath 'TestQQ.lnk'); PSIsContainer=$false; Extension='.lnk'; Attributes=[IO.FileAttributes]::Normal }
  [pscustomobject]@{ Name='TestQQFolder'; FullName=(Join-Path $LiteralPath 'TestQQFolder'); PSIsContainer=$true; Extension=''; Attributes=[IO.FileAttributes]::Directory }
  [pscustomobject]@{ Name='HiddenQQ.txt'; FullName=(Join-Path $LiteralPath 'HiddenQQ.txt'); PSIsContainer=$false; Extension='.txt'; Attributes=[IO.FileAttributes]::Hidden }
  [pscustomobject]@{ Name='desktop.ini'; FullName=(Join-Path $LiteralPath 'desktop.ini'); PSIsContainer=$false; Extension='.ini'; Attributes=[IO.FileAttributes]::System }
}
$normal = Get-DesktopItems
if ($script:called.Count -ne $normal.roots.Count -or $normal.items.Count -ne 2*$normal.roots.Count) { throw 'Enumeration recursed or skipped direct entries' }
if (@($normal.items | Where-Object { $_.name -in @('HiddenQQ.txt','desktop.ini') }).Count) { throw 'Hidden or system entries leaked' }
if ($normal.items[0].kind -ne 'shortcut' -or $normal.items[1].kind -ne 'folder') { throw 'Incorrect kind' }
$script:mode = 'empty'
$empty = Get-DesktopItems | ConvertTo-Json -Depth 8 -Compress | ConvertFrom-Json
if ($empty.items -isnot [array] -or $empty.items.Count -ne 0 -or $empty.warnings -isnot [array]) { throw 'Empty JSON arrays changed shape' }
$script:mode = 'partial'
$partial = Get-DesktopItems
if ($partial.warnings.Count -ne 1 -or $partial.items.Count -ne 2) { throw 'Partial error discarded usable desktop entries' }
[Console]::WriteLine('DESKTOP_NATIVE_PASSED')
`;
  const file = path.join(directory, 'check.ps1');
  fs.writeFileSync(file, '\ufeff' + script);
  const output = execFileSync('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-File',file], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.match(output, /DESKTOP_NATIVE_PASSED/);
});
