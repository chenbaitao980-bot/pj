#requires -Version 5.1
<#
  DeepSeek Harness 冻结版 · 一键重建安装包
  ------------------------------------------------------------------
  前置：
    * 已把上游 Electron 安装包解包到 `-PayloadRoot`（含 resources\app、DeepSeek Harness.exe 等）
    * `-PurgeBase` 指向要打补丁的 `resources\app\dsh\node_modules\@deepseek-ai`
    * 7-Zip 的 7z.exe 与 SFX stub（stub7z.exe / 7za.exe）可用

  做四件事：
    1. 把 skill-packs / profile / tools / 脚本 同步进 payload（幂等）；
    2. 对 payload 的 dsh 运行时跑 dsh-purge 补丁（生成 *.dshpurge.bak），跑冻结补丁；
    3. 7z 打包 payload → payload.7z；
    4. stub + 7za + payload.7z + footer 拼成单文件 Setup.exe，并写 .sha256。

  产出：
    <OutDir>\DeepSeek-Harness-Frozen-Setup-<Version>.exe
    <OutDir>\DeepSeek-Harness-Frozen-Setup-<Version>.exe.sha256

  用法：
    powershell -ExecutionPolicy Bypass -File Build-FrozenSetup.ps1 `
      -PayloadRoot D:\dsh-freeze-new\payload -Version 0.2.2-rc.1 -OutDir E:\claude\project4\pj
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PayloadRoot,
    [string]$Version = '0.2.2-rc.1',
    [string]$OutDir = '',
    [string]$SevenZip = 'C:\Program Files\7-Zip\7z.exe',
    [string]$Stub = 'D:\dsh-freeze-build\stub7z.exe',
    [string]$SevenZa = 'D:\dsh-freeze-build\7za.extracted.exe',
    [string]$SourceRoot = '',
    [switch]$SkipSync,
    [switch]$SkipPurge
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not $SourceRoot) { $SourceRoot = $PSScriptRoot }
if (-not $OutDir) { $OutDir = Split-Path $SourceRoot -Parent }
$PayloadRoot = [IO.Path]::GetFullPath($PayloadRoot)
$OutDir = [IO.Path]::GetFullPath($OutDir)

function Step([string]$message) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $message) -ForegroundColor Cyan }
function ok([string]$message) { Write-Host ("       {0}" -f $message) -ForegroundColor Green }

foreach ($p in @($SevenZip, $Stub, $SevenZa)) {
    if (-not (Test-Path -LiteralPath $p)) { throw "缺少构建工具：$p" }
}

# ---------- 1. 同步源码 ----------
if (-not $SkipSync) {
    Step '同步 skill-packs / profile / tools 到 payload'
    $homeTpl = Join-Path $PayloadRoot 'dsh-home'
    $nm = Join-Path $homeTpl 'profiles\desktop\node_modules'
    $plugins = Join-Path $homeTpl 'plugins'
    $packs = Join-Path $SourceRoot 'skill-packs'
    foreach ($pack in @(Get-ChildItem -LiteralPath $packs -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'dsh-*' })) {
        foreach ($dest in @((Join-Path $plugins $pack.Name), (Join-Path $nm $pack.Name))) {
            New-Item -ItemType Directory -Force -Path $dest | Out-Null
            & robocopy $pack.FullName $dest /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "同步插件失败：$($pack.Name) → $dest" }
        }
        ok "plugin: $($pack.Name)"
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $PayloadRoot 'tools') | Out-Null
    foreach ($tool in @('check-plugins.mjs')) {
        $src = Join-Path $SourceRoot $tool
        if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $PayloadRoot "tools\$tool") -Force }
    }
    foreach ($script in @('install.ps1', 'Uninstall.ps1', 'Doctor.ps1', 'Repair-Plugins.ps1', 'Launch.ps1', 'Finalize-Update.ps1', 'Upgrade.ps1', 'Plugin-Scope.ps1')) {
        $src = Join-Path $SourceRoot $script
        if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $PayloadRoot $script) -Force }
    }
}

# ---------- 2. 补丁 ----------
if (-not $SkipPurge) {
    Step '对 payload 运行时应用 dsh-purge 补丁'
    $node = Join-Path $PayloadRoot 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $node)) { $node = (Get-Command node).Source }
    $aiBase = Join-Path $PayloadRoot 'resources\app\dsh\node_modules\@deepseek-ai'
    $env:DSH_BASE = $aiBase
    $stage = Join-Path $SourceRoot 'purge-stage.mjs'
    if (Test-Path -LiteralPath $stage) {
        & $node $stage
        if ($LASTEXITCODE -ne 0) { throw "dsh-purge 补丁失败（exit=$LASTEXITCODE）" }
    }

    Step '应用冻结补丁（禁用更新器 + 去掉强制更新策略）'
    $freeze = Join-Path $SourceRoot 'freeze-app.js'
    if (Test-Path -LiteralPath $freeze) {
        $env:FROZEN_APP = (Join-Path $PayloadRoot 'resources\app').Replace('\', '/')
        & $node $freeze
        if ($LASTEXITCODE -ne 0) { throw "冻结补丁失败（exit=$LASTEXITCODE）" }
    }
}

# ---------- 3. 7z ----------
Step '打包 payload.7z'
$archive = Join-Path (Split-Path $PayloadRoot -Parent) "payload-$Version.7z"
Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
Push-Location $PayloadRoot
try {
    & $SevenZip a -t7z -mx=7 -mmt=on $archive '*' '-xr!.artex-runtime' -bb0 -bsp0
    if ($LASTEXITCODE -ne 0) { throw "7z 打包失败（exit=$LASTEXITCODE）" }
} finally {
    Pop-Location
}
ok ("archive: {0:N0} bytes" -f (Get-Item $archive).Length)

# ---------- 4. 单文件 exe ----------
Step '拼装单文件 Setup.exe'
$out = Join-Path $OutDir "DeepSeek-Harness-Frozen-Setup-$Version.exe"
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
$exeLen = (Get-Item $Stub).Length
$zaLen = (Get-Item $SevenZa).Length
$arcLen = (Get-Item $archive).Length
# 布局：[stub][7za][payload.7z][40 字节尾标]
# 尾标里的 exeOff/exeLen 指向 7za 段，arcOff 指向 payload 段（stub 本身不计入）。
$exeOff = $exeLen
$arcOff = $exeLen + $zaLen
$fs = [IO.File]::Create($out)
try {
    foreach ($part in @($Stub, $SevenZa, $archive)) {
        $in = [IO.File]::OpenRead($part)
        try { $in.CopyTo($fs, 1048576) } finally { $in.Dispose() }
    }
    $footer = New-Object byte[] 40
    [Array]::Copy([Text.Encoding]::ASCII.GetBytes('DSHFZ7P1'), 0, $footer, 0, 8)
    [Array]::Copy([BitConverter]::GetBytes([int64]$exeOff), 0, $footer, 8, 8)
    [Array]::Copy([BitConverter]::GetBytes([int64]$zaLen), 0, $footer, 16, 8)
    [Array]::Copy([BitConverter]::GetBytes([int64]$arcOff), 0, $footer, 24, 8)
    [Array]::Copy([BitConverter]::GetBytes([int64]$arcLen), 0, $footer, 32, 8)
    $fs.Write($footer, 0, 40)
} finally {
    $fs.Close()
}
$hash = (Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash
Set-Content -LiteralPath "$out.sha256" -Value $hash -Encoding ASCII
ok ("setup: {0} ({1:N0} bytes)" -f $out, (Get-Item $out).Length)
ok "sha256: $hash"
Step '完成'
