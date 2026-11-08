#requires -Version 5.1
<#
  DeepSeek Harness 冻结版 · 待生效更新自动落盘
  ------------------------------------------------------------------
  宿主运行时无法替换 `resources\app` 与 `DeepSeek Harness.exe`。这个守候进程
  在后台等宿主完全退出，然后调用 `Launch.ps1 -SwapOnly` 完成原子替换——不需要
  用户记得用快捷方式启动。

  行为：
    * 安装目录里没有 pending-update.json 时立即退出（什么都不做）；
    * 每 3 秒探一次，宿主全部退出即替换；
    * 替换后写日志并退出，**不会主动启动宿主**（下次用户自己开就是新版）；
    * 默认最多守候 168 小时；超时留日志退出，快捷方式里的 Launch.ps1 仍是兜底。

  用法：
    powershell -ExecutionPolicy Bypass -File Finalize-Update.ps1
    powershell -ExecutionPolicy Bypass -File Finalize-Update.ps1 -TimeoutHours 24 -Quiet
#>
[CmdletBinding()]
param(
    [string]$InstallDir = '',
    [int]$TimeoutHours = 168,
    [int]$PollSeconds = 3,
    [switch]$Quiet
)

$ErrorActionPreference = 'Continue'
if (-not $InstallDir) { $InstallDir = $PSScriptRoot }
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $env:TEMP "dsh-frozen-finalize-$stamp.log"

function Log([string]$message) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $message
    try { Add-Content -LiteralPath $log -Value $line -Encoding UTF8 } catch { }
    if (-not $Quiet) { Write-Host $line }
}

function Get-Running {
    # 只盯宿主本体：MCP 子进程（node.exe）退出会慢几秒，但它们不占用 resources\app
    @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) })
}

$pending = Join-Path $InstallDir 'pending-update.json'
$launcher = Join-Path $InstallDir 'Launch.ps1'
if (-not (Test-Path -LiteralPath $pending)) {
    Log '没有待生效更新，退出。'
    exit 0
}
if (-not (Test-Path -LiteralPath $launcher)) {
    Log "缺少 Launch.ps1，退出：$launcher"
    exit 1
}

$deadline = (Get-Date).AddHours([Math]::Max(1, $TimeoutHours))
Log "开始守候待生效更新：$InstallDir（最多 $TimeoutHours 小时）"
Log ("当前实例：{0} 个" -f (Get-Running).Count)

while ((Get-Date) -lt $deadline) {
    $alive = Get-Running
    if ($alive.Count -eq 0) {
        Log '宿主已退出，执行替换…'
        $p = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcher, '-SwapOnly', '-NoWait', '-Quiet') -Wait -PassThru -WindowStyle Hidden
        Log ("替换脚本退出码：{0}" -f $p.ExitCode)
        if (Test-Path -LiteralPath $pending) {
            Log '仍有待生效标记，替换未完成（保留 Launch.ps1 兜底）。'
            exit 1
        }
        $version = ''
        $receipt = Join-Path $InstallDir 'install-receipt.json'
        if (Test-Path -LiteralPath $receipt) {
            try { $version = (Get-Content -LiteralPath $receipt -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { }
        }
        Log ("完成：待生效更新已落盘（记录版本 {0}）" -f $version)
        exit 0
    }
    Start-Sleep -Seconds ([Math]::Max(1, $PollSeconds))
}

Log '守候超时，退出（下次用快捷方式启动时 Launch.ps1 仍会完成替换）。'
exit 0
