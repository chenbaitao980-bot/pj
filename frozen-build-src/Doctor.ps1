#requires -Version 5.1
<#
  冻结版体检工具（只读）
  ------------------------------------------------------------------
  打印：安装目录、DSH_HOME、冻结状态（更新器是否关闭）、版本、
  随包运行时（node / trellis / gitnexus / codegraph / artex / pgsql）、
  插件依赖自检结果、DSH_HOME 目录体积、最近的日志位置。

  用法：
    powershell -ExecutionPolicy Bypass -File "<安装目录>\Doctor.ps1"
    powershell -ExecutionPolicy Bypass -File "<安装目录>\Doctor.ps1" -Json
#>
[CmdletBinding()]
param(
    [string]$InstallDir = '',
    [string]$HomeDir = '',
    [switch]$Json
)

$ErrorActionPreference = 'SilentlyContinue'
if (-not $InstallDir) { $InstallDir = $PSScriptRoot }
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
if (-not $HomeDir) {
    foreach ($candidate in @($env:DSH_HOME, $env:DSH_FROZEN_HOME, (Join-Path $env:USERPROFILE '.dsh'))) {
        if ($candidate) { $HomeDir = [IO.Path]::GetFullPath($candidate); break }
    }
}

$exe = Join-Path $InstallDir 'DeepSeek Harness.exe'
$node = Join-Path $InstallDir 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
$vendor = Join-Path $InstallDir 'vendor'
$profileDir = Join-Path $HomeDir 'profiles\desktop'

function Get-VersionText([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return 'unknown' }
    try { return ([string](Get-Content -LiteralPath $Path -Raw)).Trim() } catch { return 'unknown' }
}

function Get-ApplicationVersion([string]$Root) {
    $appPkg = Join-Path $Root 'resources\app\package.json'
    if (Test-Path -LiteralPath $appPkg) {
        try {
            $pkg = Get-Content -LiteralPath $appPkg -Raw | ConvertFrom-Json
            if ($pkg.version) { return [string]$pkg.version }
        } catch { }
    }
    return (Get-VersionText (Join-Path $Root 'version'))
}

function Get-FileState([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        return [ordered]@{ ok = $true; bytes = $item.Length; path = $Path }
    }
    return [ordered]@{ ok = $false; path = $Path }
}

