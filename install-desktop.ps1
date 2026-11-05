# DeepSeek Harness 桌面版安装
#
# 用法（二选一）：
#   powershell -ExecutionPolicy Bypass -File ".\install-desktop.ps1"
#   powershell -ExecutionPolicy Bypass -File ".\install-desktop.ps1" -Portable
#
# 默认：静默安装到系统默认位置（不弹界面）
# -Portable：解包到 E:\claude\project4\pj\dsh-desktop，不写注册表、不建快捷方式

param([switch]$Portable)

$ErrorActionPreference = 'Stop'

$Root      = 'E:\claude\project4\pj'
$Installer = Join-Path $Root 'desktop-installer\dsh-latest-windows-x64.exe'
$PortableDir = Join-Path $Root 'dsh-desktop'
$DshHome   = Join-Path $Root 'deepseek-harness\.dsh'

if (-not (Test-Path $Installer)) {
    Write-Host "[X] 找不到安装包：$Installer" -ForegroundColor Red
    Write-Host "    重新下载："
    Write-Host "    curl -L -o `"$Installer`" https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe"
    Read-Host '按回车退出'; exit 1
}

# --- 校验签名 ---
Write-Host "`n=== 校验安装包 ===" -ForegroundColor Cyan
$sig = Get-AuthenticodeSignature $Installer
if ($sig.Status -ne 'Valid') {
    Write-Host "[X] 签名无效：$($sig.Status)" -ForegroundColor Red
    Read-Host '按回车退出'; exit 1
}
$f = Get-Item $Installer
Write-Host "  [OK] 签名有效"
Write-Host "       签名者: $($sig.SignerCertificate.Subject -replace ',.*', '')"
Write-Host "       版本  : $($f.VersionInfo.FileVersion)"
Write-Host "       大小  : {0:N1} MB" -f ($f.Length / 1MB)

# 让桌面版复用本目录已经配好的模型与插件
$env:DSH_HOME = $DshHome
Write-Host "`n  桌面版将使用 DSH_HOME = $DshHome" -ForegroundColor Gray
Write-Host "  （OpenCode Go 模型配置、dsh-purge、workflow-lite 都在这里）" -ForegroundColor Gray

if ($Portable) {
    # --- 解包为便携版 ---
    Write-Host "`n=== 解包为便携版 -> $PortableDir ===" -ForegroundColor Cyan
    $sevenZip = 'C:\Program Files\7-Zip\7z.exe'
    if (-not (Test-Path $sevenZip)) {
        Write-Host "[X] 找不到 7-Zip：$sevenZip" -ForegroundColor Red
        Write-Host "    装一个 7-Zip，或去掉 -Portable 参数改用标准安装。"
        Read-Host '按回车退出'; exit 1
    }
    if (Test-Path $PortableDir) { Remove-Item -Recurse -Force $PortableDir }
    New-Item -ItemType Directory -Path $PortableDir | Out-Null
    & $sevenZip x -y "-o$PortableDir" $Installer | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[X] 解包失败" -ForegroundColor Red
        Read-Host '按回车退出'; exit 1
    }
    $exe = Get-ChildItem -Path $PortableDir -Filter '*.exe' -Recurse |
           Where-Object { $_.Name -notlike '*Uninstall*' } | Select-Object -First 1
    if ($exe) {
        Write-Host "  [OK] 已解包"
        Write-Host "       启动程序: $($exe.FullName)"
    } else {
        Write-Host "  [!] 解包完成但没找到主程序，看看目录内容："
        Get-ChildItem $PortableDir | Select-Object -First 20 Name
    }
} else {
    # --- 标准静默安装 ---
    Write-Host "`n=== 静默安装（可能要 1-2 分钟）===" -ForegroundColor Cyan
    Write-Host "  SmartScreen 可能拦截未在此签名的安装；如果弹窗，点「更多信息 -> 仍要运行」" -ForegroundColor Gray
    Start-Process -FilePath $Installer -ArgumentList '/S' -Wait
    $installed = @(
        "$env:LOCALAPPDATA\Programs\DeepSeek Harness",
        "$env:LOCALAPPDATA\Programs\dsh-desktop",
        "$env:ProgramFiles\DeepSeek Harness"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($installed) {
        Write-Host "  [OK] 已安装到：$installed"
    } else {
        Write-Host "  [!] 没在常见位置找到安装结果，检查开始菜单和桌面快捷方式"
    }
}

Write-Host "`n=== 装完之后 ===" -ForegroundColor Cyan
$lines = @(
    '  1. 启动桌面版（会读取 ' + $DshHome + ' 里的配置）',
    '  2. 会话标题旁点 dsh-purge -> 清洗 -> 应用',
    '  3. 聊天框输入 /purge status 验证',
    '  4. 工作流中心 -> 导入 -> ' + $Root + '\minglink-workflows\dsh-workflows\workflows\破甲制作.wflite.zip',
    '',
    '  注意：dsh-purge 的状态是「按宿主分别应用」的，',
    '  Web 端点过「应用」不代表桌面版也应用了，桌面版要单独再点一次。'
)
$lines | ForEach-Object { Write-Host $_ }

Read-Host '按回车结束'
