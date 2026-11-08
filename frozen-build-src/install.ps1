#requires -Version 5.1
<#
  DeepSeek Harness 冻结版 · 一键安装脚本
  ------------------------------------------------------------------
  由单文件 EXE 释放后自动调用；也可在解包目录里手动运行。
  安装内容：
    * 已解开并预置 dsh-purge 补丁的桌面宿主（禁止官方自更新）
    * 预配置的 DSH_HOME（模型、dsh-purge、dsh-artex、workflow-lite、90 个技能）
    * 内置 GitNexus / CodeGraph MCP 服务与 Trellis CLI
    * profile 的 node_modules 整目录随包，离线机器不需要联网装插件
  安装位置：%LOCALAPPDATA%\Programs\DeepSeekHarnessFrozen（可用 -InstallDir 改）
  DSH_HOME：%USERPROFILE%\.dsh（可用 -HomeDir 改）
#>
[CmdletBinding()]
param(
    [string]$InstallDir = '',
    [string]$HomeDir = '',
    [switch]$NoLaunch,
    [switch]$NoRegister,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop } catch { }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:LogPath = Join-Path $env:TEMP "dsh-frozen-install-$stamp.log"
$script:Version = '0.2.2-rc.1'

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'HH:mm:ss'), $Level, $Message
    try { Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8 } catch { }
    if (-not $Quiet) {
        switch ($Level) {
            'ERROR' { Write-Host $line -ForegroundColor Red }
            'WARN'  { Write-Host $line -ForegroundColor Yellow }
            'OK'    { Write-Host $line -ForegroundColor Green }
            default { Write-Host $line }
        }
    }
}

function Fail([string]$Message) {
    Write-Log $Message 'ERROR'
    throw $Message
}

function Test-ProcessUnder([string]$Root, [string]$ExePath) {
    return ($ExePath -and ($ExePath.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)))
}

