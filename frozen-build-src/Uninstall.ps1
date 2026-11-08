#requires -Version 5.1
<#
  DeepSeek Harness 冻结版 · 卸载
  - 默认保留 %USERPROFILE%\.dsh（会话、技能、凭据都还在）
  - 加 -PurgeHome 才会一并删掉 DSH_HOME
#>
[CmdletBinding()]
param(
    [switch]$PurgeHome,
    [switch]$Quiet
)

$ErrorActionPreference = 'Continue'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $env:TEMP "dsh-frozen-uninstall-$stamp.log"
function Say([string]$m, [string]$lvl = 'INFO') {
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'HH:mm:ss'), $lvl, $m
    Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    if (-not $Quiet) { Write-Host $line }
}

$root = $PSScriptRoot
$exe = Join-Path $root 'DeepSeek Harness.exe'
$receipt = $null
$receiptPath = Join-Path $root 'install-receipt.json'
if (Test-Path -LiteralPath $receiptPath) {
    try { $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json } catch { }
}
$homeDir = if ($receipt -and $receipt.dshHome) { [string]$receipt.dshHome } else { Join-Path $env:USERPROFILE '.dsh' }
$binDirs = @((Join-Path $root 'vendor\bin'), (Join-Path $root 'vendor\pgsql\bin'))
$runtimeLink = Join-Path $homeDir 'dsh-runtimes\dsh-primary-runtime'
$shortcutName = 'DeepSeek Harness 冻结版.lnk'

Say "卸载目录：$root"

# 1. 结束本安装目录下的进程
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object {
        Say "结束进程 PID=$($_.ProcessId) $($_.Name)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
# 1.1 结束还在守候待生效更新的 Finalize-Update.ps1（它不在安装目录里，必须按命令行找）
$finalizePattern = [regex]::Escape((Join-Path $root 'Finalize-Update.ps1'))
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -match $finalizePattern) -and ($_.ProcessId -ne $PID) } |
    ForEach-Object {
        Say "结束守候进程 PID=$($_.ProcessId) Finalize-Update"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
# 1.2 结束本地控制面板（plugin-scope-ui.mjs）
$panelPattern = [regex]::Escape((Join-Path $root 'tools\plugin-scope-ui.mjs'))
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -match $panelPattern) } |
    ForEach-Object {
        Say "结束控制面板 PID=$($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
Start-Sleep -Milliseconds 500

# 2. 快捷方式
$shell = New-Object -ComObject WScript.Shell
$startupDir = [Environment]::GetFolderPath('Startup')
if ($startupDir) {
    $startupCmd = Join-Path $startupDir 'DeepSeekHarnessFrozen-Finalize.cmd'
    if (Test-Path -LiteralPath $startupCmd) {
        Remove-Item -LiteralPath $startupCmd -Force -ErrorAction SilentlyContinue
        Say '已删除登录兜底入口'
    }
}
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) {
    if (-not $dir) { continue }
    $lnk = Join-Path $dir $shortcutName
    if (Test-Path -LiteralPath $lnk) {
        Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue
        Say "删除快捷方式：$lnk"
    }
}

# 3. 卸载登记
$regKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepSeekHarnessFrozen'
if (Test-Path $regKey) {
    Remove-Item -Path $regKey -Recurse -Force -ErrorAction SilentlyContinue
    Say '已删除卸载登记'
}

# 4. PATH
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath) {
    $parts = @($userPath -split ';' | Where-Object { $_ })
    foreach ($binDir in $binDirs) {
        $parts = @($parts | Where-Object { $_.TrimEnd('\') -ine $binDir.TrimEnd('\') })
    }
    $newPath = ($parts -join ';')
    if ($newPath -ne $userPath) {
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        Say '已从用户 PATH 移除 vendor\bin 与 vendor\pgsql\bin'
    }
}

# 4.5 DSH_HOME 环境变量（只清指向本安装的值）
$envHome = [Environment]::GetEnvironmentVariable('DSH_HOME', 'User')
if ($envHome -and $envHome.TrimEnd('\') -ieq $homeDir.TrimEnd('\')) {
    [Environment]::SetEnvironmentVariable('DSH_HOME', $null, 'User')
    Say '已清除用户环境变量 DSH_HOME'
}

# 5. 运行时 junction（只删指向本安装目录的链接）
if (Test-Path -LiteralPath $runtimeLink) {
    $item = Get-Item -LiteralPath $runtimeLink -Force -ErrorAction SilentlyContinue
    if ($item -and $item.LinkType -eq 'Junction') {
        & cmd.exe /c rmdir "$runtimeLink" | Out-Null
        Say '已移除运行时 junction'
    }
}

# 6. 可选删除 DSH_HOME
if ($PurgeHome) {
    if (Test-Path -LiteralPath $homeDir) {
        Say "删除 DSH_HOME：$homeDir" 'WARN'
        Remove-Item -LiteralPath $homeDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# 7. 延迟删除安装目录（脚本自身在里面）
Say '安排删除安装目录…'
$cmd = '/c timeout /t 2 /nobreak >nul & rmdir /s /q "' + $root + '"'
Start-Process -FilePath $env:ComSpec -ArgumentList $cmd -WindowStyle Hidden

if (-not $Quiet) {
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        [void][System.Windows.Forms.MessageBox]::Show("卸载完成。`n`n保留的 DSH_HOME：$homeDir`n日志：$log", 'DeepSeek Harness 冻结版', 'OK', 'Information')
    } catch { }
}
exit 0
