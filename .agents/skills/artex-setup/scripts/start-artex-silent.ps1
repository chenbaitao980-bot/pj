<#
.SYNOPSIS
    以「隐藏控制台」方式启动 ARTEX：任务照跑，但屏幕不再闪跳 Windows Terminal 黑窗。

.DESCRIPTION
    背景：插件用 spawn(..., { windowsHide: true }) 起 ARTEX，进程没有控制台；worker 每步 exec 的
    控制台子进程只能各建一个控制台，Win11 默认终端就会为每个子进程开一扇新窗 → 屏幕不停闪跳。

    本脚本只换「启动外壳」，不动 ARTEX 源码、不动它的参数：
      1) DSN      ← .artex-runtime\config.json（退回 dsn.txt）
      2) 凭据     ← .artex-runtime\auth.json
      3) LLM 配置 ← 直接问插件（createArtex({}).config.llm），再用 profile 的 cordis.patch.yml 覆盖
      4) 生成自包含 start-hidden.cmd（GBK 写盘，路径含中文也不乱码）
      5) Start-Process -WindowStyle Hidden 起 cmd → cmd 前台跑 artex.exe
         ⇒ ARTEX 与全部子孙共享一个不可见控制台 ⇒ 0 弹窗
      6) 等健康检查通过，把真实 PID 写回 artex.pid，status/stop 照常可用

.EXAMPLE
    powershell -NoProfile -File start-artex-silent.ps1 -Repo E:\claude\project4\pj

.EXAMPLE
    powershell -NoProfile -File start-artex-silent.ps1 -Repo E:\claude\project4\pj -GenerateOnly

.EXAMPLE
    powershell -NoProfile -File start-artex-silent.ps1 -Repo E:\claude\project4\pj -Force   # 重启
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Repo,
    [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }),
    [string]$Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }),
    [int]$Port = 8787,
    [int]$ProxyPort = 8788,
    [switch]$GenerateOnly,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$root    = Join-Path $Repo 'artex'
$state   = Join-Path $root '.artex-runtime'
$exe     = Join-Path $root 'artex.exe'
$cmdFile = Join-Path $state 'start-hidden.cmd'
$logFile = Join-Path $state 'artex.log'
$dataDir = Join-Path $state 'data'
$pidFile = Join-Path $state 'artex.pid'

function Test-PortOpen([int]$p) {
    $c = New-Object System.Net.Sockets.TcpClient
    try { $c.Connect('127.0.0.1', $p); return $true }
    catch { return $false }
    finally { $c.Dispose() }
}

function Get-HealthUrl {
    foreach ($u in @("http://127.0.0.1:$Port/api/health", "http://127.0.0.1:$Port/health", "http://127.0.0.1:$Port/")) {
        try {
            $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200) { return $u }
        }
        catch { }
    }
    return ''
}

if (-not (Test-Path -LiteralPath $exe))   { throw "找不到 $exe，先按 SKILL.md §3 构建" }
if (-not (Test-Path -LiteralPath $state)) { throw "找不到运行目录 $state，先用 artex_start 初始化一次" }

# ── 1) DSN ─────────────────────────────────────────────────────────────
$dsn = ''
$cfgFile = Join-Path $state 'config.json'
if (Test-Path -LiteralPath $cfgFile) {
    try { $dsn = (Get-Content -LiteralPath $cfgFile -Raw | ConvertFrom-Json).database.dsn } catch { }
}
if (-not $dsn) {
    $dsnTxt = Join-Path $state 'dsn.txt'
    if (Test-Path -LiteralPath $dsnTxt) { $dsn = (Get-Content -LiteralPath $dsnTxt -Raw).Trim() }
}
if (-not $dsn) { throw '拿不到 DSN（config.json / dsn.txt 都没有），先跑一次 artex_start 或 setup db' }

# ── 2) 凭据 ────────────────────────────────────────────────────────────
$credFile = Join-Path $state 'auth.json'
if (-not (Test-Path -LiteralPath $credFile)) { throw "缺 $credFile；先用 artex_start 初始化管理员" }
$cred = Get-Content -LiteralPath $credFile -Raw | ConvertFrom-Json

