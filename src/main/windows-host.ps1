# A single hidden Windows PowerShell 5.1 worker owns Windows Runtime media access.
# The stdin/stdout JSON-lines protocol keeps WinRT objects out of Electron IPC.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class DeskIslandWindowState {
  [StructLayout(LayoutKind.Sequential)]
  private struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  private struct MonitorInfo { public int Size; public Rect Monitor; public Rect Work; public uint Flags; }
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] private static extern IntPtr SetWindowLongPtr64(IntPtr window, int index, IntPtr value);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)] private static extern int SetWindowLong32(IntPtr window, int index, int value);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, System.Text.StringBuilder className, int count);
  private delegate bool EnumCallback(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr data);

  private static void SetWindowValue(IntPtr window, int index, IntPtr value) {
    if (IntPtr.Size == 8) SetWindowLongPtr64(window, index, value);
    else SetWindowLong32(window, index, value.ToInt32());
  }

  public static bool InstallDesktopWidget(string handle) {
    IntPtr window = new IntPtr(long.Parse(handle));
    if (!IsWindow(window)) throw new ArgumentException("Widget window no longer exists.");
    IntPtr desktop = IntPtr.Zero;
    EnumWindows((candidate, data) => {
      if (FindWindowEx(candidate, IntPtr.Zero, "SHELLDLL_DefView", null) == IntPtr.Zero) return true;
      desktop = candidate;
      return false;
    }, IntPtr.Zero);
    if (desktop == IntPtr.Zero) throw new InvalidOperationException("Windows desktop host is unavailable.");
    // Owner, not parent: coordinates and DPI remain Electron DIP; no cross-process SetParent reset.
    // Explorer may host DefView in Progman or WorkerW. Bind to the actual icon host, not a stale shell HWND.
    int style = (GetWindowLong(window, -20) | 0x08000080) & ~0x00040000;
    SetWindowValue(window, -20, new IntPtr(style)); // NOACTIVATE | TOOLWINDOW, without APPWINDOW.
    SetWindowValue(window, -8, desktop); // GWLP_HWNDPARENT sets the owner of this top-level window.
    if (GetWindow(window, 4) != desktop || (GetWindowLong(window, -20) & 0x08000080) != 0x08000080)
      throw new InvalidOperationException("Windows rejected desktop widget ownership.");
    return LowerWidget(handle);
  }
  [StructLayout(LayoutKind.Sequential)]
  private struct AccentPolicy { public int State, Flags, Color, Animation; }
  [StructLayout(LayoutKind.Sequential)]
  private struct CompositionAttribute { public int Attribute; public IntPtr Data, Size; }
  [DllImport("user32.dll")] private static extern bool SetWindowCompositionAttribute(IntPtr window, ref CompositionAttribute data);
  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int width, int height);
  [DllImport("user32.dll")] private static extern int SetWindowRgn(IntPtr window, IntPtr region, bool redraw);
  [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr handle);

  public static bool ApplyGlass(string handle, bool blur) {
    IntPtr window = new IntPtr(long.Parse(handle));
    if (!IsWindow(window)) throw new ArgumentException("Window no longer exists.");
    // Minimized GetWindowRect describes the tiny titlebar, not the window's restored clipping bounds.
    if (IsIconic(window)) return false;
    // Accent policy is a Win10 compatibility path. Win11 uses Electron's documented material API.
    AccentPolicy accent = new AccentPolicy { State = blur ? 3 : 0 };
    IntPtr memory = Marshal.AllocHGlobal(Marshal.SizeOf(accent));
    try {
      Marshal.StructureToPtr(accent, memory, false);
      CompositionAttribute data = new CompositionAttribute { Attribute = 19, Data = memory, Size = new IntPtr(Marshal.SizeOf(accent)) };
      if (!SetWindowCompositionAttribute(window, ref data)) throw new InvalidOperationException("Windows rejected backdrop blur.");
    } finally { Marshal.FreeHGlobal(memory); }
    // GetWindowRect is DPI-virtualized; read physical pixels before constructing the clipping region.
    IntPtr previousDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      Rect bounds;
      if (!GetWindowRect(window, out bounds)) throw new InvalidOperationException("Cannot read window bounds.");
      if (IsIconic(window)) return false;
      int diameter = (int)Math.Round(40.0 * GetDpiForWindow(window) / 96.0);
      IntPtr region = CreateRoundRectRgn(0, 0, bounds.Right - bounds.Left + 1, bounds.Bottom - bounds.Top + 1, diameter, diameter);
      if (region == IntPtr.Zero) throw new InvalidOperationException("Cannot create rounded window region.");
      // Windows takes ownership of the region only on success.
      if (SetWindowRgn(window, region, true) == 0) { DeleteObject(region); throw new InvalidOperationException("Cannot apply rounded window region."); }
    } finally { if (previousDpi != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpi); }
    return true;
  }

  public static bool LowerWidget(string handle) {
    IntPtr window = new IntPtr(long.Parse(handle));
    if (!IsWindow(window)) throw new ArgumentException("Widget window no longer exists.");
    // HWND_BOTTOM changes only Z-order. NOACTIVATE/NOMOVE/NOSIZE preserve focus and physical bounds.
    if (!SetWindowPos(window, new IntPtr(1), 0, 0, 0, 0, 0x0013))
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    return (GetWindowLong(window, -20) & 0x00000008) == 0 && !IsIconic(window);
  }
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

  public static bool ShouldPauseWidgets() {
    IntPtr window = GetForegroundWindow();
    var className = new System.Text.StringBuilder(256);
    GetClassName(window, className, className.Capacity);
    // Show Desktop foreground windows cover the monitor but are not fullscreen applications.
    if (className.ToString() == "Progman" || className.ToString() == "WorkerW" ||
        className.ToString() == "Shell_TrayWnd" || className.ToString() == "Shell_SecondaryTrayWnd") return false;
    if (window == IntPtr.Zero) return false;
    if (IsZoomed(window)) return true;
    Rect rect;
    if (!GetWindowRect(window, out rect)) return false;
    IntPtr monitor = MonitorFromWindow(window, 2);
    MonitorInfo info = new MonitorInfo();
    info.Size = Marshal.SizeOf(info);
    if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return false;
    return Math.Abs(rect.Left - info.Monitor.Left) <= 2 &&
      Math.Abs(rect.Top - info.Monitor.Top) <= 2 &&
      Math.Abs(rect.Right - info.Monitor.Right) <= 2 &&
      Math.Abs(rect.Bottom - info.Monitor.Bottom) <= 2;
  }
}
'@

