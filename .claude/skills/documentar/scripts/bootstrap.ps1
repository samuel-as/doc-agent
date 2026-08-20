# .claude/skills/documentar/scripts/bootstrap.ps1
# Garante o Node portátil oficial em <repo>\runtime\node.exe (versão pinada).
# Idempotente: com o runtime correto presente, não faz nada. Sem admin, sem PATH, sem registro.
$ErrorActionPreference = 'Stop'

$NodeVersion = 'v24.19.0'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$RuntimeDir = Join-Path $RepoRoot 'runtime'
$NodeExe = Join-Path $RuntimeDir 'node.exe'

if (Test-Path $NodeExe) {
  $current = (& $NodeExe --version).Trim()
  if ($current -eq $NodeVersion) {
    Write-Output "runtime ok ($current)"
    exit 0
  }
  Write-Output "runtime desatualizado ($current -> $NodeVersion); reinstalando..."
  Remove-Item -Recurse -Force $RuntimeDir
}

$zipBase = "node-$NodeVersion-win-x64"
$url = "https://nodejs.org/dist/$NodeVersion/$zipBase.zip"
$tmpZip = Join-Path $env:TEMP "$zipBase.zip"
$tmpExtract = Join-Path $env:TEMP "$zipBase-extract"

Write-Output "Baixando o Node portátil oficial: $url"
try {
  Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing
} catch {
  Write-Output 'FALHA no download (rede/proxy).'
  Write-Output "Plano B manual (1 passo): baixe $url e extraia o CONTEUDO da pasta $zipBase para: $RuntimeDir"
  exit 1
}

if (Test-Path $tmpExtract) { Remove-Item -Recurse -Force $tmpExtract }
Expand-Archive -Path $tmpZip -DestinationPath $tmpExtract
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
Move-Item -Path (Join-Path $tmpExtract "$zipBase\*") -Destination $RuntimeDir
Remove-Item -Force $tmpZip
Remove-Item -Recurse -Force $tmpExtract

$installed = (& $NodeExe --version).Trim()
if ($installed -ne $NodeVersion) {
  Write-Output "ERRO: versao instalada ($installed) difere da pinada ($NodeVersion)"
  exit 1
}
Write-Output "runtime pronto ($installed)"
