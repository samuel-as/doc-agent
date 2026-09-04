# bootstrap.ps1 — ensures the official portable Node in the doc-agent data home
# (%LOCALAPPDATA%\doc-agent\runtime, overridable via DOC_AGENT_HOME). Shared by every
# project on the machine. Idempotent: does nothing when a usable runtime is present.
# No admin, no PATH changes, no registry.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$NodeVersion = 'v24.19.0'   # version downloaded when no usable Node exists
$MinNodeMajor = 22          # the bundle targets node22; anything >= this works
$DataHome = if ($env:DOC_AGENT_HOME) { $env:DOC_AGENT_HOME } else { Join-Path $env:LOCALAPPDATA 'doc-agent' }
$RuntimeDir = Join-Path $DataHome 'runtime'
$NodeExe = Join-Path $RuntimeDir 'node.exe'

function Get-NodeMajor([string]$exe) {
  try {
    $v = (& $exe --version).Trim()
    if ($v -match '^v(\d+)\.') { return [int]$Matches[1] }
  } catch {}
  return 0
}

if (Test-Path $NodeExe) {
  $major = Get-NodeMajor $NodeExe
  if ($major -ge $MinNodeMajor) {
    Write-Output "runtime ok ($((& $NodeExe --version).Trim())) at $NodeExe"
    exit 0
  }
  Write-Output "runtime unusable (needs v$MinNodeMajor+); reinstalling..."
  Remove-Item -Recurse -Force $RuntimeDir
}

# Prefer a Node already installed on the machine: copy its node.exe into runtime\
# (node.exe is self-contained) so every other command keeps using runtime\node.exe.
$systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
if ($systemNode) {
  $major = Get-NodeMajor $systemNode.Source
  if ($major -ge $MinNodeMajor) {
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    Copy-Item $systemNode.Source $NodeExe
    Write-Output "runtime ready ($((& $NodeExe --version).Trim()), reused from $($systemNode.Source))"
    exit 0
  }
  Write-Output "system Node found but too old (v$major < v$MinNodeMajor); downloading the portable one..."
}

$zipBase = "node-$NodeVersion-win-x64"
$url = "https://nodejs.org/dist/$NodeVersion/$zipBase.zip"
$tmpZip = Join-Path $env:TEMP "$zipBase.zip"
$tmpExtract = Join-Path $env:TEMP "$zipBase-extract"

Write-Output "Downloading the official portable Node: $url"
try {
  Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing
} catch {
  Write-Output 'DOWNLOAD FAILED (network/proxy).'
  Write-Output "Manual plan B (1 step): download $url and extract the CONTENTS of the $zipBase folder to: $RuntimeDir"
  exit 1
}

if (Test-Path $tmpExtract) { Remove-Item -Recurse -Force $tmpExtract }
# Extract with .NET (faster than Expand-Archive and it does not hide the real error) and
# retry on a transient antivirus lock over the freshly created files.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$maxAttempts = 3
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  try {
    [System.IO.Compression.ZipFile]::ExtractToDirectory($tmpZip, $tmpExtract)
    break
  } catch {
    if (Test-Path $tmpExtract) { try { Remove-Item -Recurse -Force $tmpExtract -ErrorAction Stop } catch {} }
    if ($attempt -eq $maxAttempts) {
      Write-Output "FAILED to extract the zip after $maxAttempts attempts: $($_.Exception.Message)"
      Write-Output "Manual plan B (1 step): extract $tmpZip (the CONTENTS of the $zipBase folder) to: $RuntimeDir"
      exit 1
    }
    Write-Output "extraction failed (attempt $attempt/$maxAttempts; antivirus?); trying again..."
    Start-Sleep -Seconds 2
  }
}
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
Move-Item -Path (Join-Path $tmpExtract "$zipBase\*") -Destination $RuntimeDir
Remove-Item -Force $tmpZip
Remove-Item -Recurse -Force $tmpExtract

$installed = (& $NodeExe --version).Trim()
if ($installed -ne $NodeVersion) {
  Write-Output "ERROR: installed version ($installed) differs from the pinned one ($NodeVersion)"
  exit 1
}
Write-Output "runtime ready ($installed) at $NodeExe"
