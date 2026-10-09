const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('Windows media selection, timeline extrapolation, QQ transition status and unsupported seeking', { skip: process.platform !== 'win32' }, () => {
  const scriptPath = path.resolve(__dirname, '../src/main/windows-host.ps1').replaceAll("'", "''");
  // Load only the real pure functions: no WinRT initialization, player commands, or persistent worker.
  const script = `
    $ErrorActionPreference = 'Stop'
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile('${scriptPath}', [ref]$null, [ref]$parseErrors)
    if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
    $functions = $ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $true)
    foreach ($name in @('Get-MediaSession','Get-MediaTiming','Invoke-MediaCommand')) {
      Invoke-Expression ($functions | Where-Object Name -eq $name).Extent.Text
    }
    function Check($condition, $message) { if (-not $condition) { throw $message } }
    $browser = [pscustomobject]@{ SourceAppUserModelId = 'chrome.exe' }
    $qq = [pscustomobject]@{ SourceAppUserModelId = 'QQMusic.exe' }
    $netease = [pscustomobject]@{ SourceAppUserModelId = 'cloudmusic.exe' }
    $qq | Add-Member NoteProperty Status 'Paused'
    $netease | Add-Member NoteProperty Status 'Paused'
    foreach ($player in @($qq,$netease)) {
      $player | Add-Member ScriptMethod GetPlaybackInfo { return [pscustomobject]@{ PlaybackStatus = $this.Status; Controls = [pscustomobject]@{ IsPlaybackPositionEnabled = $false; IsPlayPauseToggleEnabled = $false; IsNextEnabled = $false; IsPreviousEnabled = $false } } }
    }
    $script:manager = [pscustomobject]@{ Sessions = @($browser, $netease, $qq); Current = $browser }
    $script:manager | Add-Member ScriptMethod GetSessions { return $this.Sessions }
    $script:manager | Add-Member ScriptMethod GetCurrentSession { return $this.Current }
    Check ((Get-MediaSession).SourceAppUserModelId -eq 'QQMusic.exe') 'Browser must not steal QQ session'
    $netease.Status = 'Playing'
    Check ((Get-MediaSession).SourceAppUserModelId -eq 'QQMusic.exe') 'NetEase must not displace supported QQ'
    $qq.Status = 'Playing'
    Check ((Get-MediaSession).SourceAppUserModelId -eq 'QQMusic.exe') 'QQ remains the only supported player'
    $netease.Status = 'Paused'
    Check ((Get-MediaSession).SourceAppUserModelId -eq 'QQMusic.exe') 'Only playing QQ wins'
    $script:manager.Sessions = @($browser, $netease)
    Check ($null -eq (Get-MediaSession)) 'NetEase and browser cannot become active targets'
    $script:manager.Sessions = @($browser)
    Check ($null -eq (Get-MediaSession)) 'Browser never becomes music target'
    Check (-not (Invoke-MediaCommand ([pscustomobject]@{ command='toggle'; sourceId='QQMusic.exe' })).accepted) 'No command may reach browser'
    $script:manager.Sessions = @([pscustomobject]@{ SourceAppUserModelId = 'fake-cloudmusic.exe' })
    Check ($null -eq (Get-MediaSession)) 'Substring identity must not pass allowlist'
    $script:manager.Sessions = @(); $script:manager.Current = $null
    Check ($null -eq (Get-MediaSession)) 'No session'

    $now = [DateTimeOffset]::Parse('2026-10-08T12:00:00Z')
    $timeline = [pscustomobject]@{ Position = [TimeSpan]::FromSeconds(10); EndTime = [TimeSpan]::FromSeconds(120); LastUpdatedTime = $now.AddSeconds(-2) }
    $playback = [pscustomobject]@{ PlaybackStatus = 'Playing'; Controls = [pscustomobject]@{ IsPauseEnabled = $true; IsPlayEnabled = $false } }
    $timing = Get-MediaTiming $timeline $playback 'QQMusic.exe' $now
    Check ($timing.positionTicks -eq 120000000) 'Extrapolate from source timestamp'
    $playback.PlaybackStatus = 'Paused'
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now).positionTicks -eq 100000000) 'Paused position must stay fixed'
    $playback.PlaybackStatus = 'Changing'
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now).playbackStatus -eq 'Playing') 'QQ transition with pause enabled means playing'
    Check ((Get-MediaTiming $timeline $playback 'chrome.exe' $now).playbackStatus -eq 'Changing') 'Do not override other players'
    $playback.Controls.IsPauseEnabled = $false; $playback.Controls.IsPlayEnabled = $true
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now).playbackStatus -eq 'Paused') 'QQ transition with play enabled means paused'
    $playback.PlaybackStatus = 'Playing'; $timeline.LastUpdatedTime = $now.AddSeconds(2)
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now).positionTicks -eq 100000000) 'Future timestamps cannot reverse progress'
    $timeline.LastUpdatedTime = $now.AddSeconds(-200)
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now).positionTicks -eq 100000000) 'Stale pause timestamp cannot jump forward on resume'
    $timeline.Position = [TimeSpan]::FromSeconds(119); $timeline.LastUpdatedTime = $now.AddSeconds(-2)
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now).positionTicks -eq 1200000000) 'Clamp at duration'
    $timeline.EndTime = [TimeSpan]::FromSeconds(300)
    $timeline.Position = [TimeSpan]::FromTicks(2157739898); $timeline.LastUpdatedTime = $now
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now).positionTicks -eq 2157739898) 'Ticks beyond Int32 must not overflow after shorter tracks'
    $timeline.Position = [TimeSpan]::FromSeconds(299); $timeline.LastUpdatedTime = $now.AddSeconds(-2)
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now).positionTicks -eq 3000000000) 'Long tracks must clamp without overflow'
    $timeline.Position = [TimeSpan]::FromTicks(-1); $playback.PlaybackStatus = 'Paused'
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now).positionTicks -eq 0) 'Negative ticks clamp to zero'

    $script:manager.Sessions = @($qq)
    $qq | Add-Member ScriptMethod TryChangePlaybackPositionAsync { throw 'Unsupported seek must not reach player' }
    $result = Invoke-MediaCommand ([pscustomobject]@{ command = 'seek'; sourceId = 'QQMusic.exe'; positionTicks = 600000000 })
    Check (-not $result.accepted -and $result.reason -eq 'unsupported') 'Unsupported seek cannot pretend to succeed'
    Check ((Invoke-MediaCommand ([pscustomobject]@{ command='toggle'; sourceId='cloudmusic.exe' })).reason -eq 'target-changed') 'Stale target must not control different music player'
    Check ((Invoke-MediaCommand ([pscustomobject]@{ command='toggle'; sourceId='QQMusic.exe' })).reason -eq 'unsupported') 'Unsupported toggle must not reach player'
    Write-Output 'media-checks-passed'
  `;
  const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  assert.match(output, /media-checks-passed/);
});
