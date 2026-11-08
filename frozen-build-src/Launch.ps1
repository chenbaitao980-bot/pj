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

function Wait-ForExit([string]$dir, [int]$timeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $alive = @(Get-ProcessesUnder $dir)
        if ($alive.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 400
    }
    return (@(Get-ProcessesUnder $dir).Count -eq 0)
}

$exe = Join-Path $root 'DeepSeek Harness.exe'
$pendingApp = Join-Path $root 'resources\app.next'
$appDir = Join-Path $root 'resources\app'
$pendingExe = "$exe.next"

$hasPending = (Test-Path -LiteralPath $pendingApp) -or (Test-Path -LiteralPath $pendingExe)
if ($hasPending) {
    Log '检测到待生效更新，准备替换…'
    if (-not $NoWait) {
        if (-not (Wait-ForExit $root 25)) {
            Log '仍有实例在运行，更新保留到下次启动（先启动现有版本）。'
            $hasPending = $false
        }
    }
}

if ($hasPending) {
    if (Test-Path -LiteralPath $pendingApp) {
        $oldApp = Join-Path $root "resources\app.old-$stamp"
        try {
            if (Test-Path -LiteralPath $appDir) { Move-Item -LiteralPath $appDir -Destination $oldApp -Force }
            Move-Item -LiteralPath $pendingApp -Destination $appDir -Force
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
    if (Test-Path -LiteralPath $pendingExe) {
        try {
            $oldExe = "$exe.old-$stamp"
            if (Test-Path -LiteralPath $exe) { Move-Item -LiteralPath $exe -Destination $oldExe -Force }
            Move-Item -LiteralPath $pendingExe -Destination $exe -Force
            Log "宿主已更新（旧文件：$oldExe）"
        } catch {
            Log ("替换宿主失败：{0}（继续用现有宿主启动）" -f $_.Exception.Message)
        }
    }
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
