[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDir = Join-Path $projectRoot '.runtime'
$toolsDir = Join-Path $runtimeDir 'tools'
$downloadsDir = Join-Path $runtimeDir 'downloads'
$packagePath = Join-Path $projectRoot 'package.json'
$lockPath = Join-Path $projectRoot 'package-lock.json'
$cloudflaredPath = Join-Path $projectRoot 'cloudflared.exe'

$nodeVersion = '24.18.0'
$nodeFolderName = "node-v$nodeVersion-win-x64"
$nodeToolDir = Join-Path $toolsDir $nodeFolderName
$localNodePath = Join-Path $nodeToolDir 'node.exe'
$nodeArchiveUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeFolderName.zip"
$nodeArchiveHash = '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'

$cloudflaredVersion = '2026.7.3'
$cloudflaredUrl = "https://github.com/cloudflare/cloudflared/releases/download/$cloudflaredVersion/cloudflared-windows-amd64.exe"
$cloudflaredHash = '8635da433b6df8194746e88ed9d2589566c20e38bfc2a80e431a348b7c765841'

function Get-CompatibleSystemNode {
  try {
    $command = Get-Command node.exe -ErrorAction Stop
    $versionText = (& $command.Source --version 2>$null | Select-Object -First 1)
    if ($versionText -match '^v(?<major>\d+)\.') {
      if ([int]$Matches.major -ge 20) { return $command.Source }
    }
  } catch { }
  return $null
}

function Test-FileHash {
  param([string]$Path, [string]$ExpectedHash)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  return $actualHash.Equals($ExpectedHash, [StringComparison]::OrdinalIgnoreCase)
}

function Download-VerifiedFile {
  param(
    [string]$Url,
    [string]$Destination,
    [string]$ExpectedHash,
    [string]$DisplayName
  )

  Write-Host "Downloading $DisplayName ..." -ForegroundColor Cyan
  Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
  if (-not (Test-FileHash -Path $Destination -ExpectedHash $ExpectedHash)) {
    Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    throw "$DisplayName failed the SHA-256 integrity check."
  }
  Write-Host "$DisplayName download verified." -ForegroundColor Green
}

try {
  Write-Host ''
  Write-Host 'WTF Card first-time setup' -ForegroundColor Cyan
  Write-Host 'This may take several minutes on the first run.'
  Write-Host ''

  if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'This setup script currently supports only 64-bit Windows.'
  }
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf) -or
      -not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
    throw 'package.json or package-lock.json is missing.'
  }

  New-Item -ItemType Directory -Path $toolsDir, $downloadsDir -Force | Out-Null
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $nodePath = $null
  if (Test-Path -LiteralPath $localNodePath -PathType Leaf) {
    $nodePath = $localNodePath
    Write-Host "Portable Node.js is ready: $(& $nodePath --version)" -ForegroundColor Green
  } else {
    $nodePath = Get-CompatibleSystemNode
    if ($nodePath) {
      Write-Host "Compatible system Node.js found: $(& $nodePath --version)" -ForegroundColor Green
    } else {
      $nodeArchivePath = Join-Path $downloadsDir "$nodeFolderName.zip"
      Download-VerifiedFile `
        -Url $nodeArchiveUrl `
        -Destination $nodeArchivePath `
        -ExpectedHash $nodeArchiveHash `
        -DisplayName "Node.js $nodeVersion"

      if (Test-Path -LiteralPath $nodeToolDir) {
        $resolvedToolDir = [System.IO.Path]::GetFullPath($nodeToolDir)
        $resolvedToolsRoot = [System.IO.Path]::GetFullPath($toolsDir) + [System.IO.Path]::DirectorySeparatorChar
        if (-not $resolvedToolDir.StartsWith($resolvedToolsRoot, [StringComparison]::OrdinalIgnoreCase)) {
          throw 'Refusing to replace a tool directory outside .runtime.'
        }
        Remove-Item -LiteralPath $resolvedToolDir -Recurse -Force
      }

      Write-Host 'Extracting portable Node.js ...' -ForegroundColor Cyan
      Expand-Archive -LiteralPath $nodeArchivePath -DestinationPath $toolsDir -Force
      Remove-Item -LiteralPath $nodeArchivePath -Force -ErrorAction SilentlyContinue
      if (-not (Test-Path -LiteralPath $localNodePath -PathType Leaf)) {
        throw 'Portable Node.js was extracted, but node.exe was not found.'
      }
      $nodePath = $localNodePath
      Write-Host "Portable Node.js is ready: $(& $nodePath --version)" -ForegroundColor Green
    }
  }

  if (Test-Path -LiteralPath $cloudflaredPath -PathType Leaf) {
    if (-not (Test-FileHash -Path $cloudflaredPath -ExpectedHash $cloudflaredHash)) {
      throw 'The existing cloudflared.exe does not match the version expected by this project. Remove it and run setup again.'
    }
    Write-Host 'cloudflared.exe is ready and verified.' -ForegroundColor Green
  } else {
    $cloudflaredDownload = Join-Path $downloadsDir 'cloudflared.exe.download'
    Download-VerifiedFile `
      -Url $cloudflaredUrl `
      -Destination $cloudflaredDownload `
      -ExpectedHash $cloudflaredHash `
      -DisplayName "cloudflared $cloudflaredVersion"
    Move-Item -LiteralPath $cloudflaredDownload -Destination $cloudflaredPath -Force
  }

  $nodeDirectory = Split-Path -Parent $nodePath
  $npmPath = Join-Path $nodeDirectory 'npm.cmd'
  if (-not (Test-Path -LiteralPath $npmPath -PathType Leaf)) {
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCommand) { $npmPath = $npmCommand.Source }
  }
  if (-not (Test-Path -LiteralPath $npmPath -PathType Leaf)) {
    throw 'npm.cmd was not found next to Node.js.'
  }

  Write-Host 'Installing game dependencies from package-lock.json ...' -ForegroundColor Cyan
  $oldPath = $env:PATH
  $env:PATH = "$nodeDirectory;$env:PATH"
  Push-Location $projectRoot
  try {
    & $npmPath ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      throw "npm ci failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
    $env:PATH = $oldPath
  }

  foreach ($requiredPackage in @('express', 'socket.io', 'lucide')) {
    $requiredPath = Join-Path $projectRoot "node_modules\$requiredPackage\package.json"
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
      throw "Required package was not installed: $requiredPackage"
    }
  }

  Write-Host ''
  Write-Host 'First-time setup completed successfully.' -ForegroundColor Green
  Write-Host 'You can now close this window and open the normal game launcher.'
} catch {
  Write-Host ''
  Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Check the internet connection and run this setup script again.' -ForegroundColor Yellow
  exit 1
}
