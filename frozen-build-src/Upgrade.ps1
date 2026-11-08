#requires -Version 5.1
<#
  DeepSeek Harness 冻结版 · 原地升级（不打断正在运行的宿主）
  ------------------------------------------------------------------
  用法（在新版安装包解包目录里，或指向它的 payload 目录）：
    powershell -ExecutionPolicy Bypass -File Upgrade.ps1 -SourceDir "D:\dsh-freeze-new\payload"

  行为：
    1. 热更新不受进程占用影响的部分：脚本、tools、dsh-home 模板、快捷方式、配置；
    2. 把新 `resources\app` 放到 `resources\app.next`，新宿主放到 `DeepSeek Harness.exe.next`；
    3. 桌面/开始菜单快捷方式改指向 `Launch.ps1`——下次启动时由它原子替换后拉起宿主；
    4. 合并 DSH_HOME（技能/插件/profile），展开 __FROZEN_* 占位符，跑插件依赖自检；
    5. 全程不 kill 正在运行的实例，当前会话不受影响。

  想立刻生效：关闭宿主后重新双击快捷方式（或运行 Launch.ps1）。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SourceDir,
    [string]$InstallDir = '',
    [string]$HomeDir = '',
    [switch]$ForceVendor,
    [switch]$NoShortcut,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $env:TEMP "dsh-frozen-upgrade-$stamp.log"

function Log([string]$message, [string]$level = 'INFO') {
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'HH:mm:ss'), $level, $message
    try { Add-Content -LiteralPath $log -Value $line -Encoding UTF8 } catch { }
    if (-not $Quiet) {
        switch ($level) {
            'ERROR' { Write-Host $line -ForegroundColor Red }
            'WARN'  { Write-Host $line -ForegroundColor Yellow }
            'OK'    { Write-Host $line -ForegroundColor Green }
            default { Write-Host $line }
        }
    }
}

function Copy-Tree([string]$source, [string]$dest) {
    if (-not (Test-Path -LiteralPath $source)) { return $false }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    & robocopy $source $dest /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy 失败：$source → $dest (exit=$LASTEXITCODE)" }
    return $true
}

function Remove-Tree([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return }
    # 深路径（node_modules 里的超长文件名）用 rmdir，PowerShell 的 Remove-Item 会撞 260 字符限制
    & cmd.exe /c rmdir /s /q "$path" | Out-Null
    if (Test-Path -LiteralPath $path) {
        try { [IO.Directory]::Delete($path, $true) } catch { }
    }
}

function Test-Running([string]$dir) {
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) }).Count
}

