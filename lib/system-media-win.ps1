# SMTC bridge adapted from powang233/dsh-plugin-eva-theme (MIT).
param(
  [Parameter(Mandatory = $true)][ValidateSet('read', 'playpause', 'next', 'previous')][string]$Mode,
  [string]$SourceId
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Wait-WinRt($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  if (-not $task.Wait(2000)) { throw 'WinRT media operation timed out' }
  return $task.Result
}

function Get-NetEaseProcessIds {
  Get-Process -Name 'cloudmusic' -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id }
}

function Import-NetEaseProbe {
  Add-Type -LiteralPath (Join-Path $PSScriptRoot 'windows-netease.cs')
}

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$mediaType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$netEaseId = 'netease:cloudmusic.exe'

if ($Mode -ne 'read') {
  try {
    $source = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($SourceId))
    if (-not $source) { throw 'Missing source ID' }
    $manager = Wait-WinRt ($managerType::RequestAsync()) $managerType
    $sessions = @($manager.GetSessions())
    if ($source -ceq $netEaseId) {
      # Global media keys are only used while the fallback is still the sole eligible source.
      foreach ($session in $sessions) {
        if ([string]$session.GetPlaybackInfo().PlaybackStatus -in @('Playing', 'Paused')) {
          '{"ok":false,"code":"SOURCE_CHANGED"}'
          exit 0
        }
      }
      [uint32[]]$processIds = @(Get-NetEaseProcessIds)
      if ($processIds.Length -gt 0) {
        Import-NetEaseProbe
        if ([EvaMedia.NetEase]::FindTrack($processIds)) {
          [EvaMedia.NetEase]::MediaKey($Mode)
          '{"ok":true}'
          exit 0
        }
      }
      '{"ok":false,"code":"SOURCE_CHANGED"}'
      exit 0
    }
    $target = $sessions | Where-Object { [string]$_.SourceAppUserModelId -ceq $source } | Select-Object -First 1
    if ($null -eq $target -or [string]$target.GetPlaybackInfo().PlaybackStatus -notin @('Playing', 'Paused')) {
      '{"ok":false,"code":"SOURCE_CHANGED"}'
      exit 0
    }
    $operation = switch ($Mode) {
      'playpause' { $target.TryTogglePlayPauseAsync() }
      'next' { $target.TrySkipNextAsync() }
      'previous' { $target.TrySkipPreviousAsync() }
    }
    if (Wait-WinRt $operation ([bool])) { '{"ok":true}'; exit 0 }
  } catch { }
  '{"ok":false,"code":"CONTROL_UNAVAILABLE"}'
  exit 0
}

function Limit-Text([string]$value) {
  if ($value.Length -gt 1000) { return $value.Substring(0, 1000) }
  return $value
}

$manager = $null
$probeReady = $false
$probeAttempted = $false
$lastTrack = $null
$lastPeak = 0L
$sampleClock = [System.Diagnostics.Stopwatch]::StartNew()
# Keep the file ASCII for Windows PowerShell 5.1.
$netEaseSuffix = ' - ' + (-join ([char[]](0x7F51, 0x6613, 0x4E91, 0x97F3, 0x4E50)))
while ($true) {
  $line = '{"ok":false}'
  try {
    if ($null -eq $manager) { $manager = Wait-WinRt ($managerType::RequestAsync()) $managerType }
    $current = $manager.GetCurrentSession()
    $sessions = @($current) + @($manager.GetSessions())
    $rows = @()
    $seen = @{}
    foreach ($session in $sessions) {
      if ($null -eq $session) { continue }
      try {
        $id = [string]$session.SourceAppUserModelId
        if (-not $id -or $id.Length -gt 1024 -or $seen.ContainsKey($id)) { continue }
        $seen[$id] = $true
        $status = [string]$session.GetPlaybackInfo().PlaybackStatus
        if ($status -notin @('Playing', 'Paused')) { continue }
        $properties = Wait-WinRt ($session.TryGetMediaPropertiesAsync()) $mediaType
        if (-not $properties.Title) { continue }
        $timeline = $session.GetTimelineProperties()
        $rows += [ordered]@{
          aumid = $id; source = 'smtc'; status = $status; title = (Limit-Text $properties.Title)
          artist = (Limit-Text $properties.Artist); album = (Limit-Text $properties.AlbumTitle)
          duration = ($timeline.EndTime - $timeline.StartTime).TotalSeconds
          position = ($timeline.Position - $timeline.StartTime).TotalSeconds
        }
        if ($rows.Count -ge 5) { break }
      } catch { }
    }
    if ($rows.Count -lt 5 -and -not ($rows | Where-Object { $_.aumid -match 'cloudmusic|netease' })) {
      [uint32[]]$processIds = @(Get-NetEaseProcessIds)
      if ($processIds.Length -gt 0) {
        if (-not $probeAttempted) {
          $probeAttempted = $true
          try { Import-NetEaseProbe; $probeReady = $true } catch { }
        }
        if ($probeReady) {
          try {
            $track = [EvaMedia.NetEase]::FindTrack($processIds)
            if ($track -ne $lastTrack) { $lastTrack = $track; $lastPeak = 0L }
            if ($track) {
              if ($track.EndsWith($netEaseSuffix)) { $track = $track.Substring(0, $track.Length - $netEaseSuffix.Length) }
              $parts = $track -split ' - ', 2
              $now = $sampleClock.ElapsedMilliseconds
              if ([EvaMedia.NetEase]::HasAudio($processIds)) { $lastPeak = $now }
              $rows += [ordered]@{
                aumid = $netEaseId; source = 'netease'; status = $(if ($lastPeak -gt 0 -and $now - $lastPeak -lt 1600) { 'Playing' } else { 'Paused' })
                title = (Limit-Text $parts[0]); artist = (Limit-Text $parts[1]); album = ''; duration = 0; position = 0
              }
            }
          } catch { }
        }
      }
    }
    $line = @{ ok = $true; sources = @($rows) } | ConvertTo-Json -Compress -Depth 4
  } catch { $manager = $null }
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 900
}
