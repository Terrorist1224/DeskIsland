param([string]$SourcePath)
$ErrorActionPreference='Stop'
$ast=[Management.Automation.Language.Parser]::ParseFile($SourcePath,[ref]$null,[ref]$null)
Invoke-Expression ($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-MediaSnapshot'},$true)[0].Extent.Text)
function Check($value,$message){if(-not $value){throw $message}}
function Get-MediaSession{return $script:session}
function Wait-WinRtOperation{param($Operation,$ResultType);return $Operation}
function Get-MediaTiming{param($Timeline,$Playback,$SourceId,$TrackKey);return @{playbackStatus='Paused';positionTicks=10}}
function Read-MediaArtwork{param($Stream);return $script:cover}
$script:cover='data:image/png;base64,'+('A'*200000)
$script:properties=[pscustomobject]@{Title='Test track';Artist='Test artist';AlbumTitle='Test album';Thumbnail=([pscustomobject]@{})}
$script:properties.Thumbnail|Add-Member ScriptMethod OpenReadAsync {return 1}
$script:session=[pscustomobject]@{SourceAppUserModelId='QQMusic.exe'}
$script:session|Add-Member ScriptMethod TryGetMediaPropertiesAsync {return $script:properties}
$script:session|Add-Member ScriptMethod GetTimelineProperties {return [pscustomobject]@{EndTime=[TimeSpan]::FromSeconds(120)}}
$script:session|Add-Member ScriptMethod GetPlaybackInfo {return [pscustomobject]@{Controls=[pscustomobject]@{IsPlayPauseToggleEnabled=$true;IsNextEnabled=$true;IsPreviousEnabled=$true;IsPlaybackPositionEnabled=$false}}}
$script:artworkKey='';$script:artworkDataUrl=$null;$script:artworkRetryAt=[DateTimeOffset]::MinValue;$script:metadataRevision=0
$first=Get-MediaSnapshot
Check ($first.title -eq 'Test track' -and $first.thumbnailDataUrl -eq $script:cover) 'first snapshot must include metadata and artwork'
$cached=Get-MediaSnapshot $first.metadataKey
Check (-not $cached.ContainsKey('title') -and -not $cached.ContainsKey('thumbnailDataUrl')) 'unchanged metadata must not be resent'
Check ($cached.positionTicks -eq 10 -and $cached.canToggle) 'light snapshots must retain timing and controls'
$script:properties.Title='Test next track';$script:properties.Thumbnail=$null
$changed=Get-MediaSnapshot $first.metadataKey
Check ($changed.title -eq 'Test next track' -and $null -eq $changed.thumbnailDataUrl) 'new track must replace metadata and clear old artwork'
$script:properties.Thumbnail=[pscustomobject]@{};$script:properties.Thumbnail|Add-Member ScriptMethod OpenReadAsync {return 1}
$script:artworkRetryAt=[DateTimeOffset]::MinValue
$late=Get-MediaSnapshot $changed.metadataKey
Check ($late.metadataKey -ne $changed.metadataKey -and $late.thumbnailDataUrl -eq $script:cover) 'late artwork must invalidate the metadata key'
$fresh=Get-MediaSnapshot '99999999/1'
Check ($fresh.ContainsKey('title') -and $fresh.ContainsKey('thumbnailDataUrl')) 'new renderers or restarted workers must receive complete metadata'
$script:session=$null
Check (-not (Get-MediaSnapshot $late.metadataKey).available) 'disappearing session must clear playback'
$fullBytes=[Text.Encoding]::UTF8.GetByteCount(($first|ConvertTo-Json -Compress))
$lightBytes=[Text.Encoding]::UTF8.GetByteCount(($cached|ConvertTo-Json -Compress))
Write-Output "METADATA_CHECK_PASSED fullBytes=$fullBytes lightBytes=$lightBytes"