try {
    if (-not $InstallDir) { $InstallDir = $PSScriptRoot }
    $InstallDir = [IO.Path]::GetFullPath($InstallDir)
    $SourceDir = [IO.Path]::GetFullPath($SourceDir)
    if (-not $HomeDir) {
        if ($env:DSH_HOME) { $HomeDir = $env:DSH_HOME }
        elseif ($env:DSH_FROZEN_HOME) { $HomeDir = $env:DSH_FROZEN_HOME }
        else { $HomeDir = Join-Path $env:USERPROFILE '.dsh' }
    }
    $HomeDir = [IO.Path]::GetFullPath($HomeDir)

    foreach ($required in @((Join-Path $SourceDir 'resources\app'), (Join-Path $SourceDir 'dsh-home'), (Join-Path $SourceDir 'install.ps1'))) {
        if (-not (Test-Path -LiteralPath $required)) { throw "升级源不完整，缺少：$required" }
    }

    $running = Test-Running $InstallDir
    Log "安装目录：$InstallDir"
    Log "升级源：$SourceDir"
    Log "DSH_HOME：$HomeDir"
    Log ("当前运行实例：{0} 个{1}" -f $running, $(if ($running -gt 0) { '（走 staged 模式，不打断）' } else { '（可直接落盘）' })) 'OK'

    # ---------- 1. 备份配置 ----------
    $backupDir = Join-Path $env:USERPROFILE (".dsh-frozen-upgrade-backup-$stamp")
    foreach ($rel in @('profiles\desktop\package.json', 'profiles\desktop\cordis.patch.yml', '.credentials.yaml', 'prompt-inject.md')) {
        $src = Join-Path $HomeDir $rel
        if (Test-Path -LiteralPath $src) {
            $dst = Join-Path $backupDir $rel
            New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
            Copy-Item -LiteralPath $src -Destination $dst -Force
        }
    }
    if (Test-Path -LiteralPath $backupDir) { Log "旧配置已备份：$backupDir" }

    # ---------- 2. 热更新脚本与文档 ----------
    foreach ($name in @('install.ps1', 'Uninstall.ps1', 'Doctor.ps1', 'Repair-Plugins.ps1', 'Launch.ps1', 'Finalize-Update.ps1', 'Plugin-Scope.ps1', 'README-冻结版.md', 'FROZEN-BUILD.json')) {
        $src = Join-Path $SourceDir $name
        if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $InstallDir $name) -Force }
    }
    [void](Copy-Tree (Join-Path $SourceDir 'tools') (Join-Path $InstallDir 'tools'))
    [void](Copy-Tree (Join-Path $SourceDir 'dsh-home') (Join-Path $InstallDir 'dsh-home'))
    foreach ($name in @('README-冻结版.md', 'FROZEN-BUILD.json')) {
        $src = Join-Path $SourceDir $name
        if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $InstallDir $name) -Force }
    }
    Log '脚本 / tools / dsh-home 模板已更新' 'OK'

    # ---------- 3. 合并 DSH_HOME ----------
    Log '合并 DSH_HOME（插件 / profile / node_modules；skills 与凭据保持本机原样）…'
    $homeTemplate = Join-Path $SourceDir 'dsh-home'
    $excludeDirs = @()
    foreach ($name in @('skills')) {
        $p = Join-Path $homeTemplate $name
        if (Test-Path -LiteralPath $p) { $excludeDirs += $p }
    }
    $robocopyArgs = @($homeTemplate, $HomeDir, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
    if ($excludeDirs.Count -gt 0) { $robocopyArgs += '/XD'; $robocopyArgs += $excludeDirs }
    $robocopyArgs += '/XF'
    $robocopyArgs += @((Join-Path $homeTemplate '.credentials.yaml'), (Join-Path $homeTemplate 'prompt-inject.md'))
    & robocopy @robocopyArgs | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "合并 DSH_HOME 失败，robocopy exit=$LASTEXITCODE" }

    # pnpm 元数据按本机路径重写（随包 node_modules 写死了打包机路径）
    $nmDir = Join-Path $HomeDir 'profiles\desktop\node_modules'
    $modulesYaml = Join-Path $nmDir '.modules.yaml'
    if (Test-Path -LiteralPath $modulesYaml) {
        try {
            $mods = Get-Content -LiteralPath $modulesYaml -Raw -Encoding UTF8 | ConvertFrom-Json
            $mods.storeDir = "$env:LOCALAPPDATA\pnpm\store\v11"
            $mods.virtualStoreDir = "$nmDir\.pnpm"
            [IO.File]::WriteAllText($modulesYaml, ($mods | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
            Log 'pnpm 元数据已按本机路径重写'
        } catch { Log ("pnpm 元数据重写失败：{0}" -f $_.Exception.Message) 'WARN' }
    }
    $wsState = Join-Path $nmDir '.pnpm-workspace-state-v1.json'
    if (Test-Path -LiteralPath $wsState) {
        try {
            $ws = Get-Content -LiteralPath $wsState -Raw -Encoding UTF8 | ConvertFrom-Json
            $projects = [ordered]@{}
            foreach ($p in $ws.projects.PSObject.Properties) { $projects[(Join-Path $HomeDir 'profiles\desktop')] = $p.Value }
            $ws.projects = $projects
            [IO.File]::WriteAllText($wsState, ($ws | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
        } catch { Log 'pnpm workspace 状态重写失败（不影响启动）' 'WARN' }
    }

    $node = Join-Path $InstallDir 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $node)) { $node = Join-Path $SourceDir 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe' }
    $vendorFwd = (Join-Path $InstallDir 'vendor').Replace('\', '/')
    $nodeFwd = $node.Replace('\', '/')
    $artexFwd = (Join-Path $InstallDir 'artex').Replace('\', '/')
    $pgFwd = (Join-Path $InstallDir 'vendor\pgsql\bin').Replace('\', '/')
    $tokens = @{
        '__FROZEN_NODE__'   = $nodeFwd
        '__FROZEN_VENDOR__' = $vendorFwd
        '__FROZEN_INSTALL__' = $InstallDir.Replace('\', '/' )
        '__FROZEN_ARTEX__'  = $artexFwd
        '__FROZEN_PG__'     = $pgFwd
    }
    $expanded = 0
    foreach ($file in @(Get-ChildItem -LiteralPath $HomeDir -Recurse -Filter 'cordis.patch.yml' -File -ErrorAction SilentlyContinue)) {
        $text = [IO.File]::ReadAllText($file.FullName)
        $next = $text
        foreach ($k in $tokens.Keys) { $next = $next.Replace($k, $tokens[$k]) }
        if ($next -ne $text) {
            [IO.File]::WriteAllText($file.FullName, $next, (New-Object Text.UTF8Encoding($false)))
            $expanded += 1
        }
    }
    Log ("配置占位符已展开：{0} 个文件" -f $expanded) 'OK'

    # ---------- 4. 插件依赖自检 ----------
    $checker = Join-Path $InstallDir 'tools\check-plugins.mjs'
    if ((Test-Path -LiteralPath $checker) -and (Test-Path -LiteralPath $node)) {
        $raw = & $node $checker (Join-Path $HomeDir 'profiles\desktop') --json 2>&1 | Out-String
        try {
            $report = $raw | ConvertFrom-Json
            $problems = @($report.problems)
            if ($problems.Count -eq 0) {
                Log ("插件依赖：{0} 个包全部可解析" -f @($report.packages).Count) 'OK'
            } else {
                foreach ($p in $problems) { Log ("  缺少依赖：{0} → {1}" -f $p.package, (($p.missing | Select-Object -First 6) -join ', ')) 'WARN' }
                $manifestPath = Join-Path $HomeDir 'profiles\desktop\package.json'
                $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
                $broken = @($problems | ForEach-Object { $_.package })
                $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles | Where-Object { $broken -notcontains $_ })
                [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
                Log '缺依赖的插件已从 bundle 列表摘掉（可用 Repair-Plugins.ps1 复查）' 'WARN'
            }
            [IO.File]::WriteAllText((Join-Path $InstallDir 'plugins-preflight.json'), ($report | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
        } catch {
            Log ("自检输出无法解析：{0}" -f $_.Exception.Message) 'WARN'
        }
    }

    # ---------- 5. vendor（默认不覆盖：MCP 服务可能正在跑） ----------
    if ($ForceVendor -and $running -eq 0) {
        [void](Copy-Tree (Join-Path $SourceDir 'vendor') (Join-Path $InstallDir 'vendor'))
        [void](Copy-Tree (Join-Path $SourceDir 'artex') (Join-Path $InstallDir 'artex'))
        Log 'vendor / artex 已更新' 'OK'
    } else {
        Log 'vendor / artex 跳过（与上一版一致；需要更新时关掉宿主后加 -ForceVendor 重跑）'
    }

    # ---------- 6. 新 app / 新宿主 ----------
    $newApp = Join-Path $InstallDir 'resources\app.next'
    $newExe = Join-Path $InstallDir 'DeepSeek Harness.exe.next'
    $srcApp = Join-Path $SourceDir 'resources\app'
    $srcExe = Join-Path $SourceDir 'DeepSeek Harness.exe'

    if ($running -gt 0) {
        Remove-Tree $newApp
        Log '把新 resources\app 放到 app.next（下次启动由 Launch.ps1 原子替换）…'
        [void](Copy-Tree $srcApp $newApp)
        if (Test-Path -LiteralPath $srcExe) { Copy-Item -LiteralPath $srcExe -Destination $newExe -Force }
        $pending = [ordered]@{
            stagedAt = (Get-Date).ToString('o')
            appNext  = 'resources\app.next'
            exeNext  = 'DeepSeek Harness.exe.next'
            source   = $SourceDir
            note     = '关闭宿主后重新双击快捷方式（或运行 Launch.ps1）即完成替换'
        }
        [IO.File]::WriteAllText((Join-Path $InstallDir 'pending-update.json'), ($pending | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
        Log '已 stage：resources\app.next + DeepSeek Harness.exe.next' 'OK'

        # 后台守候：宿主无论怎么退出，进程消失后自动完成替换（不主动拉起宿主）
        $finalizer = Join-Path $InstallDir 'Finalize-Update.ps1'
        if (Test-Path -LiteralPath $finalizer) {
            Start-Process -FilePath $env:ComSpec -ArgumentList "/c start `"`" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$finalizer`" -Quiet" -WindowStyle Hidden
            Log '已启动后台守候：宿主退出后自动落盘（Finalize-Update.ps1）' 'OK'

            # 开机/登录兜底：万一宿主是被关机带走的（守候进程来不及跑），下次登录先补替换
            $startup = [Environment]::GetFolderPath('Startup')
            if ($startup) {
                $startupCmd = Join-Path $startup 'DeepSeekHarnessFrozen-Finalize.cmd'
                $body = "@echo off`r`nif exist `"$pending`" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$finalizer`" -Quiet`r`n"
                [IO.File]::WriteAllText($startupCmd, $body, [Text.Encoding]::ASCII)
                Log "已写登录兜底：$startupCmd"
            }
        } else {
            Log '缺少 Finalize-Update.ps1，替换只能靠下次用快捷方式启动时由 Launch.ps1 完成' 'WARN'
        }
    } else {
        $oldApp = Join-Path $InstallDir "resources\app.old-$stamp"
        if (Test-Path -LiteralPath (Join-Path $InstallDir 'resources\app')) { Move-Item -LiteralPath (Join-Path $InstallDir 'resources\app') -Destination $oldApp -Force }
        [void](Copy-Tree $srcApp (Join-Path $InstallDir 'resources\app'))
        if (Test-Path -LiteralPath $srcExe) {
            if (Test-Path -LiteralPath (Join-Path $InstallDir 'DeepSeek Harness.exe')) { Move-Item -LiteralPath (Join-Path $InstallDir 'DeepSeek Harness.exe') -Destination (Join-Path $InstallDir "DeepSeek Harness.exe.old-$stamp") -Force }
            Copy-Item -LiteralPath $srcExe -Destination (Join-Path $InstallDir 'DeepSeek Harness.exe') -Force
        }
        Log 'resources\app 与宿主已直接替换' 'OK'
    }

    # ---------- 7. 快捷方式改指向启动器 ----------
    if (-not $NoShortcut) {
        $launcher = Join-Path $InstallDir 'Launch.ps1'
        if (Test-Path -LiteralPath $launcher) {
            $shell = New-Object -ComObject WScript.Shell
            foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) {
                if (-not $dir) { continue }
                $lnkPath = Join-Path $dir 'DeepSeek Harness 冻结版.lnk'
                $lnk = $shell.CreateShortcut($lnkPath)
                $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
                $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
                $lnk.WorkingDirectory = $InstallDir
                $lnk.IconLocation = "$(Join-Path $InstallDir 'DeepSeek Harness.exe'),0"
                $lnk.Description = 'DeepSeek Harness 冻结版（启动时自动应用待生效更新）'
                $lnk.Save()
                Log "快捷方式：$lnkPath"
            }
        }
    }

    # ---------- 8. 回执 ----------
    $receiptPath = Join-Path $InstallDir 'install-receipt.json'
    $receipt = [ordered]@{
        installedAt = (Get-Date).ToString('o')
        installDir  = $InstallDir
        dshHome     = $HomeDir
        version     = '0.2.2-rc.1'
        frozen      = $true
        mode        = $(if ($running -gt 0) { 'staged (app.next，下次启动生效)' } else { 'in-place' })
        updater     = 'disabled (app-update.yml removed + main.js enabled=false)'
        node        = $node
        plugins     = @('dsh-purge 1.1.90', 'dsh-artex 0.2.0', '@xiaoso/dsh-workflow-lite', 'dsh-tool-websearch 0.1.1', 'dsh-skill-trellis 2.0.0', 'dsh-skill-grill-me', 'dsh-skill-officecli', 'dsh-skill-darwin', 'dsh-mcp-gitnexus 1.0.0', 'dsh-mcp-codegraph 1.0.0')
    }
    [IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))

    Log '升级完成' 'OK'
    if ($running -gt 0) { Log '当前实例继续用旧代码运行；关闭后重新双击快捷方式即切到 0.2.2-rc.1。' 'OK' }
    Log "日志：$log"
    exit 0
}
catch {
    Log ("升级失败：" + $_.Exception.Message) 'ERROR'
    exit 1
}
