#requires -Version 5.1
<#
  DeepSeek Harness 冻结版 · 安装「手机访问」插件（dsh-mobile）
  ------------------------------------------------------------------
  装什么：
    dsh-mobile（saya-ch/dsh-mobile，Apache-2.0）—— 给 DSH 加一条手机通道：
    局域网 / Cloudflare Tunnel / Caddy / 自建 FRP / cpolar / iroh，PWA + Web Push，
    以及移动端布局适配。装进 profile 后与桌面共用同一个实例、同一套插件。

  安全默认值（插件自带）：
    initiallyEnabled: false、listenHost: 127.0.0.1、allowedCidrs: [127.0.0.0/8]、tls.mode: disabled
    —— 装完不会自动对外监听，要去设置里的 Mobile 页自己开。

  前置：
    %USERPROFILE%\.dsh\profiles\desktop 可写；当前没有正在跑的宿主更稳妥
    （改了 profile 会触发热重载，虽不会崩，但建议关掉宿主再装）

  用法：
    powershell -ExecutionPolicy Bypass -File Install-MobilePlugin.ps1            # 只打印计划
    powershell -ExecutionPolicy Bypass -File Install-MobilePlugin.ps1 -Apply     # 真正安装
    powershell -ExecutionPolicy Bypass -File Install-MobilePlugin.ps1 -Apply -Remove