# ── 3) LLM：先问插件，再用 profile 覆盖 ────────────────────────────────
$llm = @{ provider = ''; model = ''; baseUrl = ''; apiKeyName = ''; apiKeyEnv = ''; headers = [ordered]@{} }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($node) {
    $repoUri = ($Repo -replace '\\', '/')
    $probe = @"
import { createArtex } from "file:///$repoUri/dsh-artex/lib/artex.js";
const l = createArtex({}).config.llm || {};
console.log(JSON.stringify(l));
"@
    $tmp = Join-Path $env:TEMP 'artex-llm-probe.mjs'
    Set-Content -LiteralPath $tmp -Value $probe -Encoding UTF8
    try {
        $raw = & $node $tmp 2>$null | Select-Object -Last 1
        if ($raw) {
            $l = $raw | ConvertFrom-Json
            $llm.provider   = [string]$l.provider
            $llm.model      = [string]$l.model
            $llm.baseUrl    = [string]$l.baseUrl
            $llm.apiKeyName = [string]$l.apiKeyName
            $llm.apiKeyEnv  = [string]$l.apiKeyEnv
            if ($l.headers) { foreach ($pp in $l.headers.PSObject.Properties) { $llm.headers[$pp.Name] = [string]$pp.Value } }
        }
    }
    catch { }
    finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}

# profile 覆盖：只认 `- id: dsh-artex` 这一段里的 llm 配置（否则会把别的 bundle 的 provider 串进来）
$patch = Join-Path $DshHome "profiles\$Profile\cordis.patch.yml"
if (Test-Path -LiteralPath $patch) {
    $y = Get-Content -LiteralPath $patch -Raw
    $blk = [regex]::Match($y, '(?ms)^\s*-\s*id:\s*dsh-artex\s*$(.*?)(?=^\s*-\s*id:\s|\z)')
    if ($blk.Success) {
        $block = $blk.Groups[1].Value
        if ($block -match '(?m)^\s*provider:\s*(\S+)')   { $llm.provider   = $Matches[1].Trim('"', "'") }
        if ($block -match '(?m)^\s*model:\s*(\S+)')      { $llm.model      = $Matches[1].Trim('"', "'") }
        if ($block -match '(?m)^\s*baseUrl:\s*(\S+)')    { $llm.baseUrl    = $Matches[1].Trim('"', "'") }
        if ($block -match '(?m)^\s*apiKeyName:\s*(\S+)') { $llm.apiKeyName = $Matches[1].Trim('"', "'") }
        if ($block -match '(?ms)^\s*headers:\s*\r?\n((?:[ \t]+[^\s:#]+:[^\r\n]*\r?\n?)+)') {
            $llm.headers = [ordered]@{}
            foreach ($line in ($Matches[1] -split "\r?\n")) {
                if ($line -match '^\s*([^\s:#]+)\s*:\s*(.+?)\s*$') { $llm.headers[$Matches[1]] = $Matches[2].Trim('"', "'") }
            }
        }
    }
}

