const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('QQ infrequent timeline updates advance lyrics and pause/resume never adds paused time', { skip: process.platform !== 'win32' }, () => {
  const scriptPath = path.resolve(__dirname, '../src/main/windows-host.ps1').replaceAll("'", "''");
  const script = `
    $ErrorActionPreference = 'Stop'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile('${scriptPath}', [ref]$null, [ref]$null)
    Invoke-Expression ($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-MediaTiming'}, $true)[0].Extent.Text)
    function Check($condition, $message) { if (-not $condition) { throw $message } }
    $now = [DateTimeOffset]::Parse('2026-10-10T12:00:00Z')
    $timeline = [pscustomobject]@{ Position = [TimeSpan]::FromSeconds(10); EndTime = [TimeSpan]::FromSeconds(120); LastUpdatedTime = $now.AddSeconds(-30) }
    $playback = [pscustomobject]@{ PlaybackStatus = 'Playing'; Controls = [pscustomobject]@{ IsPauseEnabled = $true; IsPlayEnabled = $false } }
    $first = Get-MediaTiming $timeline $playback 'QQMusic.exe' $now
    $later = Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(2)
    Check ($first.positionTicks -eq 100000000) 'Old timestamp cannot jump progress on first observation'
    Check ($later.positionTicks -eq 120000000) 'Lyrics freeze: repeated stale QQ snapshots must still advance past next lyric'
    $playback.PlaybackStatus = 'Paused'; $timeline.Position = [TimeSpan]::FromSeconds(12)
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(2)).positionTicks -eq 120000000) 'Pause uses source position'
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(62)).positionTicks -eq 120000000) 'Pause cannot advance'
    $playback.PlaybackStatus = 'Playing'
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(62)).positionTicks -eq 120000000) 'Resume cannot add paused duration'
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(64)).positionTicks -eq 140000000) 'Resume advances from new observation'
    $timeline.Position = [TimeSpan]::FromSeconds(3); $timeline.LastUpdatedTime = $now.AddSeconds(64)
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(64)).positionTicks -eq 30000000) 'Backward seek replaces anchor'
    $script:mediaTiming = $null
    $timeline.Position = [TimeSpan]::FromSeconds(10); $timeline.LastUpdatedTime = $now.AddSeconds(-2)
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now).positionTicks -eq 120000000) 'Seed from fresh timestamp'
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(6)).positionTicks -eq 180000000) 'Crossing five seconds cannot rewind and freeze'
    $timeline.Position = [TimeSpan]::FromSeconds(30); $timeline.LastUpdatedTime = $now.AddSeconds(6)
    $playback.PlaybackStatus = 'Paused'
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(6)).positionTicks -eq 300000000) 'Pause anchors at source'
    $playback.PlaybackStatus = 'Playing'
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(7)).positionTicks -eq 300000000) 'Short pause cannot be counted as playing time'
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(9)).positionTicks -eq 320000000) 'Short pause resumes advancing'
    $timeline.LastUpdatedTime = $now.AddSeconds(-30)
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(10) 'first-track').positionTicks -eq 300000000) 'Track anchor starts from source'
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(12) 'first-track').positionTicks -eq 320000000) 'Track anchor advances'
    Check ((Get-MediaTiming $timeline $playback 'QQMusic.exe' $now.AddSeconds(12) 'second-track').positionTicks -eq 300000000) 'New track with identical timing cannot inherit progress'
    Write-Output 'stale-timeline-passed'
    @{ first = $first.positionTicks; later = $later.positionTicks } | ConvertTo-Json -Compress
  `;
  const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  assert.match(output, /stale-timeline-passed/);
  const timing = JSON.parse(output.trim().split(/\r?\n/).at(-1));
  const { activeLyric } = require('../src/shared/lyrics.ts');
  const lines = [{ timeSeconds: 10, text: '测试第一句' }, { timeSeconds: 11, text: '测试第二句' }];
  assert.equal(activeLyric(lines, timing.first / 10_000_000).text, '测试第一句');
  assert.equal(activeLyric(lines, timing.later / 10_000_000).text, '测试第二句');
});

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
