[CmdletBinding()]
param(
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDir = Join-Path $projectRoot '.runtime'
$serverPath = Join-Path $projectRoot 'server.js'
$tunnelPath = Join-Path $projectRoot 'cloudflared.exe'
$serverPidFile = Join-Path $runtimeDir 'server.pid'
$tunnelPidFile = Join-Path $runtimeDir 'tunnel.pid'
$serverOutLog = Join-Path $runtimeDir 'server-output.log'
$serverErrorLog = Join-Path $runtimeDir 'server-error.log'
$tunnelOutLog = Join-Path $runtimeDir 'tunnel-output.log'
$tunnelErrorLog = Join-Path $runtimeDir 'tunnel-error.log'
$tunnelLog = Join-Path $runtimeDir 'tunnel.log'
$launcherLog = Join-Path $runtimeDir 'launcher.log'
$publicUrlFile = Join-Path $projectRoot 'public-url.txt'
$serverStartedHere = $false
$tunnelStartedHere = $false
$serverPid = $null
$tunnelPid = $null

function Find-ProcessByCommand {
  param([string]$ProcessName, [string]$CommandFragment)
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -eq $ProcessName -and
      $_.CommandLine -and
      $_.CommandLine.IndexOf($CommandFragment, [StringComparison]::OrdinalIgnoreCase) -ge 0
    } |
    Select-Object -First 1
}

function Wait-ForLocalServer {
  param([string]$Url, [int]$Attempts = 30)
  for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
    try {
      $health = Invoke-RestMethod -Uri $Url -TimeoutSec 2
      if ($health.ok) { return $true }
    } catch {
      Start-Sleep -Milliseconds 400
    }
  }
  return $false
}

