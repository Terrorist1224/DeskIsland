param([string]$RuntimePath)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$core = Join-Path $RuntimePath 'naudio.core/lib/netstandard2.0/NAudio.Core.dll'
$wasapi = Join-Path $RuntimePath 'naudio.wasapi/lib/netstandard2.0/NAudio.Wasapi.dll'
[Reflection.Assembly]::LoadFrom($core) | Out-Null
[Reflection.Assembly]::LoadFrom($wasapi) | Out-Null
$standard = [Reflection.Assembly]::Load('netstandard, Version=2.0.0.0, Culture=neutral, PublicKeyToken=cc7b13ffcd2ddd51').Location
Add-Type -Path (Join-Path $PSScriptRoot 'AudioHost.cs') -ReferencedAssemblies @($core,$wasapi,$standard)
$audio = [DeskIslandAudio]::new()
try {
  while ($null -ne ($line = [Console]::ReadLine())) {
    $message = $null
    try {
      $message = $line | ConvertFrom-Json
      $result = $null
      switch ($message.method) {
        'audio.snapshot' { }
        'audio.volume' { $result = @{volume=$audio.SetVolume([double]$message.volume)} }
        'audio.meter' { $result = $audio.Meter() }
        'audio.device' { $audio.SetDefault([string]$message.kind,[string]$message.deviceId) }
        'audio.start' { $audio.Start([string]$message.file) }
        'audio.stop' { $audio.Stop() }
        default { throw 'Unsupported audio method.' }
      }
      if ($null -eq $result) { $result = $audio.Snapshot() }
      @{id=$message.id;ok=$true;result=$result} | ConvertTo-Json -Depth 12 -Compress | Write-Output
    } catch {
      @{id=$message.id;ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress | Write-Output
    }
  }
} finally { $audio.Dispose() }
