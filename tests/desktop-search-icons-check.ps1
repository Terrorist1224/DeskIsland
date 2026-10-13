param([Parameter(Mandatory = $true)][string]$Directory)
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot '..\src\main\desktop-search-icons.cs') -ReferencedAssemblies System.Drawing
function Decode-Icon([string]$Url) {
  $bytes = [Convert]::FromBase64String($Url.Substring('data:image/png;base64,'.Length))
  $stream = [IO.MemoryStream]::new($bytes)
  try {
    $image = [Drawing.Bitmap]::new($stream)
    try { return @{ width=$image.Width; height=$image.Height; transparent=$image.GetPixel(0,0).A; middle=$image.GetPixel([int]($image.Width/2),[int]($image.Height/2)); bytes=$bytes } }
    finally { $image.Dispose() }
  } finally { $stream.Dispose() }
}
$alpha = Decode-Icon ([DeskIslandShellIcon]::Encode([byte[]](0,0,0,0,0,0,128,128),2,1))
if ($alpha.transparent -ne 0 -or $alpha.middle.A -ne 128 -or $alpha.middle.R -lt 254) { throw 'Premultiplied icon alpha was lost' }
$image = [Drawing.Bitmap]::new(256,256,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [Drawing.Graphics]::FromImage($image)
$stream = [IO.MemoryStream]::new()
try {
  $graphics.Clear([Drawing.Color]::Transparent)
  $graphics.FillEllipse([Drawing.Brushes]::Red,16,16,224,224)
  $graphics.FillRectangle([Drawing.Brushes]::White,120,32,4,160)
  $image.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
  $png = $stream.ToArray()
} finally { $graphics.Dispose(); $image.Dispose(); $stream.Dispose() }
$icon = Join-Path $Directory 'test-high-resolution.ico'
$writer = [IO.BinaryWriter]::new([IO.File]::Create($icon))
try {
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
  $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
} finally { $writer.Dispose() }
$shell = New-Object -ComObject WScript.Shell
$linkPath = Join-Path $Directory 'test-high-resolution.lnk'
$link = $shell.CreateShortcut($linkPath)
$link.TargetPath = Join-Path $env:WINDIR 'System32\notepad.exe'
$link.IconLocation = "$icon,0"
$link.Save()
[Runtime.InteropServices.Marshal]::ReleaseComObject($link) | Out-Null
[Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
foreach ($file in @($icon,$linkPath)) {
  foreach ($pixels in @(72,144)) {
    $result = Decode-Icon ([DeskIslandShellIcon]::Read($file,$pixels))
    if ($result.width -lt $pixels -or $result.height -lt $pixels) { throw 'Shell returned an undersized icon despite a high-resolution source' }
    if ($result.transparent -ne 0) { throw 'Native transparent icon corners became opaque' }
    if ($result.middle.R -lt 200) { throw 'Configured shortcut icon was not preserved' }
  }
}
$rejected = $false
try { [DeskIslandShellIcon]::Read($icon,8) | Out-Null } catch { $rejected = $true }
if (-not $rejected) { throw 'Invalid requested size accepted' }
$rejected = $false
try { [DeskIslandShellIcon]::Read((Join-Path $Directory 'missing.ico'),72) | Out-Null } catch { $rejected = $true }
if (-not $rejected) { throw 'Missing icon item accepted' }
Write-Output 'DESKTOP_HIGH_RES_ICON_PASSED'