function Find-TunnelUrl {
  $logFiles = @($tunnelLog, $tunnelOutLog, $tunnelErrorLog)
  foreach ($logFile in $logFiles) {
    if (-not (Test-Path -LiteralPath $logFile)) { continue }
    $content = Get-Content -LiteralPath $logFile -Raw -ErrorAction SilentlyContinue
    $match = [regex]::Match($content, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($match.Success) { return $match.Value }
  }
  return $null
}

function Write-LauncherLog {
  param([string]$Message)
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
  Add-Content -LiteralPath $launcherLog -Value "$timestamp $Message" -Encoding UTF8
}

try {
  if (-not (Test-Path -LiteralPath $serverPath)) {
    throw "server.js was not found: $serverPath"
  }
  if (-not (Test-Path -LiteralPath $tunnelPath)) {
    throw "cloudflared.exe was not found: $tunnelPath"
  }

  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  Set-Content -LiteralPath $launcherLog -Value '' -Encoding UTF8
  Write-LauncherLog 'Launcher started.'

  $existingServer = Find-ProcessByCommand -ProcessName 'node.exe' -CommandFragment $serverPath
  if ($existingServer) {
    $serverPid = [int]$existingServer.ProcessId
    Write-Host "Game server is already running. PID: $serverPid" -ForegroundColor DarkGray
  } else {
    $portOwner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($portOwner) {
      throw "Port $Port is already in use by another program."
    }

    $nodeCommand = Get-Command node -ErrorAction Stop
    $serverCommandLine = '"' + $nodeCommand.Source + '" "' + $serverPath + '"'
    $createdServer = Invoke-CimMethod `
      -ClassName Win32_Process `
      -MethodName Create `
      -Arguments @{ CommandLine = $serverCommandLine; CurrentDirectory = $projectRoot }
    if ($createdServer.ReturnValue -ne 0) {
      throw "Windows could not create the game server process. Return code: $($createdServer.ReturnValue)"
    }
    $serverPid = [int]$createdServer.ProcessId
    $serverStartedHere = $true
    Write-LauncherLog "Created game server process $serverPid."
  }
  Set-Content -LiteralPath $serverPidFile -Value $serverPid -Encoding ASCII

  Write-LauncherLog 'Waiting for local health check.'
  if (-not (Wait-ForLocalServer -Url "http://127.0.0.1:$Port/health")) {
    $serverError = if (Test-Path $serverErrorLog) {
      Get-Content -LiteralPath $serverErrorLog -Raw -ErrorAction SilentlyContinue
    } else { '' }
    throw "The game server failed to start. $serverError"
  }
  Write-LauncherLog 'Local health check passed.'

  Write-LauncherLog 'Looking for an existing project tunnel.'
  $existingTunnel = Find-ProcessByCommand -ProcessName 'cloudflared.exe' -CommandFragment $tunnelPath
  $publicUrl = if ($existingTunnel) { Find-TunnelUrl } else { $null }

  if (-not $existingTunnel -or -not $publicUrl) {
    if ($existingTunnel) {
      Stop-Process -Id $existingTunnel.ProcessId -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
    }
    foreach ($logFile in @($tunnelLog, $tunnelOutLog, $tunnelErrorLog)) {
      Remove-Item -LiteralPath $logFile -Force -ErrorAction SilentlyContinue
    }

    $tunnelCommandLine = '"' + $tunnelPath + '" tunnel --url "http://127.0.0.1:' + $Port +
      '" --no-autoupdate --logfile "' + $tunnelLog + '" --loglevel info'
    $createdTunnel = Invoke-CimMethod `
      -ClassName Win32_Process `
      -MethodName Create `
      -Arguments @{ CommandLine = $tunnelCommandLine; CurrentDirectory = $projectRoot }
    if ($createdTunnel.ReturnValue -ne 0) {
      throw "Windows could not create the tunnel process. Return code: $($createdTunnel.ReturnValue)"
    }
    $tunnelPid = [int]$createdTunnel.ProcessId
    $tunnelStartedHere = $true
    Write-LauncherLog "Created tunnel process $tunnelPid."

    for ($attempt = 0; $attempt -lt 60 -and -not $publicUrl; $attempt += 1) {
      if (-not (Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue)) {
        $errorText = if (Test-Path $tunnelErrorLog) {
          Get-Content -LiteralPath $tunnelErrorLog -Raw -ErrorAction SilentlyContinue
        } else { '' }
        throw "The public tunnel failed to start. $errorText"
      }
      Start-Sleep -Milliseconds 500
      $publicUrl = Find-TunnelUrl
    }
    if (-not $publicUrl) { throw 'Timed out while waiting for the temporary public URL.' }
    Write-LauncherLog "Received public URL $publicUrl."
  } else {
    $tunnelPid = [int]$existingTunnel.ProcessId
    Write-Host "Public tunnel is already running. PID: $tunnelPid" -ForegroundColor DarkGray
  }

  Set-Content -LiteralPath $tunnelPidFile -Value $tunnelPid -Encoding ASCII
  Set-Content -LiteralPath $publicUrlFile -Value $publicUrl -Encoding UTF8
  Write-LauncherLog 'Saved process IDs and public URL.'

  $publicReady = $false
  for ($attempt = 0; $attempt -lt 20 -and -not $publicReady; $attempt += 1) {
    try {
      $health = Invoke-RestMethod -Uri "$publicUrl/health" -TimeoutSec 3
      $publicReady = [bool]$health.ok
    } catch {
      Start-Sleep -Milliseconds 600
    }
  }

  try { Set-Clipboard -Value $publicUrl } catch { }
  Write-LauncherLog "Public readiness: $publicReady."

  Write-Host ''
  Write-Host 'WTF Card is running.' -ForegroundColor Green
  Write-Host "Local URL:  http://localhost:$Port"
  Write-Host "Public URL: $publicUrl" -ForegroundColor Cyan
  Write-Host "URL file:   $publicUrlFile"
  if ($publicReady) {
    Write-Host 'Public connectivity check: passed' -ForegroundColor Green
  } else {
    Write-Host 'The URL was created, but DNS may need a few more seconds.' -ForegroundColor Yellow
  }
  Write-Host 'The public URL was copied to the clipboard. Run the stop script to shut everything down.'
} catch {
  Write-LauncherLog "Start failed: $($_.Exception.Message)"
  if ($tunnelStartedHere -and $tunnelPid) {
    Stop-Process -Id $tunnelPid -ErrorAction SilentlyContinue
  }
  if ($serverStartedHere -and $serverPid) {
    Stop-Process -Id $serverPid -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $serverPidFile, $tunnelPidFile -Force -ErrorAction SilentlyContinue
  Write-Host ''
  Write-Host "Start failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