try {
    if (-not $InstallDir) { $InstallDir = $PSScriptRoot }
    $InstallDir = [IO.Path]::GetFullPath($InstallDir)
    if (-not $HomeDir) {
        if ($env:DSH_FROZEN_HOME) { $HomeDir = $env:DSH_FROZEN_HOME } else { $HomeDir = Join-Path $env:USERPROFILE '.dsh' }
    }
    $HomeDir = [IO.Path]::GetFullPath($HomeDir)

    # ---------- 0. 从别处运行时先自复制到安装目录 ----------
    if ($InstallDir.TrimEnd('\') -ne $PSScriptRoot.TrimEnd('\')) {
        Write-Log "复制安装文件到 $InstallDir"
        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        & robocopy $PSScriptRoot $InstallDir /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
        if ($LASTEXITCODE -ge 8) { Fail "复制失败，robocopy exit=$LASTEXITCODE" }
        $childArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $InstallDir 'install.ps1'), '-InstallDir', $InstallDir, '-HomeDir', $HomeDir)
        if ($NoRegister) { $childArgs += '-NoRegister' }
        if ($NoLaunch) { $childArgs += '-NoLaunch' }
        if ($Quiet) { $childArgs += '-Quiet' }
        $p = Start-Process powershell.exe -ArgumentList $childArgs -Wait -PassThru
        exit $p.ExitCode
    }

    Write-Log "安装目录：$InstallDir"
    Write-Log "DSH_HOME：$HomeDir"
    Write-Log "版本：$script:Version"

    $exe = Join-Path $InstallDir 'DeepSeek Harness.exe'
    $node = Join-Path $InstallDir 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
    $vendor = Join-Path $InstallDir 'vendor'
    $homeTemplate = Join-Path $InstallDir 'dsh-home'
    $resources = Join-Path $InstallDir 'resources'
    $appDir = Join-Path $resources 'app'
    $profileDir = Join-Path $HomeDir 'profiles\desktop'
    $patchFile = Join-Path $profileDir 'cordis.patch.yml'
    $checker = Join-Path $InstallDir 'tools\check-plugins.mjs'

    $required = @(
        $exe,
        $node,
        $homeTemplate,
        (Join-Path $appDir 'dsh'),
        (Join-Path $vendor 'gitnexus'),
        (Join-Path $vendor 'codegraph'),
        (Join-Path $vendor 'trellis'),
        (Join-Path $InstallDir 'artex\artex.exe'),
        (Join-Path $vendor 'pgsql\bin\initdb.exe')
    )
    foreach ($item in $required) {
        if (-not (Test-Path -LiteralPath $item)) { Fail "安装包不完整，缺少：$item" }
    }
    if (-not (Test-Path -LiteralPath $checker)) { Write-Log '缺少 tools\check-plugins.mjs（跳过插件依赖自检）' 'WARN' }

    # ---------- 1. 停掉本安装目录下正在运行的实例 ----------
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { Test-ProcessUnder $InstallDir $_.ExecutablePath } |
        ForEach-Object {
            Write-Log "结束进程 PID=$($_.ProcessId) $($_.Name)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    Start-Sleep -Milliseconds 500

    # ---------- 2. 冻结：移除官方更新入口 ----------
    foreach ($f in @((Join-Path $resources 'app-update.yml'), (Join-Path $resources 'app.asar'), (Join-Path $resources 'app.asar.unpacked'))) {
        if (Test-Path -LiteralPath $f) {
            Write-Log "冻结：移除 $(Split-Path $f -Leaf)"
            Remove-Item -LiteralPath $f -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    # 上一版升级留下的 staged 目录，装完就没用了
    foreach ($f in @((Join-Path $resources 'app.next'), (Join-Path $resources 'app.old-*'), (Join-Path $InstallDir 'DeepSeek Harness.exe.next'))) {
        Get-Item -Path $f -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Log "清理残留：$($_.Name)"
            Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    $mainJs = Join-Path $appDir 'lib\main.js'
    if ((Test-Path -LiteralPath $mainJs) -and -not (Select-String -LiteralPath $mainJs -SimpleMatch 'enabled = () => false' -Quiet)) {
        Write-Log '冻结：主进程更新器未禁用（非预期构建）' 'WARN'
    }

    # ---------- 3. 备份旧的用户配置 ----------
    New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
    foreach ($n in @('dsh-artex', 'dsh-purge')) {
        $lnk = Join-Path $HomeDir "profiles\desktop\node_modules\$n"
        if (Test-Path -LiteralPath $lnk) {
            $item = Get-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue
            if ($item -and $item.LinkType -eq 'Junction') {
                & cmd.exe /c rmdir "$lnk" | Out-Null
                Write-Log "已移除旧插件 junction：$lnk"
            }
        }
    }
    $backupDir = Join-Path $env:USERPROFILE (".dsh-frozen-backup-$stamp")
    $toBackup = @(
        'profiles\desktop\cordis.patch.yml',
        'profiles\desktop\package.json',
        '.credentials.yaml',
        'prompt-inject.md'
    )
    $madeBackup = $false
    foreach ($rel in $toBackup) {
        $src = Join-Path $HomeDir $rel
        if (Test-Path -LiteralPath $src) {
            $dst = Join-Path $backupDir $rel
            New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
            Copy-Item -LiteralPath $src -Destination $dst -Force
            $madeBackup = $true
        }
    }
    if ($madeBackup) { Write-Log "旧配置已备份到 $backupDir" }

    # ---------- 4. 落 DSH_HOME ----------
    Write-Log '写入 DSH_HOME（技能 / 插件 / profile / node_modules / 凭据）'
    & robocopy $homeTemplate $HomeDir /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "写入 DSH_HOME 失败，robocopy exit=$LASTEXITCODE" }

    # ---------- 4.1 规范化 pnpm 元数据（随包 node_modules 写死了打包机路径，不修会让以后的 pnpm add 直接失败） ----------
    $nmDir = Join-Path $profileDir 'node_modules'
    $modulesYaml = Join-Path $nmDir '.modules.yaml'
    if (Test-Path -LiteralPath $modulesYaml) {
        try {
            $mods = Get-Content -LiteralPath $modulesYaml -Raw -Encoding UTF8 | ConvertFrom-Json
            $mods.storeDir = "$env:LOCALAPPDATA\pnpm\store\v11"
            $mods.virtualStoreDir = "$nmDir\.pnpm"
            [IO.File]::WriteAllText($modulesYaml, ($mods | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
            Write-Log 'pnpm 元数据已按本机路径重写（storeDir / virtualStoreDir）'
        } catch {
            Write-Log ("pnpm 元数据重写失败：{0}" -f $_.Exception.Message) 'WARN'
        }
    }
    $wsState = Join-Path $nmDir '.pnpm-workspace-state-v1.json'
    if (Test-Path -LiteralPath $wsState) {
        try {
            $ws = Get-Content -LiteralPath $wsState -Raw -Encoding UTF8 | ConvertFrom-Json
            $projects = [ordered]@{}
            foreach ($p in $ws.projects.PSObject.Properties) { $projects[$profileDir] = $p.Value }
            $ws.projects = $projects
            [IO.File]::WriteAllText($wsState, ($ws | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
        } catch { Write-Log 'pnpm workspace 状态重写失败（不影响启动）' 'WARN' }
    }

    # ---------- 5. 把内置 Node / MCP 路径写进 profile 与插件 patch ----------
    if (-not (Test-Path -LiteralPath $patchFile)) { Fail "缺少 profile 配置：$patchFile" }
    $nodeFwd = $node.Replace('\', '/')
    $vendorFwd = $vendor.Replace('\', '/')
    $artexDir = (Join-Path $InstallDir 'artex')
    $pgBin = (Join-Path $vendor 'pgsql\bin')
    $tokens = @{
        '__FROZEN_NODE__'   = $nodeFwd
        '__FROZEN_VENDOR__' = $vendorFwd
        '__FROZEN_INSTALL__' = $InstallDir.Replace('\', '/')
        '__FROZEN_ARTEX__'  = $artexDir.Replace('\', '/')
        '__FROZEN_PG__'     = $pgBin.Replace('\', '/')
    }

    $expanded = 0
    $patchFiles = @()
    foreach ($root in @((Join-Path $HomeDir 'plugins'), (Join-Path $HomeDir 'profiles'))) {
        if (Test-Path -LiteralPath $root) {
            $patchFiles += @(Get-ChildItem -LiteralPath $root -Filter 'cordis.patch.yml' -Recurse -File -ErrorAction SilentlyContinue)
        }
    }
    foreach ($pf in $patchFiles) {
        $raw = [IO.File]::ReadAllText($pf.FullName)
        $next = $raw
        foreach ($k in $tokens.Keys) { $next = $next.Replace($k, $tokens[$k]) }
        if ($next -ne $raw) {
            [IO.File]::WriteAllText($pf.FullName, $next, (New-Object Text.UTF8Encoding($false)))
            $expanded += 1
        }
    }
    Write-Log "MCP 运行时：$nodeFwd"
    Write-Log "ARTEX 根目录：$artexDir"
    Write-Log ("配置占位符已展开：{0} 个文件" -f $expanded) 'OK'

    # ---------- 5.1 插件依赖自检（不完整的依赖 = 新机器启动失败） ----------
    $preflightSummary = 'skipped'
    if ((Test-Path -LiteralPath $checker) -and (Test-Path -LiteralPath $node)) {
        Write-Log '插件依赖自检（tools\check-plugins.mjs）'
        $report = $null
        $raw = & $node $checker $profileDir --json 2>&1 | Out-String
        try {
            $report = $raw | ConvertFrom-Json
        } catch {
            $preflightSummary = 'unparsed'
            Write-Log ("插件依赖自检输出无法解析：{0}" -f $_.Exception.Message) 'WARN'
        }

        if ($null -ne $report) {
            $problems = @($report.problems)
            if ($problems.Count -gt 0) {
                # 自愈：profile 的 node_modules 没被完整带过来时，从安装包模板整目录重灌一次
                $srcNm = Join-Path $homeTemplate 'profiles\desktop\node_modules'
                $dstNm = Join-Path $profileDir 'node_modules'
                if (Test-Path -LiteralPath $srcNm) {
                    Write-Log '插件依赖不全 → 从安装包模板重灌 profile\node_modules' 'WARN'
                    New-Item -ItemType Directory -Force -Path $dstNm | Out-Null
                    & robocopy $srcNm $dstNm /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
                    $raw = & $node $checker $profileDir --json 2>&1 | Out-String
                    try {
                        $report = $raw | ConvertFrom-Json
                        $problems = @($report.problems)
                    } catch {
                        Write-Log '重灌后自检输出仍无法解析' 'WARN'
                    }
                }
            }

            if ($problems.Count -eq 0) {
                $preflightSummary = 'ok'
                Write-Log ("插件依赖：{0} 个包全部可解析" -f @($report.packages).Count) 'OK'
            } else {
                $preflightSummary = "trimmed-$($problems.Count)"
                foreach ($p in $problems) {
                    Write-Log ("  缺少依赖：{0} → {1}" -f $p.package, (($p.missing | Select-Object -First 6) -join ', ')) 'WARN'
                }
                # 备份后只摘掉有问题的 bundle，其余插件照常加载；避免用户第一次打开就撞恢复窗口
                $manifestPath = Join-Path $profileDir 'package.json'
                $manifestBackup = "$manifestPath.bak-preflight-$stamp"
                Copy-Item -LiteralPath $manifestPath -Destination $manifestBackup -Force
                $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
                $broken = @($problems | ForEach-Object { $_.package })
                $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles | Where-Object { $broken -notcontains $_ })
                [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
                Write-Log ("已从 bundle 列表摘掉缺依赖的插件（备份：{0}）" -f $manifestBackup) 'WARN'
                Write-Log '先用 Repair-Plugins.ps1 复查，或重跑下一版安装包补齐依赖。' 'WARN'
            }
            [IO.File]::WriteAllText((Join-Path $InstallDir 'plugins-preflight.json'), ($report | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
        }
    }

    # ---------- 6. 运行时目录（用 junction 复用宿主自带 runtime） ----------
    $runtimeSrc = Join-Path $resources 'runtime\primary-runtime'
    $runtimeLink = Join-Path $HomeDir 'dsh-runtimes\dsh-primary-runtime'
    if (Test-Path -LiteralPath $runtimeSrc) {
        $linkOk = $false
        if (Test-Path -LiteralPath $runtimeLink) {
            $linkItem = Get-Item -LiteralPath $runtimeLink -Force
            $linkOk = [bool]($linkItem.LinkType -eq 'Junction') -or (Test-Path -LiteralPath (Join-Path $runtimeLink 'dependencies\node\bin\node.exe'))
            if (-not $linkOk) {
                Write-Log '运行时 junction 失效，重建' 'WARN'
                & cmd.exe /c rmdir "$runtimeLink" | Out-Null
            }
        }
        if (-not (Test-Path -LiteralPath $runtimeLink)) {
            New-Item -ItemType Directory -Force -Path (Split-Path $runtimeLink) | Out-Null
            & cmd.exe /c mklink /J "$runtimeLink" "$runtimeSrc" | Out-Null
        }
        if (Test-Path -LiteralPath (Join-Path $runtimeLink 'dependencies\node\bin\node.exe')) {
            Write-Log '运行时 junction 就绪'
        } else {
            Write-Log '运行时 junction 建立失败（宿主要联网自补，离线机会起不来）' 'WARN'
        }
    }

    # ---------- 7. 生成命令行 shim ----------
    $binDir = Join-Path $vendor 'bin'
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    $shims = @{
        'gitnexus.cmd'   = "@echo off`r`nsetlocal`r`n`"$node`" `"$(Join-Path $vendor 'gitnexus\dist\cli\index.js')`" %*`r`n"
        'codegraph.cmd'  = "@echo off`r`nsetlocal`r`n`"$node`" `"$(Join-Path $vendor 'codegraph\npm-shim.js')`" %*`r`n"
        'trellis.cmd'    = "@echo off`r`nsetlocal`r`n`"$node`" `"$(Join-Path $vendor 'trellis\bin\trellis.js')`" %*`r`n"
        'dsh-frozen.cmd' = "@echo off`r`nsetlocal`r`nif exist `"$(Join-Path $InstallDir 'Launch.ps1')`" (powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $InstallDir 'Launch.ps1')`") else (start `"`" `"$exe`")`r`n"
    }
    foreach ($name in $shims.Keys) {
        [IO.File]::WriteAllText((Join-Path $binDir $name), $shims[$name], [Text.Encoding]::ASCII)
    }
    Write-Log "命令行 shim：$binDir"

    # ---------- 8. PATH / DSH_HOME 用户环境变量 ----------
    if (-not $NoRegister) {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if (-not $userPath) { $userPath = '' }
        $parts = @($userPath -split ';' | Where-Object { $_ })
        foreach ($add in @($binDir, $pgBin)) {
            if (-not ($parts | Where-Object { $_.TrimEnd('\') -ieq $add.TrimEnd('\') })) {
                $parts += $add
                $newPath = ($parts -join ';')
                [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
                Write-Log "已加入用户 PATH：$add"
            }
        }
        if ([Environment]::GetEnvironmentVariable('DSH_HOME', 'User') -ne $HomeDir) {
            [Environment]::SetEnvironmentVariable('DSH_HOME', $HomeDir, 'User')
            Write-Log '已设置用户环境变量 DSH_HOME'
        }

        # ---------- 9. 快捷方式（指向启动器，启动时自动应用待生效更新） ----------
        $launcher = Join-Path $InstallDir 'Launch.ps1'
        $shell = New-Object -ComObject WScript.Shell
        $shortcutName = 'DeepSeek Harness 冻结版.lnk'
        foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) {
            if (-not $dir) { continue }
            $lnkPath = Join-Path $dir $shortcutName
            $lnk = $shell.CreateShortcut($lnkPath)
            if (Test-Path -LiteralPath $launcher) {
                $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
                $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
            } else {
                $lnk.TargetPath = $exe
                $lnk.Arguments = ''
            }
            $lnk.WorkingDirectory = $InstallDir
            $lnk.IconLocation = "$exe,0"
            $lnk.Description = 'DeepSeek Harness 冻结版（内置 dsh-purge / dsh-artex / GitNexus / CodeGraph / Trellis）'
            $lnk.Save()
            Write-Log "快捷方式：$lnkPath"
        }

        # ---------- 10. 卸载登记 ----------
        $regKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepSeekHarnessFrozen'
        New-Item -Path $regKey -Force | Out-Null
        $sizeMb = [int]((Get-ChildItem $InstallDir -Recurse -File -Force | Measure-Object Length -Sum).Sum / 1MB)
        $props = @{
            DisplayName          = 'DeepSeek Harness 冻结版'
            DisplayVersion       = "$script:Version (frozen)"
            Publisher            = 'Local Frozen Build'
            InstallLocation      = $InstallDir
            DisplayIcon          = $exe
            UninstallString      = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'Uninstall.ps1')`""
            QuietUninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'Uninstall.ps1')`" -Quiet"
            EstimatedSize        = $sizeMb
            NoModify             = 1
            NoRepair             = 1
        }
        foreach ($k in $props.Keys) { Set-ItemProperty -Path $regKey -Name $k -Value $props[$k] }
    }

    # ---------- 11. 安装回执 ----------
    $receipt = [ordered]@{
        installedAt      = (Get-Date).ToString('o')
        installDir       = $InstallDir
        dshHome          = $HomeDir
        version          = $script:Version
        frozen           = $true
        updater          = 'disabled (app-update.yml removed + main.js enabled=false)'
        node             = $node
        pluginsPreflight = $preflightSummary
        components       = @(
            'dsh-purge 1.1.90 (pre-applied)',
            'dsh-artex 0.2.0',
            '@xiaoso/dsh-workflow-lite 0.9.0',
            'dsh-tool-websearch 0.1.1',
            'dsh-skill-trellis 2.0.0 (SessionStart 注入 + 缺 .trellis 自动初始化)',
            'dsh-skill-grill-me 1.0.0',
            'dsh-skill-officecli 1.0.0',
            'dsh-skill-darwin 1.0.0',
            'dsh-mcp-gitnexus 1.0.0 (默认启用)',
            'dsh-mcp-codegraph 1.0.0 (默认启用)',
            'GitNexus 1.6.12',
            'CodeGraph 1.6.2',
            'Trellis 0.6.17'
        )
    }
    [IO.File]::WriteAllText((Join-Path $InstallDir 'install-receipt.json'), ($receipt | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))

    Write-Log '安装完成' 'OK'
    Write-Log "  程序：$exe"
    Write-Log "  配置：$HomeDir"
    Write-Log "  日志：$script:LogPath"

    if (-not $NoLaunch) {
        $launcher = Join-Path $InstallDir 'Launch.ps1'
        if (Test-Path -LiteralPath $launcher) {
            Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $launcher, '-Quiet')
        } else {
            Start-Process -FilePath $exe -WorkingDirectory $InstallDir
        }
    }
    exit 0
}
catch {
    Write-Log ("安装失败：" + $_.Exception.Message) 'ERROR'
    if (-not $Quiet) {
        try {
            [void][System.Windows.Forms.MessageBox]::Show(("安装失败：`n" + $_.Exception.Message + "`n`n日志：" + $script:LogPath), 'DeepSeek Harness 冻结版', 'OK', 'Error')
        } catch { }
    }
    exit 1
}