$script:managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$script:mediaPropertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$script:streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage, ContentType=WindowsRuntime]
$script:boolType = [bool]
$script:uintType = [uint32]
$script:manager = $null
$script:artworkKey = ''
$script:artworkDataUrl = $null
$script:artworkRetryAt = [DateTimeOffset]::MinValue

function Wait-WinRtOperation {
  param(
    [Parameter(Mandatory = $true)][object]$Operation,
    [Parameter(Mandatory = $true)][type]$ResultType
  )

  $asTaskDefinition = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and
      $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1
    } | Select-Object -First 1

  if (-not $asTaskDefinition) { throw 'Windows Runtime async bridge is unavailable.' }
  $task = $asTaskDefinition.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  if (-not $task.Wait(5000)) { throw 'Windows media request timed out.' }
  return $task.Result
}

function Get-MediaSession {
  if (-not $script:manager) {
    $operation = $script:managerType::RequestAsync()
    $script:manager = Wait-WinRtOperation -Operation $operation -ResultType $script:managerType
  }

  # Only verified desktop music identities may own metadata and commands; never use the global session.
  $sessions = @($script:manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -match '^QQMusic\.exe$' })
  $playing = @($sessions | Where-Object {
    $playback = $_.GetPlaybackInfo()
    $playback.PlaybackStatus.ToString() -eq 'Playing' -or
      ($_.SourceAppUserModelId -ieq 'QQMusic.exe' -and $playback.PlaybackStatus.ToString() -eq 'Changing' -and $playback.Controls.IsPauseEnabled -and -not $playback.Controls.IsPlayEnabled)
  })
  $candidates = if ($playing.Count) { $playing } else { $sessions }
  $selected = $candidates | Where-Object { $_.SourceAppUserModelId -eq $script:selectedSourceId } | Select-Object -First 1
  if (-not $selected) { $selected = $candidates | Sort-Object @{ Expression = { if ($_.SourceAppUserModelId -ieq 'QQMusic.exe') { 0 } else { 1 } } } | Select-Object -First 1 }
  $script:selectedSourceId = if ($selected) { $selected.SourceAppUserModelId } else { $null }
  return $selected
}