$report = [ordered]@{
    generatedAt = (Get-Date).ToString('o')
    installDir  = $InstallDir
    dshHome     = $HomeDir
    host        = [ordered]@{
        exe           = (Get-FileState $exe)
        appDir        = (Test-Path -LiteralPath (Join-Path $InstallDir 'resources\app\dsh'))
        appAsar       = (Test-Path -LiteralPath (Join-Path $InstallDir 'resources\app.asar'))
        updateYml     = (Test-Path -LiteralPath (Join-Path $InstallDir 'resources\app-update.yml'))
        versionFile   = (Get-ApplicationVersion $InstallDir)
    }
    runtime     = [ordered]@{
        node   = (Get-FileState $node)
        runtimeJunction = [ordered]@{
            ok     = (Test-Path -LiteralPath (Join-Path $HomeDir 'dsh-runtimes\dsh-primary-runtime'))
            target = (Get-Item -LiteralPath (Join-Path $HomeDir 'dsh-runtimes\dsh-primary-runtime') -Force).Target
        }
    }
    tools       = [ordered]@{
        trellis   = (Get-FileState (Join-Path $vendor 'trellis\bin\trellis.js'))
        gitnexus  = (Get-FileState (Join-Path $vendor 'gitnexus\dist\cli\index.js'))
        codegraph = (Get-FileState (Join-Path $vendor 'codegraph\npm-shim.js'))
        artex     = (Get-FileState (Join-Path $InstallDir 'artex\artex.exe'))
        initdb    = (Get-FileState (Join-Path $vendor 'pgsql\bin\initdb.exe'))
        binShims  = @(Get-ChildItem -LiteralPath (Join-Path $vendor 'bin') -Filter *.cmd -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    }
    profile     = [ordered]@{
        manifest   = (Get-FileState (Join-Path $profileDir 'package.json'))
        patch      = (Get-FileState (Join-Path $profileDir 'cordis.patch.yml'))
        bundles    = @()
        nodeModulesMB = 0
    }
    preflight   = $null
    credentials = [ordered]@{
        file = (Get-FileState (Join-Path $HomeDir '.credentials.yaml'))
    }
}

try {
    $manifest = Get-Content -LiteralPath (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
    $report.profile.bundles = @($manifest.dsh.profile.bundles)
} catch { }

try {
    $sum = (Get-ChildItem -LiteralPath (Join-Path $profileDir 'node_modules') -Recurse -File -Force | Measure-Object Length -Sum).Sum
    $report.profile.nodeModulesMB = [math]::Round($sum / 1MB, 1)
} catch { }

if ((Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath (Join-Path $InstallDir 'tools\check-plugins.mjs'))) {
    try {
        $raw = & $node (Join-Path $InstallDir 'tools\check-plugins.mjs') $profileDir --json 2>&1 | Out-String
        $report.preflight = $raw | ConvertFrom-Json
    } catch { $report.preflight = [ordered]@{ ok = $false; error = $_.Exception.Message } }
}

if ($Json) {
    $report | ConvertTo-Json -Depth 8
    exit 0
}

Write-Host ''
Write-Host '=== DeepSeek Harness 冻结版 · 体检 ===' -ForegroundColor Cyan
Write-Host ("安装目录 : {0}" -f $InstallDir)
Write-Host ("DSH_HOME : {0}" -f $HomeDir)
Write-Host ("宿主版本 : {0}  (app 目录加载)" -f $report.host.versionFile)

Write-Host ''
Write-Host '--- 冻结状态 ---'
$frozenOk = (-not $report.host.updateYml) -and (-not $report.host.appAsar) -and $report.host.appDir
Write-Host ("app-update.yml 已删除 : {0}" -f (-not $report.host.updateYml)) -ForegroundColor $(if ($report.host.updateYml) { 'Red' } else { 'Green' })
Write-Host ("app.asar 已删除       : {0}" -f (-not $report.host.appAsar)) -ForegroundColor $(if ($report.host.appAsar) { 'Yellow' } else { 'Green' })
Write-Host ("resources\app 目录     : {0}" -f $report.host.appDir) -ForegroundColor $(if ($report.host.appDir) { 'Green' } else { 'Red' })

Write-Host ''
Write-Host '--- 随包组件 ---'
foreach ($key in @('trellis', 'gitnexus', 'codegraph', 'artex', 'initdb')) {
    $state = $report.tools[$key]
    Write-Host ("{0,-10} : {1}" -f $key, $(if ($state.ok) { 'OK' } else { "缺失 $($state.path)" })) -ForegroundColor $(if ($state.ok) { 'Green' } else { 'Red' })
}
Write-Host ("vendor\bin : {0}" -f ($report.tools.binShims -join ', '))

Write-Host ''
Write-Host '--- 运行时 ---'
Write-Host ("node      : {0}" -f $(if ($report.runtime.node.ok) { 'OK' } else { '缺失' })) -ForegroundColor $(if ($report.runtime.node.ok) { 'Green' } else { 'Red' })
Write-Host ("runtime junction : {0}" -f $(if ($report.runtime.runtimeJunction.ok) { 'OK' } else { '缺失（宿主要联网自补，离线机需修）' })) -ForegroundColor $(if ($report.runtime.runtimeJunction.ok) { 'Green' } else { 'Red' })

Write-Host ''
Write-Host ('--- profile 插件（{0} 个 bundle，node_modules {1} MB）---' -f @($report.profile.bundles).Count, $report.profile.nodeModulesMB)
if ($report.preflight) {
    if ($report.preflight.ok) {
        Write-Host '依赖自检 : 全部可解析' -ForegroundColor Green
    } else {
        Write-Host '依赖自检 : 有缺失，启动可能失败' -ForegroundColor Red
        foreach ($p in @($report.preflight.problems)) {
            Write-Host ("  - {0} 缺 {1}" -f $p.package, (($p.missing | Select-Object -First 6) -join ', ')) -ForegroundColor Yellow
        }
        Write-Host '  修复：powershell -ExecutionPolicy Bypass -File "' -NoNewline
        Write-Host ((Join-Path $InstallDir 'Repair-Plugins.ps1') + '"') -NoNewline
        Write-Host '  （只摘掉有问题的插件）'
    }
    Write-Host ''
    foreach ($row in @($report.preflight.packages)) {
        if ($row.kind -like '*host-owned*') { continue }
        $mark = if ($row.ok) { 'OK  ' } else { 'FAIL' }
        $color = if ($row.ok) { 'Green' } else { 'Red' }
        Write-Host ("{0} {1,-30} {2}" -f $mark, $row.name, ($row.version)) -ForegroundColor $color
    }
} else {
    Write-Host '依赖自检 : 未执行（缺 tools\check-plugins.mjs 或 node）' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '--- 凭据 / 日志 ---'
Write-Host ("credentials.yaml : {0}" -f $(if ($report.credentials.file.ok) { 'OK' } else { '缺失' }))
Write-Host ("安装日志目录     : {0}" -f $env:TEMP)
Write-Host ''
