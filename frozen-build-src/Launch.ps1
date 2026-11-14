#requires -Version 5.1
<#
  DeepSeek Harness 冻结版 · 启动器
  ------------------------------------------------------------------
  桌面上/开始菜单里的快捷方式指向这里，而不是直接指向 exe。
  作用：先把「待生效的更新」落盘，再启动宿主。

  为什么需要它：
    升级冻结版时宿主可能正在运行，`resources\app` 与 `DeepSeek Harness.exe`
    被进程占用，无法原地替换。安装/升级脚本会把新内容放到
      resources\app.next
      DeepSeek Harness.exe.next
    本启动器在下一次启动前完成原子替换（旧目录改名留作回滚），然后拉起宿主。

  单独运行也可以：powershell -ExecutionPolicy Bypass -File Launch.ps1
#>
[CmdletBinding()]
param(
    [switch]$NoWait,
    [switch]$SwapOnly,
    [switch]$Quiet
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $env:TEMP "dsh-frozen-launch-$stamp.log"

function Log([string]$message) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $message
    try { Add-Content -LiteralPath $log -Value $line -Encoding UTF8 } catch { }
    if (-not $Quiet) { Write-Host $line }
}

function Get-ProcessesUnder([string]$dir) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) }
}

# 只有宿主壳进程会真正锁住要替换的文件；借这个 exe 跑 Node 脚本的辅助进程
# （例如 artex 的 llm-proxy.mjs）不应让「待生效更新」永久卡住。
function Get-ShellProcessesUnder([string]$dir) {
    Get-ProcessesUnder $dir | Where-Object {
        $cl = $_.CommandLine
        -not ($cl -match '--type=') -and -not ($cl -match '\.(mjs|js)(\s|"|$)')
    }
}

function Wait-ForExit([string]$dir, [int]$timeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $alive = @(Get-ShellProcessesUnder $dir)
        if ($alive.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 400
    }
    return (@(Get-ShellProcessesUnder $dir).Count -eq 0)
}

$exe = Join-Path $root 'DeepSeek Harness.exe'
$pendingApp = Join-Path $root 'resources\app.next'
$appDir = Join-Path $root 'resources\app'
$pendingExe = "$exe.next"

$hasPending = (Test-Path -LiteralPath $pendingApp) -or (Test-Path -LiteralPath $pendingExe)
if ($hasPending) {
    Log '检测到待生效更新，准备替换…'
    if (-not $NoWait) {
        # 宿主还在运行时无法完成替换；直接跳过等待打开现有版本，
        # 否则每次点击都要白等 25 秒，看起来像"点了没反应"。
        if (@(Get-ShellProcessesUnder $root).Count -gt 0) {
            Log '宿主正在运行，更新保留到下次启动（直接打开现有版本）。'
            $hasPending = $false
        } elseif (-not (Wait-ForExit $root 25)) {
            Log '仍有实例在运行，更新保留到下次启动（先启动现有版本）。'
            $hasPending = $false
        }
    }
}

