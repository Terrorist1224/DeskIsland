param([Parameter(Mandatory = $true)][string]$Directory, [Parameter(Mandatory = $true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
try {
  $visited = @()
  $directoryItem = Get-Item -LiteralPath $Directory -Force -ErrorAction Stop
  # Read only the root link metadata; write shortcuts to its target without disabling RedirectionGuard.
  while ($directoryItem.LinkType -in @('Junction', 'SymbolicLink')) {
    if ($visited -contains $Directory) { throw 'Shortcut directory link contains a cycle' }
    $visited += $Directory
    $target = @($directoryItem.Target)[0]
    if ([string]::IsNullOrWhiteSpace($target)) { throw 'Cannot resolve shortcut directory link' }
    $Directory = if ([IO.Path]::IsPathRooted($target)) { $target } else { Join-Path (Split-Path -Parent $Directory) $target }
    $directoryItem = Get-Item -LiteralPath $Directory -Force -ErrorAction Stop
  }
  if (-not $directoryItem.PSIsContainer) { throw 'Shortcut location is not a directory' }
  [IO.File]::WriteAllText($OutputPath, $directoryItem.FullName, [Text.UTF8Encoding]::new($true))
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
