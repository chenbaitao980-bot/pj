#requires -Version 5.1
<#
  DeepSeek Harness 冻结版 · 按工作区开关插件
  ------------------------------------------------------------------
  写入（或修改）<工作区>\.dsh\plugins.json，只影响这个工作区：

    trellis     Trellis SessionStart 注入 + 缺 .trellis 自动初始化
    gitnexus    GitNexus MCP 使用约束 + 缺 .gitnexus 时后台建索引
    codegraph   CodeGraph MCP 使用约束 + 缺 .codegraph 时后台建索引
    all         用 "*" 给该工作区所有插件设默认值

  配置文件格式（也可以手写）：
    {
      "trellis":   { "enabled": true,  "autoInit": true },
      "gitnexus":  { "enabled": false },
      "codegraph": { "enabled": true,  "autoInit": false },
      "*":         { "enabled": true }
    }

  优先级：工作区文件 > profile 的 workspaces 映射 > profile 全局默认。
  全局总开关仍然是 profile 里的 config.enabled；这里只能在工作区层面「再关/再开」。

  用法（-Enabled / -AutoInit 接受 true/false/1/0/on/off/启用/停用）：
    powershell -ExecutionPolicy Bypass -File Plugin-Scope.ps1 -Workspace D:\proj -Show
    powershell -ExecutionPolicy Bypass -File Plugin-Scope.ps1 -Workspace D:\proj -Plugin gitnexus -Enabled false
    powershell -ExecutionPolicy Bypass -File Plugin-Scope.ps1 -Workspace D:\proj -Plugin all -Enabled true
    powershell -ExecutionPolicy Bypass -File Plugin-Scope.ps1 -Workspace D:\proj -Plugin trellis -AutoInit false
    powershell -ExecutionPolicy Bypass -File Plugin-Scope.ps1 -Workspace D:\proj -Reset
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Workspace,
    [ValidateSet('trellis', 'gitnexus', 'codegraph', 'all')][string]$Plugin = 'all',
    [string]$Enabled,
    [string]$AutoInit,
    [switch]$Show,
    [switch]$Reset
)

$ErrorActionPreference = 'Stop'

function ConvertTo-OptionalBool([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }
    switch -Regex ($value.Trim().ToLowerInvariant()) {
        '^(1|true|on|yes|enable|enabled|启用|开)$' { return $true }
        '^(0|false|off|no|disable|disabled|停用|关)$' { return $false }
        default { throw "无法识别的布尔值：$value（用 true/false/1/0/on/off/启用/停用）" }
    }
}

try {
    $root = [IO.Path]::GetFullPath($Workspace)
    if (-not (Test-Path -LiteralPath $root)) { throw "工作区不存在：$root" }
    $dir = Join-Path $root '.dsh'
    $file = Join-Path $dir 'plugins.json'

    $data = [ordered]@{}
    if (Test-Path -LiteralPath $file) {
        $raw = [IO.File]::ReadAllText($file)
        if ($raw.Trim().Length -gt 0) {
            $parsed = $raw | ConvertFrom-Json
            foreach ($p in $parsed.PSObject.Properties) { $data[$p.Name] = $p.Value }
        }
    }

    if ($Reset) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
        Write-Host "已删除工作区配置：$file" -ForegroundColor Green
        exit 0
    }

    if ($Show) {
        Write-Host "工作区：$root"
        if (-not (Test-Path -LiteralPath $file)) {
            Write-Host '（没有 .dsh\plugins.json，全部继承 profile 全局配置）' -ForegroundColor Yellow
        } else {
            Write-Host ("文件：{0}" -f $file)
            [IO.File]::ReadAllText($file)
        }
        exit 0
    }

    $enabledValue = ConvertTo-OptionalBool $Enabled
    $autoInitValue = ConvertTo-OptionalBool $AutoInit
    if ($null -eq $enabledValue -and $null -eq $autoInitValue) {
        throw '至少给 -Enabled 或 -AutoInit 其中之一（或加 -Show / -Reset）'
    }

    $key = if ($Plugin -eq 'all') { '*' } else { $Plugin }
    $entry = [ordered]@{}
    if ($data.Contains($key)) {
        $existing = $data[$key]
        if ($null -ne $existing) {
            foreach ($p in $existing.PSObject.Properties) { $entry[$p.Name] = $p.Value }
        }
    }
    if ($null -ne $enabledValue) { $entry['enabled'] = $enabledValue }
    if ($null -ne $autoInitValue) { $entry['autoInit'] = $autoInitValue }
    $data[$key] = $entry

    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $json = $data | ConvertTo-Json -Depth 8
    # 注意：JSON 文件不带 BOM —— 插件用 JSON.parse 读取，BOM 会让解析失败
    [IO.File]::WriteAllText($file, $json, (New-Object Text.UTF8Encoding($false)))

    Write-Host ("已写入：{0}" -f $file) -ForegroundColor Green
    Write-Host $json
    Write-Host '会话第一次进入该工作区时生效（已在跑的会话按注入时状态）。' -ForegroundColor DarkGray
    exit 0
}
catch {
    Write-Host ("失败：" + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
