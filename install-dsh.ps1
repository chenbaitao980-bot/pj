# DSH 一键安装：dsh-purge + workflow-lite（PowerShell 版，推荐）
#
# 用法：
#   右键「用 PowerShell 运行」，或在本目录执行：
#   powershell -ExecutionPolicy Bypass -File ".\一键安装-DSH插件.ps1"
#
# 这个脚本只动 E:\claude\project4\pj\deepseek-harness 下的东西：
#   .dsh\profiles\web\cordis.patch.yml   追加 OpenCode Go 模型供应商
#   .dsh\.env                            写入 OPENCODE_GO_API_KEY
#   .dsh\profiles\web\node_modules       pnpm 安装 dsh-purge 与 workflow-lite
#
# 可重复执行：已经装好的步骤会自动跳过。

$ErrorActionPreference = 'Stop'

$Root    = 'E:\claude\project4\pj'
$DshRoot = Join-Path $Root 'deepseek-harness'
$DshHome = Join-Path $DshRoot '.dsh'
$Dsh     = Join-Path $DshRoot 'node_modules\.bin\dsh.cmd'
$Profile = 'web'
$ProfDir = Join-Path $DshHome "profiles\$Profile"
$Patch   = Join-Path $ProfDir 'cordis.patch.yml'
$EnvFile = Join-Path $DshHome '.env'

$PurgeUrl = 'https://codeload.github.com/HunYiSage/dsh-purge/tar.gz/refs/heads/master'
$WfPkg    = '@xiaoso/dsh-workflow-lite'
$ApiKey   = 'oc_sk_5f7b22ef9065_E-PAwWH-sA2KUg1qz6W7lxgNvLqnMVWH'

