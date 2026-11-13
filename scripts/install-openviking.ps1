#requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$SkipPackages
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $repo 'runtime\openviking'
$venv = Join-Path $runtime 'venv'
$python = Join-Path $venv 'Scripts\python.exe'
$server = Join-Path $venv 'Scripts\openviking-server.exe'
$dshHome = Join-Path $env:USERPROFILE '.dsh'
$profileDir = Join-Path $dshHome 'profiles\desktop'
$pluginsDir = Join-Path $dshHome 'plugins'
$openvikingHome = Join-Path $env:USERPROFILE '.openviking'

function Write-Utf8($Path, $Text) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Copy-Plugin($Name) {
  $src = Join-Path $repo "plugins\$Name"
  if (-not (Test-Path $src)) { throw "plugin not found: $src" }
  $dst = Join-Path $pluginsDir $Name
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
  Write-Host "plugin synced: $dst"
}

New-Item -ItemType Directory -Force -Path $runtime, (Join-Path $runtime 'data'), (Join-Path $runtime 'logs') | Out-Null

if (-not $SkipPackages) {
  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if (-not $uv) { throw 'uv is required: https://docs.astral.sh/uv/' }
  if (-not (Test-Path $python)) {
    & $uv.Source venv $venv --python 3.12
    if ($LASTEXITCODE -ne 0) { throw 'uv venv failed' }
  }
  & $uv.Source pip install --python $python 'openviking==0.5.4.1' 'starlette-context' 'sse-starlette' 'pydantic-settings' 'PyYAML'
  if ($LASTEXITCODE -ne 0) { throw 'uv pip install failed' }
}

if (-not (Test-Path $server)) { throw "openviking-server not found: $server" }

$ovConf = Join-Path $runtime 'ov.conf'
if (-not (Test-Path $ovConf)) {
  throw "missing $ovConf (copy it with the project before running this script)"
}
$runtimeJson = Join-Path $runtime 'runtime.json'
if (-not (Test-Path $runtimeJson)) {
  throw "missing $runtimeJson (copy it with the project before running this script)"
}

Copy-Plugin 'dsh-openviking-bootstrap'
Copy-Plugin 'dsh-openviking-memory'

Write-Utf8 (Join-Path $openvikingHome 'ovcli.conf') '{"url":"http://127.0.0.1:1933"}'
Write-Utf8 (Join-Path $openvikingHome 'dsh-runtime.json') ("{`"root`":`"$($runtime.Replace('\','\\'))`"}")

$profilePackage = Join-Path $profileDir 'package.json'
if (-not (Test-Path $profilePackage)) {
  Write-Warning "profile not found: $profilePackage; start DeepSeek Harness once, then rerun this script."
  exit 0
}

function Sync-ProfilePlugin($Folder, $PackageName) {
  $src = Join-Path $pluginsDir $Folder
  $dst = Join-Path (Join-Path $profileDir 'node_modules') $PackageName
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
  Write-Host "profile plugin synced: $dst"
}

Sync-ProfilePlugin 'dsh-openviking-bootstrap' '@local/dsh-openviking-bootstrap'
Sync-ProfilePlugin 'dsh-openviking-memory' '@openviking/dsh-memory-plugin'

$json = Get-Content $profilePackage -Raw | ConvertFrom-Json
if (-not $json.dependencies) {
  $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
}
$deps = @{
  '@local/dsh-openviking-bootstrap' = 'file:../../plugins/dsh-openviking-bootstrap'
  '@openviking/dsh-memory-plugin' = 'file:../../plugins/dsh-openviking-memory'
}
foreach ($key in $deps.Keys) {
  if ($json.dependencies.PSObject.Properties.Name -contains $key) {
    $json.dependencies.$key = $deps[$key]
  } else {
    $json.dependencies | Add-Member -NotePropertyName $key -NotePropertyValue $deps[$key] -Force
  }
}
if (-not $json.dsh) {
  $json | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) -Force
}
if (-not $json.dsh.profile) {
  $json.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) -Force
}
$bundles = @($json.dsh.profile.bundles)
foreach ($name in @('@local/dsh-openviking-bootstrap', '@openviking/dsh-memory-plugin')) {
  if ($bundles -notcontains $name) { $bundles += $name }
}
$json.dsh.profile.bundles = $bundles
Write-Utf8 $profilePackage ($json | ConvertTo-Json -Depth 30)

Write-Host ''
Write-Host 'OpenViking installed.'
Write-Host "  server:  $server"
Write-Host "  config:  $ovConf"
Write-Host "  data:    $(Join-Path $runtime 'data')"
Write-Host "  profile: $profilePackage"
Write-Host 'Restart DeepSeek Harness to load the bootstrap and memory plugins.'