function Get-MediaSnapshot {
  $session = Get-MediaSession
  if (-not $session) { $script:mediaTiming = $null; return @{ available = $false } }

  $properties = Wait-WinRtOperation -Operation $session.TryGetMediaPropertiesAsync() -ResultType $script:mediaPropertiesType
  $playback = $session.GetPlaybackInfo()
  $timeline = $session.GetTimelineProperties()
  $artworkKey = @($session.SourceAppUserModelId, $properties.Title, $properties.Artist, $properties.AlbumTitle) | ConvertTo-Json -Compress
  $timing = Get-MediaTiming -Timeline $timeline -Playback $playback -SourceId $session.SourceAppUserModelId -TrackKey $artworkKey
  if ($artworkKey -ne $script:artworkKey) {
    $script:artworkKey = $artworkKey
    $script:artworkDataUrl = $null
    $script:artworkRetryAt = [DateTimeOffset]::MinValue
  }
  if (-not $script:artworkDataUrl -and $properties.Thumbnail -and [DateTimeOffset]::UtcNow -ge $script:artworkRetryAt) {
    $script:artworkRetryAt = [DateTimeOffset]::UtcNow.AddSeconds(5)
    try {
      $stream = Wait-WinRtOperation -Operation $properties.Thumbnail.OpenReadAsync() -ResultType $script:streamType
      $script:artworkDataUrl = Read-MediaArtwork -Stream $stream
    }
    catch {
      # Artwork is optional; a broken or oversized thumbnail must not hide player controls.
      $script:artworkDataUrl = $null
    }
  }
  return @{
    available = $true
    sourceId = $session.SourceAppUserModelId
    title = $properties.Title
    artist = $properties.Artist
    album = $properties.AlbumTitle
    thumbnailDataUrl = $script:artworkDataUrl
    playbackStatus = $timing.playbackStatus
    positionTicks = $timing.positionTicks
    durationTicks = $timeline.EndTime.Ticks
    timelineAvailable = ($timeline.EndTime.Ticks -gt 0)
    canToggle = $playback.Controls.IsPlayPauseToggleEnabled
    canNext = $playback.Controls.IsNextEnabled
    canPrevious = $playback.Controls.IsPreviousEnabled
    canSeek = $playback.Controls.IsPlaybackPositionEnabled
  }
}

function Read-MediaArtwork {
  param($Stream)
  # AsTask returns a raw COM stream in PowerShell 5.1; interface reflection projects its members reliably.
  $randomType = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage, ContentType=WindowsRuntime]
  $size = $randomType.GetProperty('Size').GetValue($Stream, $null)
  if ($size -le 0 -or $size -gt 2MB) { return $null }
  $contentType = ([string][Windows.Storage.Streams.IContentTypeProvider, Windows.Storage, ContentType=WindowsRuntime].GetProperty('ContentType').GetValue($Stream, $null)).Split(',')[0].Trim()
  if ($contentType -notmatch '^image/(jpeg|png|webp|gif)$') { return $null }
  $input = $randomType.GetMethod('GetInputStreamAt').Invoke($Stream, @([uint64]0))
  $asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
  $reader = [System.IO.BinaryReader]::new($asStream.Invoke($null, @($input)))
  try {
    $bytes = $reader.ReadBytes([int]$size)
    if ($bytes.Length -ne $size) { throw 'Incomplete media thumbnail.' }
    return 'data:' + $contentType + ';base64,' + [Convert]::ToBase64String($bytes)
  } finally { $reader.Dispose() }
}