# key：按 apiKeyName / apiKeyEnv 从 credentials / .env 取
function Resolve-ApiKey([string]$name) {
    if (-not $name) { return '' }
    $envItem = Get-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    if ($envItem -and $envItem.Value) { return [string]$envItem.Value }
    $files = @(
        (Join-Path $DshHome '.credentials.yaml'),
        (Join-Path $DshHome '.env'),
        (Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'),
        (Join-Path $env:USERPROFILE '.dsh\.env'),
        (Join-Path $Repo 'deepseek-harness\.dsh\.env')
    )
    foreach ($f in $files) {
        if (-not (Test-Path -LiteralPath $f)) { continue }
        $txt = Get-Content -LiteralPath $f -Raw
        if ($txt -match "(?m)^\s*$([regex]::Escape($name))\s*[:=]\s*(\S+)") { return $Matches[1].Trim('"', "'") }
    }
    return ''
}
$apiKey = Resolve-ApiKey $llm.apiKeyName
if (-not $apiKey) { $apiKey = Resolve-ApiKey $llm.apiKeyEnv }

# 有自定义头就必须走本机转发（ARTEX 不会自己发这些头）
function Ensure-LlmProxy {
    $portFile = Join-Path $state 'llm-proxy.port'
    $pFile = Join-Path $state 'llm-proxy.pid'
    if (Test-Path -LiteralPath $portFile) {
        $p0 = 0
        [void][int]::TryParse((Get-Content -LiteralPath $portFile -Raw).Trim(), [ref]$p0)
        if ($p0 -gt 0 -and (Test-PortOpen $p0)) { return "http://127.0.0.1:$p0" }
    }
    $proxyScript = Join-Path $Repo 'dsh-artex\bin\llm-proxy.mjs'
    if (-not (Test-Path -LiteralPath $proxyScript)) { throw "找不到 $proxyScript" }
    if (-not $node) { throw 'PATH 里没有 node，无法起 llm 转发' }
    $p = $ProxyPort
    while (Test-PortOpen $p) { $p++ }
    $a = @($proxyScript, '--upstream', $llm.baseUrl, '--port', "$p")
    foreach ($k in $llm.headers.Keys) { $a += @('--header', "$k=$($llm.headers[$k])") }
    $proc = Start-Process -FilePath $node -ArgumentList $a -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath $pFile -Value $proc.Id -NoNewline -Encoding ascii
    Set-Content -LiteralPath $portFile -Value "$p" -NoNewline -Encoding ascii
    Start-Sleep -Milliseconds 900
    return "http://127.0.0.1:$p"
}

$baseUrl = $llm.baseUrl
if ($llm.headers.Count -gt 0 -and $llm.baseUrl -and $apiKey) { $baseUrl = Ensure-LlmProxy }

# ── 4) 生成 start-hidden.cmd（GBK：中文路径不乱码）──────────────────────
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('@echo off')
$lines.Add('rem ==== ARTEX silent launcher: shared hidden console, no popup windows ====')
$lines.Add("set `"ARTEX_CONFIG=$cfgFile`"")
$lines.Add("set `"ARTEX_PG_DSN=$dsn`"")
$lines.Add("set `"ARTEX_SKILL_DIR=$(Join-Path $root 'skills')`"")
$lines.Add('set "ARTEX_LANG=zh"')
$lines.Add("set `"ARTEX_ADMIN_PASSWORD=$($cred.password)`"")
$lines.Add("set `"ARTEX_SETUP_TOKEN=$($cred.setupToken)`"")
if ($apiKey -and $baseUrl) {
    $lines.Add("set `"ARTEX_LLM_PROVIDER=$($llm.provider)`"")
    $lines.Add("set `"ARTEX_LLM_MODEL=$($llm.model)`"")
    $lines.Add("set `"ARTEX_LLM_BASE_URL=$baseUrl`"")
    $keyVar = if ($llm.provider -eq 'openai') { 'OPENAI_API_KEY' } else { 'ANTHROPIC_API_KEY' }
    $lines.Add("set `"$keyVar=$apiKey`"")
}
$lines.Add("cd /d `"$root`"")
$lines.Add("`"$exe`" -addr 127.0.0.1:$Port -data `"$dataDir`" -proxy 127.0.0.1:$ProxyPort >> `"$logFile`" 2>&1")
$text = ($lines -join "`r`n") + "`r`n"
[IO.File]::WriteAllText($cmdFile, $text, [Text.Encoding]::GetEncoding(936))

Write-Host "已生成：$cmdFile"
Write-Host ("  DSN : " + ($dsn -replace '://([^:@/]+):[^@]*@', '://$1:***@'))
Write-Host ("  LLM : " + $(if ($apiKey -and $baseUrl) { "$($llm.provider)/$($llm.model) via $baseUrl  headers=$($llm.headers.Count)" } else { '未配置（引擎会空转）' }))
Write-Host ("  凭据: $($cred.username)（password / setupToken 已写入脚本）")

if ($GenerateOnly) { Write-Host '（-GenerateOnly：只生成，不启动）'; return }

# ── 5) 启动 ────────────────────────────────────────────────────────────
if (Test-PortOpen $Port) {
    if (-not $Force) { Write-Host "已在运行：http://127.0.0.1:$Port（要重启请加 -Force）"; return }
    $old = 0
    if (Test-Path -LiteralPath $pidFile) { [void][int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$old) }
    if ($old -gt 0) { & taskkill.exe /PID $old /T /F | Out-Null; Start-Sleep -Seconds 1 }
    # 父级外壳 cmd 不会被 /T 带走，单独清一遍，避免残留多个隐藏控制台宿主
    Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'start-hidden\.cmd' } |
        ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F | Out-Null }
    Start-Sleep -Milliseconds 500
}

$shell = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$cmdFile`"" -WindowStyle Hidden -PassThru
Write-Host "外壳 cmd pid=$($shell.Id)（隐藏控制台宿主）"
try { Set-Content -LiteralPath (Join-Path $state 'artex-shell.pid') -Value ([string]$shell.Id) -NoNewline -Encoding ascii } catch { }

$ok = ''
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 700
    $ok = Get-HealthUrl
    if ($ok) { break }
}

$ax = Get-CimInstance Win32_Process -Filter "Name='artex.exe'" -ErrorAction SilentlyContinue
if (-not $ax -or -not $ok) {
    $tail = ''
    if (Test-Path -LiteralPath $logFile) { $tail = (Get-Content -LiteralPath $logFile -Tail 12) -join "`n" }
    throw "启动失败（health='$ok'）。日志尾部：`n$tail"
}

Set-Content -LiteralPath $pidFile -Value ([string]$ax.ProcessId) -NoNewline -Encoding ascii
Write-Host "ARTEX 已启动：http://127.0.0.1:$Port"
Write-Host "  PID : $($ax.ProcessId)   父进程 $($ax.ParentProcessId)（隐藏控制台宿主）"
Write-Host "  日志: $logFile"
Write-Host '验收: Get-CimInstance Win32_Process | ? { $_.Name -in "WindowsTerminal.exe","OpenConsole.exe" }   # 期望为空'