function Step($n, $t) { Write-Host "`n================ [$n] $t ================" -ForegroundColor Cyan }
function Ok($m)       { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m)     { Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Fail($m)     { Write-Host "`n[X] $m" -ForegroundColor Red; Read-Host "按回车退出"; exit 1 }

# ---------------------------------------------------------------
Step '1/4' '环境检查'
if (-not (Test-Path $Dsh)) {
    Fail "找不到 $Dsh`n    先执行：cd $DshRoot; npm install @deepseek-ai/dsh@0.2.1-rc.2"
}
if (-not (Test-Path (Join-Path $ProfDir 'package.json'))) {
    Fail "找不到 profile 目录：$ProfDir"
}
$env:DSH_HOME = $DshHome
Ok "DSH_HOME = $DshHome"
& $Dsh --version

# ---------------------------------------------------------------
Step '2/4' '配置 OpenCode Go 模型供应商'

$modelBlock = @"
- id: llm-pi-ai
  config:
    providers:
      opencode-go:
        displayName: OpenCode Go
        api: anthropic-messages
        apiKeyEnv: OPENCODE_GO_API_KEY
        baseURL: https://opencode.ai/zen/go
        defaultContextWindow: 1000000
        defaultMaxTokens: 16384
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
            contextWindow: 1000000
- id: agent-default-model
  config:
    provider: opencode-go
    model: deepseek-v4.1-flash
"@

$current = if (Test-Path $Patch) { Get-Content -Raw -Encoding UTF8 $Patch } else { '' }

if ($current -match 'opencode-go') {
    Ok '模型配置已存在，跳过'
} else {
    # 保留已有条目（例如 dsh-purge 的 insert），只追加模型配置
    $trimmed = $current.Trim()
    if ($trimmed -and $trimmed -ne '[]' -and $trimmed -ne '[ ]') {
        $new = $current.TrimEnd("`r", "`n") + "`n" + $modelBlock
    } else {
        $new = $modelBlock
    }
    Set-Content -Path $Patch -Value $new -Encoding UTF8 -NoNewline
    Ok "已写入模型配置 -> $Patch"
}

$envText = if (Test-Path $EnvFile) { Get-Content -Raw -Encoding UTF8 $EnvFile } else { '' }
if ($envText -notmatch 'OPENCODE_GO_API_KEY') {
    Add-Content -Path $EnvFile -Value "OPENCODE_GO_API_KEY=$ApiKey" -Encoding UTF8
    Ok "已写入密钥 -> $EnvFile"
} else {
    Ok '密钥已存在，跳过'
}

Push-Location $ProfDir
& $Dsh --profile $Profile --dump-config 2>&1 | Out-File -Encoding UTF8 "$env:TEMP\dsh-cfg-check.yml"
Pop-Location
if (-not (Select-String -Path "$env:TEMP\dsh-cfg-check.yml" -Pattern 'opencode-go' -Quiet)) {
    Fail "配置没生效，检查 $Patch`n详情：$env:TEMP\dsh-cfg-check.yml"
}
Ok '配置已生效'

# ---------------------------------------------------------------
Step '3/4' '安装 dsh-purge'

Push-Location $ProfDir
try {
    $purgeDir = Join-Path $ProfDir 'node_modules\dsh-purge'
    if (Test-Path (Join-Path $purgeDir 'package.json')) {
        Ok 'dsh-purge 已安装，跳过'
    } else {
        Write-Host "  正在下载安装（GitHub 直连可能较慢，请耐心等）..." -ForegroundColor Gray
        & pnpm add --allow-build=dsh-purge "--allow-build=dsh-purge@$PurgeUrl" $PurgeUrl
        if ($LASTEXITCODE -ne 0) { throw 'pnpm add dsh-purge 失败' }
        Ok 'dsh-purge 安装完成'
    }
    $ensure = Join-Path $purgeDir 'scripts\ensure-profile-bundle.mjs'
    if (Test-Path $ensure) {
        & node $ensure
    }
} catch {
    Fail $_.Exception.Message
} finally {
    Pop-Location
}

# ---------------------------------------------------------------
Step '4/4' '安装 workflow-lite'

Push-Location $ProfDir
try {
    if (Test-Path (Join-Path $ProfDir 'node_modules\@xiaoso\dsh-workflow-lite\package.json')) {
        Ok 'workflow-lite 已安装，跳过'
    } else {
        & pnpm add $WfPkg
        if ($LASTEXITCODE -ne 0) { Warn 'workflow-lite 安装失败（不影响 dsh-purge）' } else { Ok 'workflow-lite 安装完成' }
    }
} finally {
    Pop-Location
}

# ---------------------------------------------------------------
Step '校验' '汇总检查结果'
Push-Location $ProfDir
& $Dsh --profile $Profile --dump-config 2>&1 | Out-File -Encoding UTF8 "$env:TEMP\dsh-cfg-final.yml"
Pop-Location

$cfg = "$env:TEMP\dsh-cfg-final.yml"
if (Select-String -Path $cfg -Pattern 'id: dsh-purge' -Quiet) { Ok 'dsh-purge 已加载' } else { Warn "dsh-purge 未加载，看 $cfg" }
if (Select-String -Path $cfg -Pattern 'workflow-lite' -Quiet)  { Ok 'workflow-lite 已加载' } else { Warn 'workflow-lite 未加载' }
if (Select-String -Path $cfg -Pattern 'opencode-go' -Quiet)    { Ok 'opencode-go 模型已配置' } else { Warn 'opencode-go 未配置' }

@"

================== 全部完成 ==================

启动 Web 端：
  set DSH_HOME=$DshHome
  "$Dsh" web
（也可以直接运行同目录的 启动-DSH.ps1）

启动后依次做：
  1. 会话标题旁点 dsh-purge 图标 -> 清洗 -> 应用（应用后会自动重启一次）
  2. 聊天里输入 /purge status 验证
  3. 工作流中心 -> 导入 -> 选择
       $Root\minglink-workflows\dsh-workflows\workflows\破甲制作.wflite.zip

换模型供应商：直接编辑
  $Patch
改 providers 下的 baseURL / models / apiKeyEnv，以及 agent-default-model 的 provider 与 model。
换 key 就改 $EnvFile 里的 OPENCODE_GO_API_KEY。
"@ | Write-Host

Read-Host '按回车结束'
