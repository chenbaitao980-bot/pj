#requires -Version 5.1
<#
  DeepSeek Harness 冻结版 · Trellis 增量升级
  ------------------------------------------------------------------
  只做增量，不做覆盖式替换：
    * 新文件 → 直接加入
    * 内容不同但属于构建产物（dist/ bin/ lib/） → 更新
    * 内容不同且属于模板/文档/配置 → 视为本地改动，**保留本地**，记进冲突清单
    * 官方删掉的文件 → 默认不删，记进清单（加 -Prune 才删未改动的）
  原版永远先备份：vendor\trellis.bak-<旧版本>-<时间戳>

  用法：
    powershell -ExecutionPolicy Bypass -File Update-Trellis.ps1 -CheckOnly
    powershell -ExecutionPolicy Bypass -File Update-Trellis.ps1 -DryRun
    powershell -ExecutionPolicy Bypass -File Update-Trellis.ps1
    powershell -ExecutionPolicy Bypass -File Update-Trellis.ps1 -Version 0.6.17
    powershell -ExecutionPolicy Bypass -File Update-Trellis.ps1 -Prune
#>
[CmdletBinding()]
param(
    [string]$InstallDir = '',
    [string]$Version = 'latest',
    [string]$Registry = 'https://registry.npmjs.org',
    [string]$Package = '@mindfoldhq/trellis',
    [switch]$CheckOnly,
    [switch]$DryRun,
    [switch]$Force,
    [switch]$Prune
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $env:TEMP "dsh-trellis-update-$stamp.log"

function Log([string]$message, [string]$level = 'INFO') {
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'HH:mm:ss'), $level, $message
    try { Add-Content -LiteralPath $log -Value $line -Encoding UTF8 } catch { }
    switch ($level) {
        'ERROR' { Write-Host $line -ForegroundColor Red }
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        'OK'    { Write-Host $line -ForegroundColor Green }
        default { Write-Host $line }
    }
}

# 这些目录是构建产物/依赖，官方更新时直接覆盖（不要手改）
$OVERWRITE_PREFIXES = @('dist/', 'bin/', 'lib/', 'node_modules/')
# 这些是模板/文档/配置，内容不同时保留本地并记冲突
$KEEP_PREFIXES = @('templates/', 'assets/', 'docs/', 'README', 'LICENSE', 'CHANGELOG')