if ($hasPending) {
    $swapHappened = $false
    $appBlocked = $false
    $hadPendingApp = Test-Path -LiteralPath $pendingApp
    if ($hadPendingApp) {
        # A swap is only safe when app.next is a COMPLETE tree. A concurrent
        # Upgrade copy (or a half-written tree) must never replace a working app.
        $pendingComplete = (Test-Path -LiteralPath (Join-Path $pendingApp 'package.json')) -and
            (Test-Path -LiteralPath (Join-Path $pendingApp 'lib\main.js')) -and
            (Test-Path -LiteralPath (Join-Path $pendingApp 'dsh\package.json'))
        $stagingCopies = @(Get-ChildItem -LiteralPath (Join-Path $root 'resources') -Directory -Filter 'app.staging-*' -ErrorAction SilentlyContinue)
        if ($stagingCopies.Count -gt 0 -or -not $pendingComplete) {
            Log 'app.next 不完整或更新仍在拷贝，本次保留现有版本，不替换。'
            $appBlocked = $true
            if (-not $pendingComplete) {
                try {
                    $bad = "$pendingApp.invalid-$stamp"
                    Move-Item -LiteralPath $pendingApp -Destination $bad -Force
                    Log "不完整的 app.next 已隔离为 $bad"
                } catch {
                    Log ("隔离不完整 app.next 失败：{0}" -f $_.Exception.Message)
                }
            }
        } else {
            $oldApp = Join-Path $root "resources\app.old-$stamp"
            try {
                if (Test-Path -LiteralPath $appDir) { Move-Item -LiteralPath $appDir -Destination $oldApp -Force }
                Move-Item -LiteralPath $pendingApp -Destination $appDir -Force
                $swapHappened = $true
                Log "resources\app 已更新（旧目录：$oldApp）"
                # 只保留最近一份回滚副本（深路径用 rmdir，Remove-Item 会撞 260 字符限制）
                Get-ChildItem -LiteralPath (Join-Path $root 'resources') -Directory -Filter 'app.old-*' -ErrorAction SilentlyContinue |
                    Sort-Object LastWriteTime -Descending | Select-Object -Skip 1 |
                    ForEach-Object { & cmd.exe /c rmdir /s /q "$($_.FullName)" | Out-Null }
            } catch {
                Log ("替换 resources\app 失败：{0}" -f $_.Exception.Message)
                if (-not (Test-Path -LiteralPath $appDir) -and (Test-Path -LiteralPath $oldApp)) {
                    Move-Item -LiteralPath $oldApp -Destination $appDir -Force -ErrorAction SilentlyContinue
                    Log '已回滚到旧 resources\app'
                }
            }
        }
    }
    if (-not $appBlocked -and (Test-Path -LiteralPath $pendingExe)) {
        try {
            $oldExe = "$exe.old-$stamp"
            if (Test-Path -LiteralPath $exe) { Move-Item -LiteralPath $exe -Destination $oldExe -Force }
            Move-Item -LiteralPath $pendingExe -Destination $exe -Force
            Log "宿主已更新（旧文件：$oldExe）"
            if (-not $hadPendingApp) { $swapHappened = $true }
        } catch {
            Log ("替换宿主失败：{0}（继续用现有宿主启动）" -f $_.Exception.Message)
        }
    } elseif ($appBlocked) {
        Log 'app 未替换，宿主 exe 保持现状。'
    }

    if ($swapHappened) {
        # 待生效标记：让 Doctor/安装回执能一眼看出
        $pendingFlag = Join-Path $root 'pending-update.json'
        if (Test-Path -LiteralPath $pendingFlag) { Remove-Item -LiteralPath $pendingFlag -Force -ErrorAction SilentlyContinue }

        # 回执改成「已生效」，免得 Doctor 里一直显示 staged
        $receiptPath = Join-Path $root 'install-receipt.json'
        if (Test-Path -LiteralPath $receiptPath) {
            try {
                $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $receipt | Add-Member -NotePropertyName mode -NotePropertyValue 'in-place (staged 更新已应用)' -Force
                $receipt | Add-Member -NotePropertyName appliedAt -NotePropertyValue (Get-Date).ToString('o') -Force
                [IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
                Log '安装回执已更新为 in-place'
            } catch {
                Log ("更新安装回执失败：{0}" -f $_.Exception.Message)
            }
        }

        # 清理登录兜底入口（替换已完成，不再需要）
        try {
            $startupDir = [Environment]::GetFolderPath('Startup')
            if ($startupDir) {
                $startupCmd = Join-Path $startupDir 'DeepSeekHarnessFrozen-Finalize.cmd'
                if (Test-Path -LiteralPath $startupCmd) {
                    Remove-Item -LiteralPath $startupCmd -Force -ErrorAction SilentlyContinue
                    Log '已清理登录兜底入口'
                }
            }
        } catch { }
    } else {
        Log '待生效更新未完成，保留 pending-update.json，下次启动重试。'
    }
}

if (-not (Test-Path -LiteralPath $exe)) {
    Log "找不到宿主：$exe"
    if (-not $Quiet) {
        try {
            Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
            [void][System.Windows.Forms.MessageBox]::Show("找不到 DeepSeek Harness.exe：`n$exe", 'DeepSeek Harness 冻结版', 'OK', 'Error')
        } catch { }
    }
    exit 1
}

if ($SwapOnly) {
    Log '仅执行待生效替换（-SwapOnly），不启动宿主。'
    exit 0
}

# 清理累积的 dsh-auth-* cookie（/*dsh:auth-cookie-prune*/）
# 桌面壳每次用随机端口起宿主，Web 认证 cookie 的名字按「主机:端口」哈希生成、30 天不过期；
# 浏览器对 127.0.0.1 不区分端口地保存并发送，每启动一次就多一个。攒到 Cookie 头 + 常规
# 浏览器头超过 Node 约 16KB 的请求头上限后，宿主对每个请求都回 431，桌面壳报
# "desktop welcome: Web authentication failed"，应用再也起不来。
# 启动前清掉历史 dsh-auth cookie；应用仍在运行时数据库被锁，脚本会自行退出。
try {
    $cookieDb = Join-Path $env:APPDATA '@deepseek-ai\dsh-desktop\Network\Cookies'
    $cookiePrune = Join-Path $root 'tools\prune-stale-dsh-cookies.mjs'
    $cookieNode = Join-Path $root 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
    if ((Test-Path -LiteralPath $cookieDb) -and (Test-Path -LiteralPath $cookiePrune) -and (Test-Path -LiteralPath $cookieNode)) {
        $pruneOut = & $cookieNode --disable-warning=ExperimentalWarning $cookiePrune 2>&1
        if ($LASTEXITCODE -eq 0) { Log '已清理历史 dsh-auth cookie' }
        else { Log ('清理 dsh-auth cookie 跳过（应用可能仍在运行）：' + [string]($pruneOut | Select-Object -Last 1)) }
    }
} catch { Log ("清理 dsh-auth cookie 失败：" + $_.Exception.Message) }

# 拉起本地「按工作区」控制面板（插件页 Tab 内嵌它）；已经在监听就跳过
try {
    $panel = Join-Path $root 'tools\plugin-scope-ui.mjs'
    $panelNode = Join-Path $root 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
    if ((Test-Path -LiteralPath $panel) -and (Test-Path -LiteralPath $panelNode)) {
        $listening = @(Get-NetTCPConnection -LocalPort 8799 -State Listen -ErrorAction SilentlyContinue)
        if ($listening.Count -eq 0) {
            Start-Process -FilePath $panelNode -ArgumentList @($panel, '--no-open', '--port', '8799') -WindowStyle Hidden
            Log '已启动本地控制面板 http://127.0.0.1:8799/'
        }
    }
} catch { Log ("启动控制面板失败：" + $_.Exception.Message) }

Start-Process -FilePath $exe -WorkingDirectory $root
exit 0
