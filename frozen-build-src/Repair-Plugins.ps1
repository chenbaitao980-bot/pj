#requires -Version 5.1
<#
  冻结版插件修复工具
  ------------------------------------------------------------------
  桌面宿主启动时会加载 profile 里登记的所有第三方插件。任何一个插件
  依赖不完整（典型：打包漏掉了 pnpm 提升的传递依赖），宿主就会启动失败，
  并弹「禁用第三方插件后重启」的恢复窗口。

  本脚本做三件事：
    1. 用随包 node 跑 tools/check-plugins.mjs，列出每个插件缺什么；
    2. 默认模式：只把**确实缺依赖**的插件从 profile bundle 列表里摘掉
       （备份 package.json + cordis.patch.yml），其余插件照常加载；
    3. -DisableAll：等价于应用里的「禁用第三方插件」，全部第三方 bundle 摘掉。

  用法：
    powershell -ExecutionPolicy Bypass -File "<安装目录>\Repair-Plugins.ps1"
    powershell -ExecutionPolicy Bypass -File "<安装目录>\Repair-Plugins.ps1" -CheckOnly
    powershell -ExecutionPolicy Bypass -File "<安装目录>\Repair-Plugins.ps1" -DisableAll
    powershell -ExecutionPolicy Bypass -File "<安装目录>\Repair-Plugins.ps1" -Restore
#>
[CmdletBinding()]
param(
    [string]$InstallDir = '',
    [string]$HomeDir = '',
    [switch]$CheckOnly,
    [switch]$DisableAll,
    [switch]$Restore
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Write-Step([string]$Message, [string]$Level = 'INFO') {
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'HH:mm:ss'), $Level, $Message
    switch ($Level) {
        'ERROR' { Write-Host $line -ForegroundColor Red }
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        'OK'    { Write-Host $line -ForegroundColor Green }
        default { Write-Host $line }
    }
}

try {
    if (-not $InstallDir) { $InstallDir = $PSScriptRoot }
    $InstallDir = [IO.Path]::GetFullPath($InstallDir)
    if (-not $HomeDir) {
        if ($env:DSH_HOME) { $HomeDir = $env:DSH_HOME } elseif ($env:DSH_FROZEN_HOME) { $HomeDir = $env:DSH_FROZEN_HOME } else { $HomeDir = Join-Path $env:USERPROFILE '.dsh' }
    }
    $HomeDir = [IO.Path]::GetFullPath($HomeDir)

    $profileDir = Join-Path $HomeDir 'profiles\desktop'
    $manifestPath = Join-Path $profileDir 'package.json'
    $patchPath = Join-Path $profileDir 'cordis.patch.yml'
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "找不到 profile：$manifestPath（先确认 DSH_HOME 是否正确）" }

    # ---------- 找 node：随包优先，PATH 兜底 ----------
    $nodeCandidates = @(
        (Join-Path $InstallDir 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'),
        (Join-Path $HomeDir 'dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe')
    )
    $node = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $node) {
        $cmd = Get-Command node -ErrorAction SilentlyContinue
        if ($cmd) { $node = $cmd.Source }
    }
    if (-not $node) { throw '找不到 node.exe（随包运行时缺失，且 PATH 里也没有 node）' }

    $checker = Join-Path $InstallDir 'tools\check-plugins.mjs'
    if (-not (Test-Path -LiteralPath $checker)) { throw "缺少自检脚本：$checker" }

    Write-Step "安装目录：$InstallDir"
    Write-Step "DSH_HOME：$HomeDir"
    Write-Step "node：$node"

    # ---------- 恢复模式：挑一个最近的备份回滚 ----------
    if ($Restore) {
        $backups = Get-ChildItem $profileDir -Filter 'package.json.bak-repair-*' -File | Sort-Object LastWriteTime -Descending
        if (-not $backups) { throw '没有可恢复的备份（package.json.bak-repair-*）' }
        $pick = $backups[0]
        Copy-Item -LiteralPath $pick.FullName -Destination $manifestPath -Force
        $patchBackup = $pick.FullName -replace 'package\.json', 'cordis.patch.yml'
        if (Test-Path -LiteralPath $patchBackup) { Copy-Item -LiteralPath $patchBackup -Destination $patchPath -Force }
        Write-Step "已从 $($pick.Name) 恢复" 'OK'
        exit 0
    }

    # ---------- 自检 ----------
    $json = & $node $checker $profileDir --json 2>&1 | Out-String
    $report = $null
    try { $report = $json | ConvertFrom-Json } catch { throw "自检输出无法解析：$json" }
    $problems = @($report.problems)
    Write-Step ("插件自检：{0} 个包，{1} 个有问题" -f @($report.packages).Count, $problems.Count) $(if ($problems.Count -eq 0) { 'OK' } else { 'WARN' })
    foreach ($p in $problems) {
        Write-Step ("  - {0} 缺：{1}" -f $p.package, (($p.missing | Select-Object -First 8) -join ', ')) 'WARN'
    }
    if ($CheckOnly) { exit $(if ($problems.Count -eq 0) { 0 } else { 1 }) }

    # ---------- 计算新的 bundle 列表 ----------
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $bundles = @($manifest.dsh.profile.bundles)
    $hostOwned = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app')

    if ($DisableAll) {
        $newBundles = $hostOwned
    } else {
        $broken = @($problems | ForEach-Object { $_.package })
        if ($bundles.Count -eq 0) { throw 'profile 里没有 bundles 列表，无法修复（请改用 -DisableAll 或重装）' }
        $newBundles = @($bundles | Where-Object { $broken -notcontains $_ })
        if ($newBundles.Count -eq $bundles.Count) {
            Write-Step '没有需要摘除的 bundle（缺依赖的包不在 bundle 列表里，或已修复）。' 'OK'
            exit 0
        }
    }

    # ---------- 备份 + 写入 ----------
    $manifestBackup = "$manifestPath.bak-repair-$stamp"
    Copy-Item -LiteralPath $manifestPath -Destination $manifestBackup -Force
    if (Test-Path -LiteralPath $patchPath) { Copy-Item -LiteralPath $patchPath -Destination "$patchPath.bak-repair-$stamp" -Force }

    $manifest.dsh.profile.bundles = $newBundles
    $jsonOut = $manifest | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText($manifestPath, $jsonOut, (New-Object Text.UTF8Encoding($false)))

    Write-Step "已备份：$manifestBackup"
    Write-Step ("新的 bundles（{0} 项）：{1}" -f $newBundles.Count, ($newBundles -join ', ')) 'OK'
    Write-Step '重新启动 DeepSeek Harness 冻结版即可。' 'OK'
    Write-Step "回滚：Repair-Plugins.ps1 -Restore" 'INFO'
    exit 0
}
catch {
    Write-Step ("修复失败：" + $_.Exception.Message) 'ERROR'
    exit 1
}
