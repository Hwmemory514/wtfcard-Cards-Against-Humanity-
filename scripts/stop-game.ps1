[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDir = Join-Path $projectRoot '.runtime'
$serverPath = Join-Path $projectRoot 'server.js'
$tunnelPath = Join-Path $projectRoot 'cloudflared.exe'
$serverPidFile = Join-Path $runtimeDir 'server.pid'
$tunnelPidFile = Join-Path $runtimeDir 'tunnel.pid'
$publicUrlFile = Join-Path $projectRoot 'public-url.txt'

function Test-OwnedProcess {
  param($ProcessInfo, [string]$ExpectedName, [string]$CommandFragment)
  return $ProcessInfo -and
    $ProcessInfo.Name -eq $ExpectedName -and
    $ProcessInfo.CommandLine -and
    $ProcessInfo.CommandLine.IndexOf($CommandFragment, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Stop-FromPidFile {
  param([string]$PidFile, [string]$ExpectedName, [string]$CommandFragment)
  if (-not (Test-Path -LiteralPath $PidFile)) { return $false }
  $savedPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($savedPid -notmatch '^\d+$') { return $false }
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid" -ErrorAction SilentlyContinue
  if (-not (Test-OwnedProcess $processInfo $ExpectedName $CommandFragment)) { return $false }
  Stop-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
  return $true
}

function Stop-MatchingProcesses {
  param([string]$ExpectedName, [string]$CommandFragment)
  $matches = Get-CimInstance Win32_Process |
    Where-Object { Test-OwnedProcess $_ $ExpectedName $CommandFragment }
  foreach ($match in $matches) {
    Stop-Process -Id $match.ProcessId -ErrorAction SilentlyContinue
  }
  return @($matches).Count
}

$tunnelStopped = Stop-FromPidFile -PidFile $tunnelPidFile -ExpectedName 'cloudflared.exe' -CommandFragment $tunnelPath
if (-not $tunnelStopped) {
  $tunnelStopped = (Stop-MatchingProcesses -ExpectedName 'cloudflared.exe' -CommandFragment $tunnelPath) -gt 0
}

$serverStopped = Stop-FromPidFile -PidFile $serverPidFile -ExpectedName 'node.exe' -CommandFragment $serverPath
if (-not $serverStopped) {
  $serverStopped = (Stop-MatchingProcesses -ExpectedName 'node.exe' -CommandFragment $serverPath) -gt 0
}

Remove-Item -LiteralPath $serverPidFile, $tunnelPidFile, $publicUrlFile -Force -ErrorAction SilentlyContinue

Write-Host ''
if ($tunnelStopped -or $serverStopped) {
  Write-Host 'WTF Card and its temporary public tunnel were stopped.' -ForegroundColor Green
} else {
  Write-Host 'No running WTF Card service was found.' -ForegroundColor Yellow
}
