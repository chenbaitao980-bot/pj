#requires -Version 5.1
<#
  Verify that a DeepSeek Harness frozen tree carries every local customization.

  Use it on the payload before building, and on an installed tree after
  installing, to tell "the patch is missing" apart from "the feature is buggy".

  Checks:
    * the three version stamps agree;
    * each frozen patch marker is present in its client bundle;
    * every local plugin is registered in the profile and its files exist.

  usage:
    powershell -ExecutionPolicy Bypass -File scripts\verify-install.ps1
    powershell -ExecutionPolicy Bypass -File scripts\verify-install.ps1 -Tree D:\dsh-freeze-new\payload
    powershell -ExecutionPolicy Bypass -File scripts\verify-install.ps1 -Tree "C:\Users\Administrator\AppData\Local\Programs\DeepSeekHarnessFrozen"
#>
[CmdletBinding()]
param(
    [string]$Tree = 'D:\dsh-freeze-new\payload'
)

$ErrorActionPreference = 'Stop'
$fail = 0
$pass = 0

function Check([string]$label, [bool]$ok, [string]$detail = '') {
    if ($ok) {
        $script:pass++
        Write-Host ("PASS  {0}" -f $label) -ForegroundColor Green
    }
    else {
        $script:fail++
        Write-Host ("FAIL  {0}{1}" -f $label, $(if ($detail) { " -- $detail" } else { '' })) -ForegroundColor Red
    }
}

function ReadJson([string]$path) {
    if (-not (Test-Path $path)) { return $null }
    try { return (Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function HasMarker([string]$path, [string]$marker) {
    if (-not (Test-Path $path)) { return $false }
    return [bool](Select-String -Path $path -Pattern ([regex]::Escape($marker)) -Quiet)
}

$appRoot = Join-Path $Tree 'resources\app'
$dshRoot = Join-Path $appRoot 'dsh'
$pkgRoot = Join-Path $dshRoot 'node_modules\@deepseek-ai'

Write-Host ("tree  {0}" -f $Tree) -ForegroundColor Cyan

# ---------------------------------------------------------------- version stamps
$appPkg = ReadJson (Join-Path $appRoot 'package.json')
$dshPkg = ReadJson (Join-Path $dshRoot 'package.json')
$manifest = ReadJson (Join-Path $Tree 'FROZEN-BUILD.json')

Check 'app package.json readable' ($null -ne $appPkg)
Check 'dsh runtime package.json readable' ($null -ne $dshPkg)
Check 'FROZEN-BUILD.json readable' ($null -ne $manifest)

if ($appPkg -and $dshPkg -and $manifest) {
    $versions = @($appPkg.version, $dshPkg.version, $manifest.version) | Select-Object -Unique
    Check 'version stamps agree' ($versions.Count -eq 1) ($versions -join ' / ')
    Write-Host ("      version {0}" -f $appPkg.version)
}

# ------------------------------------------------------------------ frozen patches
$conversation = Join-Path $pkgRoot 'dsh-client-ui-conversation\lib\client.js'
$workspace = Join-Path $pkgRoot 'dsh-client-ui-workspace\lib\client.js'

Check 'bundle dsh-client-ui-conversation present' (Test-Path $conversation)
Check 'bundle dsh-client-ui-workspace present' (Test-Path $workspace)

Check 'patch: no-workspace (conversation)' (HasMarker $conversation 'dsh:no-workspace-conversation')
Check 'patch: no-workspace (picker)' (HasMarker $workspace 'dsh:no-workspace-picker')
Check 'patch: side-session shortcut' (HasMarker $workspace 'dsh:side-session')

# ---------------------------------------------------------------------- plugins
$profileDirs = @(
    (Join-Path $Tree 'dsh-home\profiles\desktop'),
    (Join-Path $Tree 'profiles\desktop')
)
$profileDir = $profileDirs | Where-Object { Test-Path (Join-Path $_ 'package.json') } | Select-Object -First 1

if (-not $profileDir) {
    # Installed trees keep the profile under %USERPROFILE%\.dsh.
    $home = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
    if (Test-Path (Join-Path $home 'package.json')) { $profileDir = $home }
}

Check 'profile package.json found' ($null -ne $profileDir) 'looked in dsh-home, profiles, and %USERPROFILE%\.dsh'

if ($profileDir) {
    $profile = ReadJson (Join-Path $profileDir 'package.json')
    $bundles = @($profile.dsh.profile.bundles)
    foreach ($plugin in @('@local/dsh-toolcall-tone', '@local/dsh-multi-workspace', 'dsh-mobile')) {
        $registered = $bundles -contains $plugin
        Check ("plugin registered: {0}" -f $plugin) $registered
        $moduleDir = Join-Path $profileDir ('node_modules\' + ($plugin -replace '/', '\'))
        $entry = if ($plugin -like '*toolcall*') { 'client.js' } elseif ($plugin -eq 'dsh-mobile') { 'lib\index.mjs' } else { 'index.js' }
        Check ("plugin files: {0}" -f $plugin) (Test-Path (Join-Path $moduleDir $entry)) $moduleDir
    }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
