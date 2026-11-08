# 把 dsh-artex 插件装进某个 DSH profile
#
#   pwsh -File .\install-artex-plugin.ps1                       # 装进项目内 Web 版（profile web）
#   pwsh -File .\install-artex-plugin.ps1 -Profile art           # 装进别的 profile
#   pwsh -File .\install-artex-plugin.ps1 -Profile desktop `
#        -DshHome C:\Users\<你>\.dsh                             # 装进桌面版（Electron 独占，走手工挂载）
#
# 桌面版 profile 被 Electron 独占，`dsh plugin` 会直接拒绝，所以那里改成
# 「改 package.json + 在 profile 的 node_modules 里建 junction」，效果等价。
# 卸载：Web 版 `dsh plugin --profile <名字> remove dsh-artex`；桌面版把这两处改动删掉。

param(
    [string]$Profile = 'web',
    [string]$DshHome = (Join-Path $PSScriptRoot 'deepseek-harness\.dsh'),
    [string]$PluginPath = (Join-Path $PSScriptRoot 'dsh-artex')
)

$ErrorActionPreference = 'Stop'
$pluginFull = (Resolve-Path $PluginPath).Path
if (-not (Test-Path (Join-Path $pluginFull 'package.json'))) {
    Write-Host "插件目录不完整：$pluginFull" -ForegroundColor Red
    exit 1
}
$posix = $pluginFull -replace '\\', '/'

if ($Profile -eq 'desktop') {
    Write-Host "DSH_HOME = $DshHome" -ForegroundColor Cyan
    $prof = Join-Path $DshHome 'profiles\desktop'
    $pkgPath = Join-Path $prof 'package.json'
    if (-not (Test-Path $pkgPath)) {
        Write-Host "找不到桌面版 profile：$prof" -ForegroundColor Red
        exit 1
    }
    Copy-Item $pkgPath "$pkgPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')" -Force
    $pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $pkg.dependencies) {
        $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{})
    }
    $pkg.dependencies | Add-Member -NotePropertyName 'dsh-artex' -NotePropertyValue "link:$posix" -Force
    $bundles = @($pkg.dsh.profile.bundles)
    if ($bundles -notcontains 'dsh-artex') { $bundles += 'dsh-artex' }
    $pkg.dsh.profile.bundles = $bundles
    $pkg | ConvertTo-Json -Depth 12 | Set-Content $pkgPath -Encoding UTF8

    $nm = Join-Path $prof 'node_modules'
    New-Item -ItemType Directory -Force -Path $nm | Out-Null
    $link = Join-Path $nm 'dsh-artex'
    if (Test-Path $link) { Remove-Item $link -Recurse -Force }
    New-Item -ItemType Junction -Path $link -Target $pluginFull | Out-Null

    Write-Host "已挂载：$link → $pluginFull" -ForegroundColor Green
    Write-Host "bundle 已加入：$pkgPath" -ForegroundColor Green
    Write-Host ""
    Write-Host "桌面版会热加载 profile 配置；没反应就完全退出 DeepSeek Harness 再打开。" -ForegroundColor Yellow
    Write-Host "然后输入框敲 /ar，应出现 /artex"
    exit 0
}

$dsh = Join-Path $PSScriptRoot 'deepseek-harness\node_modules\.bin\dsh.cmd'
if (-not (Test-Path $dsh)) {
    Write-Host "找不到 $dsh。先在 deepseek-harness 里装 dsh。" -ForegroundColor Red
    exit 1
}

$env:DSH_HOME = $DshHome
Write-Host "DSH_HOME = $env:DSH_HOME" -ForegroundColor Cyan
Write-Host "安装 dsh-artex → profile '$Profile'" -ForegroundColor Cyan

& $dsh plugin --profile $Profile add "link:$posix"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "已安装。接下来：" -ForegroundColor Green
Write-Host "  1. 重启该 profile 的 DSH（配置在进程启动时合成）"
Write-Host "  2. 输入框敲 /ar → /artex status | doctor | start | stop | logs | setup"
Write-Host "  3. 没源码/没编译过：/artex setup all，然后 /artex start"
Write-Host ""
Write-Host "也可以不经过 DSH 直接用命令行自测："
Write-Host "  node dsh-artex\bin\artex-dsh.mjs doctor"