function Get-MediaTiming {
  param($Timeline, $Playback, [string]$SourceId, [DateTimeOffset]$Now = [DateTimeOffset]::UtcNow, [string]$TrackKey = '')
  $status = $Playback.PlaybackStatus.ToString()
  # QQ can leave SMTC in Changing after a skip; use unambiguous play/pause capabilities in that case.
  if ($SourceId -match 'qqmusic' -and $status -eq 'Changing') {
    if ($Playback.Controls.IsPauseEnabled -and -not $Playback.Controls.IsPlayEnabled) { $status = 'Playing' }
    elseif ($Playback.Controls.IsPlayEnabled -and -not $Playback.Controls.IsPauseEnabled) { $status = 'Paused' }
  }
  $position = $Timeline.Position.Ticks
  $sourceKey = @($SourceId, $TrackKey, $Timeline.Position.Ticks, $Timeline.EndTime.Ticks, $Timeline.LastUpdatedTime.UtcTicks) | ConvertTo-Json -Compress
  $key = @($sourceKey, $status) | ConvertTo-Json -Compress
  if ($script:mediaTiming -and $script:mediaTiming.key -eq $key -and $Now -ge $script:mediaTiming.observedAt) {
    $position = $script:mediaTiming.position
    if ($status -eq 'Playing') { $position += ($Now - $script:mediaTiming.observedAt).Ticks }
  } else {
    # Fresh source timestamps seed the anchor; old paused timestamps must not add paused time on resume.
    $age = $Now - $Timeline.LastUpdatedTime
    if ($status -eq 'Playing' -and $age.Ticks -ge 0 -and $age.TotalSeconds -le 5 -and
        (-not $script:mediaTiming -or $script:mediaTiming.sourceKey -ne $sourceKey)) { $position += $age.Ticks }
    # Keep this anchor in the worker so sparse QQ updates and tile recreation cannot freeze progress.
    $script:mediaTiming = @{ key = $key; sourceKey = $sourceKey; observedAt = $Now; position = $position }
  }
  # Explicit Int64 operands prevent PowerShell from reusing an Int32 overload after shorter tracks (100 ns ticks).
  return @{ playbackStatus = $status; positionTicks = [Math]::Max([long]0, [Math]::Min([long]$Timeline.EndTime.Ticks, [long]$position)) }
}

function Invoke-MediaCommand {
  param([Parameter(Mandatory = $true)][psobject]$Message)

  $session = Get-MediaSession
  if (-not $session) { return @{ accepted = $false; reason = 'no-session' } }
  if (-not $Message.sourceId -or $session.SourceAppUserModelId -cne $Message.sourceId) {
    return @{ accepted = $false; reason = 'target-changed' }
  }
  $controls = $session.GetPlaybackInfo().Controls
  $enabled = switch ($Message.command) {
    'toggle' { $controls.IsPlayPauseToggleEnabled }
    'next' { $controls.IsNextEnabled }
    'previous' { $controls.IsPreviousEnabled }
    'seek' { $controls.IsPlaybackPositionEnabled }
    default { $false }
  }
  if (-not $enabled) { return @{ accepted = $false; reason = 'unsupported' } }

  switch ($Message.command) {
    'toggle' { $operation = $session.TryTogglePlayPauseAsync() }
    'next' { $operation = $session.TrySkipNextAsync() }
    'previous' { $operation = $session.TrySkipPreviousAsync() }
    'seek' {
      if (-not $session.GetPlaybackInfo().Controls.IsPlaybackPositionEnabled) {
        return @{ accepted = $false; reason = 'unsupported' }
      }
      if (-not ($Message.positionTicks -is [long] -or $Message.positionTicks -is [int])) {
        throw 'positionTicks must be an integer.'
      }
      $operation = $session.TryChangePlaybackPositionAsync([long]$Message.positionTicks)
    }
    default { throw 'Unsupported media command.' }
  }

  $accepted = Wait-WinRtOperation -Operation $operation -ResultType $script:boolType
  return @{ accepted = [bool]$accepted }
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $id = $null
  try {
    $message = $line | ConvertFrom-Json
    $id = $message.id
    switch ($message.method) {
      'media.snapshot' { $result = Get-MediaSnapshot }
      'media.command' { $result = Invoke-MediaCommand -Message $message }
      'system.pause-state' { $result = @{ shouldPause = [DeskIslandWindowState]::ShouldPauseWidgets() } }
      'system.lower-widget' { $result = @{ desktopLevel = [DeskIslandWindowState]::LowerWidget([string]$message.handle) } }
      'system.desktop-widget' { $result = @{ installed = [DeskIslandWindowState]::InstallDesktopWidget([string]$message.handle) } }
      'system.window-glass' { $result = @{ applied = [DeskIslandWindowState]::ApplyGlass([string]$message.handle, ($message.blur -ne $false)) } }
      default { throw 'Unsupported method.' }
    }
    $response = @{ id = $id; ok = $true; result = $result }
  }
  catch {
    $response = @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($response | ConvertTo-Json -Depth 8 -Compress))
}