function Get-Sha([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}

function Get-RelFiles([string]$root) {
    # node_modules 由 npm 单独安装、不在官方 tarball 里；升级比对必须跳过，否则整棵依赖树会被误判成"官方已删"
    # 注意：$env:TEMP 可能是 8.3 短路径，而 FullName 是长路径，必须先规范化，否则算出来的相对路径会错位
    $root = (Get-Item -LiteralPath $root).FullName.TrimEnd('\', '/')
    $skip = @('node_modules/', '.incremental-update.json', 'conflicts-')
    $list = @()
    Get-ChildItem -LiteralPath $root -Recurse -File -Force | ForEach-Object {
        $rel = $_.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
        foreach ($s in $skip) { if ($rel.StartsWith($s)) { return } }
        $list += $rel
    }
    return $list
}

try {
    if (-not $InstallDir) { $InstallDir = $PSScriptRoot }
    $InstallDir = [IO.Path]::GetFullPath($InstallDir)
    $trellisDir = Join-Path $InstallDir 'vendor\trellis'
    $pkgJson = Join-Path $trellisDir 'package.json'
    if (-not (Test-Path -LiteralPath $pkgJson)) { throw "找不到 Trellis：$pkgJson" }
    $local = (Get-Content -LiteralPath $pkgJson -Raw -Encoding UTF8 | ConvertFrom-Json).version
    Log "本地 Trellis：$local（$trellisDir）"

    $escaped = $Package.Replace('/', '%2F')
    $metaUrl = if ($Version -eq 'latest') { "$Registry/$escaped/latest" } else { "$Registry/$escaped/$Version" }
    Log "查询官方版本：$metaUrl"
    $meta = Invoke-RestMethod -Uri $metaUrl -TimeoutSec 20
    $remote = $meta.version
    $tarball = $meta.dist.tarball
    Log "官方 Trellis：$remote"

    if ($remote -eq $local -and -not $Force) {
        Log "已是最新（$local），无需升级。" 'OK'
        exit 0
    }
    if ($CheckOnly) {
        Log "有更新：$local → $remote（未执行，-CheckOnly）" 'WARN'
        exit 10
    }

    $temp = Join-Path $env:TEMP "dsh-trellis-$remote-$stamp"
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    $tgz = Join-Path $temp 'package.tgz'
    Log "下载：$tarball"
    Invoke-WebRequest -Uri $tarball -OutFile $tgz -TimeoutSec 120
    Log ("下载完成：{0:N1} MB" -f ((Get-Item $tgz).Length / 1MB))

    Push-Location $temp
    try {
        & tar.exe -xzf $tgz
        if ($LASTEXITCODE -ne 0) { throw "解包失败，tar exit=$LASTEXITCODE" }
    } finally {
        Pop-Location
    }
    $newRoot = Join-Path $temp 'package'
    if (-not (Test-Path -LiteralPath $newRoot)) { throw "解包结果里没有 package 目录：$newRoot" }
    $newPkg = Get-Content -LiteralPath (Join-Path $newRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Log "待合入版本：$($newPkg.version)"

    $oldFiles = Get-RelFiles $trellisDir
    $newFiles = Get-RelFiles $newRoot

    $added = @(); $updated = @(); $same = @(); $conflicts = @(); $missing = @()
    foreach ($rel in $newFiles) {
        $src = Join-Path $newRoot ($rel.Replace('/', '\'))
        $dst = Join-Path $trellisDir ($rel.Replace('/', '\'))
        if (-not (Test-Path -LiteralPath $dst)) { $added += $rel; continue }
        if ((Get-Sha $src) -eq (Get-Sha $dst)) { $same += $rel; continue }
        $keep = $KEEP_PREFIXES | Where-Object { $rel.StartsWith($_) }
        if ($keep) { $conflicts += $rel; continue }
        $updated += $rel
    }
    foreach ($rel in $oldFiles) {
        if ($newFiles -notcontains $rel) { $missing += $rel }
    }

    Log ("比对结果：新增 {0} / 更新 {1} / 相同 {2} / 冲突保留 {3} / 官方已删 {4}" -f $added.Count, $updated.Count, $same.Count, $conflicts.Count, $missing.Count) 'OK'

    if ($DryRun) {
        $cap = 20
        foreach ($rel in ($added | Select-Object -First $cap)) { Log "  + $rel" }
        if ($added.Count -gt $cap) { Log ("  + …其余 {0} 项" -f ($added.Count - $cap)) }
        foreach ($rel in ($updated | Select-Object -First $cap)) { Log "  ~ $rel" }
        if ($updated.Count -gt $cap) { Log ("  ~ …其余 {0} 项" -f ($updated.Count - $cap)) }
        foreach ($rel in ($conflicts | Select-Object -First $cap)) { Log "  ! 冲突保留本地：$rel" 'WARN' }
        if ($conflicts.Count -gt $cap) { Log ("  ! …其余 {0} 项" -f ($conflicts.Count - $cap)) 'WARN' }
        foreach ($rel in ($missing | Select-Object -First $cap)) { Log "  - 官方已删（保留）：$rel" }
        if ($missing.Count -gt $cap) { Log ("  - …其余 {0} 项" -f ($missing.Count - $cap)) }
        Log 'DryRun：未写入任何文件。' 'OK'
        exit 0
    }

    if ($added.Count -eq 0 -and $updated.Count -eq 0 -and $conflicts.Count -eq 0 -and (-not $Prune -or $missing.Count -eq 0)) {
        Log '没有需要合入的变更（内容一致）。' 'OK'
        exit 0
    }

    # 备份（原版不删除）
    $backup = Join-Path $InstallDir "vendor\trellis.bak-$local-$stamp"
    Log "备份原版：$backup"
    & robocopy $trellisDir $backup /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "备份失败，robocopy exit=$LASTEXITCODE" }

    foreach ($rel in ($added + $updated)) {
        $src = Join-Path $newRoot ($rel.Replace('/', '\'))
        $dst = Join-Path $trellisDir ($rel.Replace('/', '\'))
        New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
        Copy-Item -LiteralPath $src -Destination $dst -Force
    }
    if ($Prune) {
        foreach ($rel in $missing) {
            $dst = Join-Path $trellisDir ($rel.Replace('/', '\'))
            if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Force }
        }
    }

    $record = [ordered]@{
        updatedAt = (Get-Date).ToString('o')
        from      = $local
        to        = $newPkg.version
        added     = $added
        updated   = $updated
        conflicts = $conflicts
        missing   = $missing
        backup    = $backup
        mode      = 'incremental'
    }
    [IO.File]::WriteAllText((Join-Path $trellisDir '.incremental-update.json'), ($record | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))

    if ($conflicts.Count -gt 0) {
        $cf = Join-Path $trellisDir "conflicts-$($newPkg.version).txt"
        Set-Content -LiteralPath $cf -Value ($conflicts -join "`r`n") -Encoding UTF8
        Log "冲突清单：$cf（本地版本保留）" 'WARN'
    }

    $now = (Get-Content -LiteralPath (Join-Path $trellisDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    Log "完成：$local → $now（新增 $($added.Count)，更新 $($updated.Count)，冲突 $($conflicts.Count)）" 'OK'
    Log "回滚：删除 vendor\trellis，把 $backup 改名回 vendor\trellis"
    exit 0
}
catch {
    Log ("升级失败：" + $_.Exception.Message) 'ERROR'
    exit 1
}