#>
[CmdletBinding()]
param(
    [string]$InstallDir = '',
    [string]$HomeDir = '',
    [string]$Tarball = '',
    [switch]$Apply,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $env:TEMP "dsh-mobile-plugin-$stamp.log"

function Log([string]$m, [string]$level = 'INFO') {
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'HH:mm:ss'), $level, $m
    try { Add-Content -LiteralPath $log -Value $line -Encoding UTF8 } catch { }
    switch ($level) {
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
        if ($env:DSH_HOME) { $HomeDir = $env:DSH_HOME } else { $HomeDir = Join-Path $env:USERPROFILE '.dsh' }
    }
    $HomeDir = [IO.Path]::GetFullPath($HomeDir)
    if (-not $Tarball) { $Tarball = Join-Path (Split-Path $InstallDir -Parent) 'mobile\dsh-mobile-0.8.4.tgz' }
    if (-not (Test-Path -LiteralPath $Tarball)) {
        $parent = Split-Path $InstallDir -Parent
        $alt = Join-Path $parent 'mobile\dsh-mobile-0.8.4.tgz'
        if (Test-Path -LiteralPath $alt) { $Tarball = $alt }
    }

    $node = Join-Path $InstallDir 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
    $cli = Join-Path $InstallDir 'resources\app\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
    $profileDir = Join-Path $HomeDir 'profiles\desktop'
    $manifestPath = Join-Path $profileDir 'package.json'
    foreach ($p in @($node, $cli, $manifestPath)) {
        if (-not (Test-Path -LiteralPath $p)) { throw "缺少：$p" }
    }

    Log "安装目录：$InstallDir"
    Log "DSH_HOME：$HomeDir"
    Log "tarball：$Tarball"

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $bundles = @($manifest.dsh.profile.bundles)
    $has = $bundles -contains 'dsh-mobile'

    if ($Remove) {
        Log '计划：从 profile 移除 dsh-mobile（依赖与 bundle）'
        if (-not $Apply) { Log '未加 -Apply，未执行。'; exit 0 }
        Copy-Item $manifestPath "$manifestPath.bak-mobile-$stamp" -Force
        $manifest.dsh.profile.bundles = @($bundles | Where-Object { $_ -ne 'dsh-mobile' })
        [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
        $pnpmRemove = Join-Path $InstallDir 'resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
        if (Test-Path -LiteralPath $pnpmRemove) {
            Push-Location $profileDir
            try { & $node $pnpmRemove remove dsh-mobile --store-dir "$env:LOCALAPPDATA\pnpm\store\v11" 2>&1 | ForEach-Object { Log "  $_" } } finally { Pop-Location }
        }
        Log '已移除。' 'OK'
        exit 0
    }

    if ($has) { Log 'profile 里已经有 dsh-mobile 的 bundle，跳过安装，只校正 bundle 列表' 'WARN' }
    else {
        $pnpm = Join-Path $InstallDir 'resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
        if (-not (Test-Path -LiteralPath $pnpm)) { throw "缺少随包 pnpm：$pnpm" }
        Log '计划：用随包 pnpm 在 profile 里 add file:<tarball>'
        if (-not $Apply) {
            Log '未加 -Apply，未执行。确认后重跑并加 -Apply。'
            exit 0
        }

        # 1) 规范化 pnpm 元数据：随包 node_modules 是在打包机上装的，storeDir / virtualStoreDir 写死了旧路径
        $nm = Join-Path $profileDir 'node_modules'
        $modulesYaml = Join-Path $nm '.modules.yaml'
        if (Test-Path -LiteralPath $modulesYaml) {
            $m = Get-Content -LiteralPath $modulesYaml -Raw -Encoding UTF8 | ConvertFrom-Json
            $m.storeDir = "$env:LOCALAPPDATA\pnpm\store\v11"
            $m.virtualStoreDir = "$nm\.pnpm"
            [IO.File]::WriteAllText($modulesYaml, ($m | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
            Log '已改写 .modules.yaml 的 storeDir / virtualStoreDir'
        }
        $wsState = Join-Path $nm '.pnpm-workspace-state-v1.json'
        if (Test-Path -LiteralPath $wsState) {
            $w = Get-Content -LiteralPath $wsState -Raw -Encoding UTF8 | ConvertFrom-Json
            $projects = [ordered]@{}
            foreach ($p in $w.projects.PSObject.Properties) { $projects[$profileDir] = $p.Value }
            $w.projects = $projects
            [IO.File]::WriteAllText($wsState, ($w | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
        }

        # 2) pnpm add（显式 store-dir：跨盘时 pnpm 会自动换仓，换仓会和元数据冲突）
        Push-Location $profileDir
        try {
            & $node $pnpm add "file:$Tarball" --store-dir "$env:LOCALAPPDATA\pnpm\store\v11" 2>&1 | ForEach-Object { Log "  $_" }
            $code = $LASTEXITCODE
        } finally {
            Pop-Location
        }
        if (-not (Test-Path -LiteralPath (Join-Path $profileDir 'node_modules\dsh-mobile'))) {
            throw "安装失败（pnpm 退出码 $code），node_modules 里没有 dsh-mobile"
        }
        if ($code -ne 0) { Log "pnpm 退出码 $code（通常是 IGNORED_BUILDS 警告），包已就位" 'WARN' }
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $bundles = @($manifest.dsh.profile.bundles)
    if ($bundles -notcontains 'dsh-mobile') {
        Copy-Item $manifestPath "$manifestPath.bak-mobile-$stamp" -Force
        $manifest.dsh.profile.bundles = $bundles + 'dsh-mobile'
        [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
        Log '已把 dsh-mobile 加入 dsh.profile.bundles' 'OK'
    }

    $checker = Join-Path $InstallDir 'tools\check-plugins.mjs'
    if (Test-Path -LiteralPath $checker) {
        $raw = & $node $checker $profileDir --json 2>&1 | Out-String
        try {
            $r = $raw | ConvertFrom-Json
            Log ("插件依赖自检：{0} 个包，{1} 个有问题" -f @($r.packages).Count, @($r.problems).Count) $(if (@($r.problems).Count -eq 0) { 'OK' } else { 'WARN' })
        } catch { Log '自检输出无法解析' 'WARN' }
    }

    Log '完成。重启宿主后，设置里会出现 Mobile 页；默认不对外监听，需要你手动开启。' 'OK'
    exit 0
}
catch {
    Log ("失败：" + $_.Exception.Message) 'ERROR'
    exit 1
}
