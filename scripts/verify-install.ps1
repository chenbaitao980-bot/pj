#requires -Version 5.1
<#
  Verify that a DeepSeek Harness frozen tree carries every local customization.

  Use it on the payload before building, and on an installed tree after
  installing, to tell "the patch is missing" apart from "the feature is buggy".

  Checks:
    * the three version stamps agree;
    * each frozen patch marker is present in its client bundle;
    * every local plugin is registered in the profile and its files exist.

  usage:
    powershell -ExecutionPolicy Bypass -File scripts\verify-install.ps1
    powershell -ExecutionPolicy Bypass -File scripts\verify-install.ps1 -Tree D:\dsh-freeze-new\payload
    powershell -ExecutionPolicy Bypass -File scripts\verify-install.ps1 -Tree "C:\Users\Administrator\AppData\Local\Programs\DeepSeekHarnessFrozen"
#>
[CmdletBinding()]
param(
    [string]$Tree = 'D:\dsh-freeze-new\payload'
)

$ErrorActionPreference = 'Stop'
$fail = 0
$pass = 0

function Check([string]$label, [bool]$ok, [string]$detail = '') {
    if ($ok) {
        $script:pass++
        Write-Host ("PASS  {0}" -f $label) -ForegroundColor Green
    }
    else {
        $script:fail++
        Write-Host ("FAIL  {0}{1}" -f $label, $(if ($detail) { " -- $detail" } else { '' })) -ForegroundColor Red
    }
}

function ReadJson([string]$path) {
    if (-not (Test-Path $path)) { return $null }
    try { return (Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function HasMarker([string]$path, [string]$marker) {
    if (-not (Test-Path $path)) { return $false }
    return [bool](Select-String -Path $path -Pattern ([regex]::Escape($marker)) -Quiet)
}

$appRoot = Join-Path $Tree 'resources\app'
$dshRoot = Join-Path $appRoot 'dsh'
$pkgRoot = Join-Path $dshRoot 'node_modules\@deepseek-ai'

Write-Host ("tree  {0}" -f $Tree) -ForegroundColor Cyan

# ---------------------------------------------------------------- version stamps
$appPkg = ReadJson (Join-Path $appRoot 'package.json')
$dshPkg = ReadJson (Join-Path $dshRoot 'package.json')
$manifest = ReadJson (Join-Path $Tree 'FROZEN-BUILD.json')

Check 'app package.json readable' ($null -ne $appPkg)
Check 'dsh runtime package.json readable' ($null -ne $dshPkg)
Check 'FROZEN-BUILD.json readable' ($null -ne $manifest)

$pendingPkg = ReadJson (Join-Path $Tree 'resources\app.next\package.json')
if ($appPkg -and $dshPkg -and $manifest) {
    if ($null -ne $pendingPkg -and [string]$pendingPkg.version -ne [string]$appPkg.version) {
        # Staged update: the running tree keeps the old app until Launch.ps1 swaps app.next.
        Check 'version stamps agree (staged update pending)' ([string]$pendingPkg.version -eq [string]$manifest.version) ("app {0} / pending {1} / manifest {2}" -f $appPkg.version, $pendingPkg.version, $manifest.version)
        Write-Host ("      version {0} (pending {1}, applies on next launch)" -f $appPkg.version, $pendingPkg.version)
    }
    else {
        $versions = @($appPkg.version, $dshPkg.version, $manifest.version) | Select-Object -Unique
        Check 'version stamps agree' ($versions.Count -eq 1) ($versions -join ' / ')
        Write-Host ("      version {0}" -f $appPkg.version)
    }
}

# ------------------------------------------------------------------ frozen patches
$conversation = Join-Path $pkgRoot 'dsh-client-ui-conversation\lib\client.js'
$workspace = Join-Path $pkgRoot 'dsh-client-ui-workspace\lib\client.js'
$sidebarRight = Join-Path $pkgRoot 'dsh-client-ui-sidebar-right\lib\client.js'
$sidebarLeft = Join-Path $pkgRoot 'dsh-client-ui-sidebar\lib\client.js'
$desktopPreload = Join-Path $appRoot 'lib\preload-app.cjs'
$desktopMain = Join-Path $appRoot 'lib\main.js'

Check 'bundle dsh-client-ui-conversation present' (Test-Path $conversation)
Check 'bundle dsh-client-ui-workspace present' (Test-Path $workspace)
Check 'bundle dsh-client-ui-sidebar-right present' (Test-Path $sidebarRight)

Check 'patch: no-workspace (conversation)' (HasMarker $conversation 'dsh:no-workspace-conversation')
Check 'patch: no-workspace (picker)' (HasMarker $workspace 'dsh:no-workspace-picker')
Check 'patch: multi-workspace picker' (HasMarker $workspace 'dsh:multi-workspace-ui')
Check 'patch: side-session bundle patch removed' (-not (HasMarker $workspace 'dsh:side-session'))
Check 'patch: side-chat add-tab' (HasMarker $sidebarRight 'dsh:side-chat-addtab')
Check 'patch: side-chat tree under main' (HasMarker $workspace 'dsh:side-chat-tree')
Check 'patch: workspace notes' (HasMarker $workspace 'dsh:workspace-notes')
Check 'patch: workspace roots chip' (HasMarker $conversation 'dsh:roots-chip')
Check 'patch: todo live panel' (HasMarker $conversation 'dsh:todo-live')
Check 'patch: task board dock replacement' (HasMarker $conversation 'dsh:todo-board-replaced')
$inputTrigger = Join-Path $pkgRoot 'dsh-client-ui-input-trigger\lib\client.js'
Check 'patch: slash plugin group title' (HasMarker $inputTrigger '"plugin": "Plugins"')
Check 'patch: sidebar session tracker slot' (HasMarker $sidebarLeft 'dsh:sidebar-tracker')
$persistence = Join-Path $pkgRoot 'dsh-session-persistence-jsonl\lib\index.js'
Check 'patch: session log repair (stored log heals)' (HasMarker $persistence 'dsh:session-log-repair')
Check 'patch: desktop attention bridge' ((HasMarker $desktopPreload 'dsh:desktop-attention') -and (HasMarker $desktopMain 'dsh:desktop-attention'))
Check 'upgrade: keeps user plugin declarations' (HasMarker (Join-Path $Tree 'Upgrade.ps1') 'dsh:keep-user-plugins')

# 冻结版把补丁脚本随包装在 tools\，revert 后靠它们重打；缺一个就是不可自愈。
$patchTools = @(
    'patch-no-workspace.js', 'patch-multi-workspace-ui.js', 'patch-sidebar-add-tab.js',
    'patch-workspace-roots-chip.js', 'patch-todo-panel.js', 'patch-slash-plugin-group.js',
    'patch-task-board.js', 'patch-side-chat-tree.js', 'patch-workspace-notes.js', 'patch-session-tracker.js',
    'patch-desktop-attention.js', 'patch-session-log-repair.js'
)
$toolsDir = Join-Path $Tree 'tools'
foreach ($tool in $patchTools) {
    Check ("tool: {0}" -f $tool) (Test-Path (Join-Path $toolsDir $tool)) $toolsDir
}

# 0.2.11-rc.16+: Launch.ps1 在每次启动前清理累积的 dsh-auth-* cookie。
# 缺脚本或缺启动器钩子时，装机会在若干次启动后固定卡在
# "desktop welcome: Web authentication failed"（宿主对超大 Cookie 头回 431）。
$pruneTool = Join-Path $toolsDir 'prune-stale-dsh-cookies.mjs'
Check 'tool: prune-stale-dsh-cookies.mjs' (Test-Path $pruneTool) $toolsDir
Check 'tool: prune script keeps the dsh-auth selector' ((HasMarker $pruneTool "host_key='127.0.0.1'") -and (HasMarker $pruneTool 'dsh-auth-')) $pruneTool
Check 'launcher: prunes stale dsh-auth cookies' ((HasMarker (Join-Path $Tree 'Launch.ps1') 'dsh:auth-cookie-prune') -and (HasMarker (Join-Path $Tree 'Launch.ps1') 'prune-stale-dsh-cookies.mjs')) (Join-Path $Tree 'Launch.ps1')

# ---------------------------------------------------------------------- plugins
$profileDirs = @(
    (Join-Path $Tree 'dsh-home\profiles\desktop'),
    (Join-Path $Tree 'profiles\desktop')
)
$profileDir = $profileDirs | Where-Object { Test-Path (Join-Path $_ 'package.json') } | Select-Object -First 1

if (-not $profileDir) {
    # Installed trees keep the profile under %USERPROFILE%\.dsh.
    $home = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
    if (Test-Path (Join-Path $home 'package.json')) { $profileDir = $home }
}

Check 'profile package.json found' ($null -ne $profileDir) 'looked in dsh-home, profiles, and %USERPROFILE%\.dsh'

if ($profileDir) {
    $profile = ReadJson (Join-Path $profileDir 'package.json')
    $bundles = @($profile.dsh.profile.bundles)
    foreach ($plugin in @('@local/dsh-toolcall-tone', '@local/dsh-multi-workspace', '@local/dsh-side-chat', '@local/dsh-plugin-slash', '@local/dsh-websearch-preference', '@local/dsh-todo-nudge', '@local/dsh-task-board', '@local/dsh-session-panel', '@local/dsh-session-tracker', '@local/dsh-openviking-bootstrap', '@openviking/dsh-memory-plugin', 'dsh-mobile', 'dsh-mcp-agent-desktop', 'billion-context', 'dsh-codex-cua')) {
        $registered = $bundles -contains $plugin
        Check ("plugin registered: {0}" -f $plugin) $registered
        $moduleDir = Join-Path $profileDir ('node_modules\' + ($plugin -replace '/', '\'))
        $entries = switch ($plugin) {
            'dsh-mobile' { @('lib\index.mjs') }
            'dsh-mcp-agent-desktop' { @('lib\index.js', 'cordis.patch.yml') }
            'billion-context' { @('dist\agent\dsh-native.js', 'dist\index.js', 'dsh.bundle.patch.yml') }
            '@local/dsh-websearch-preference' { @('index.js') }
            '@local/dsh-todo-nudge' { @('index.js') }
            '@local/dsh-session-panel' { @('index.js', 'client.js', 'vcs.js') }
            '@local/dsh-openviking-bootstrap' { @('index.js', 'cordis.patch.yml') }
            '@openviking/dsh-memory-plugin' { @('index.mjs', 'config.mjs', 'cordis.patch.yml') }
            # Codex computer-use 引擎：自带 vendor 运行时，少一个文件就只剩空工具表。
            'dsh-codex-cua' { @('lib\index.js', 'mcp\server.mjs', 'cordis.patch.yml', 'vendor\@oai\sky\package.json', 'vendor\@oai\sky\bin\windows\codex-computer-use.exe', 'vendor\node_modules\@statsig\js-client\package.json') }
            default { @('index.js', 'client.js') }
        }
        $present = @($entries | Where-Object { Test-Path (Join-Path $moduleDir $_) })
        Check ("plugin files: {0}" -f $plugin) ($present.Count -eq $entries.Count) $moduleDir
    }

    # 0.2.11-rc.21+: Ctrl+; 副会话必须共享主会话记忆。
    # Host 半注册 agent/pre-step 桥接；Client 半把父会话 id 编进标题。
    # 缺任一标记，装出来的仍是「fork 后各聊各的」旧行为。
    $sideChatIndex = Join-Path $profileDir 'node_modules\@local\dsh-side-chat\index.js'
    $sideChatClient = Join-Path $profileDir 'node_modules\@local\dsh-side-chat\client.js'
    Check 'side-chat: shared-memory host bridge' ((HasMarker $sideChatIndex 'side-chat-memory') -and (HasMarker $sideChatIndex 'agent/pre-step')) $sideChatIndex
    Check 'side-chat: parent session title marker' ((HasMarker $sideChatClient 'SIDE_TITLE_MARK') -and (HasMarker $sideChatClient 'markSideSession')) $sideChatClient

    # 0.2.11-rc.24+: OpenViking 作为 DSH 的长期记忆层。
    # bootstrap 必须能在宿主启动时拉起 VLM + Server，并暴露 DSH 模型 bridge；
    # memory 插件必须带官方 bundle patch，否则 profile 里只有目录没有运行时。
    $ovBootstrap = Join-Path $profileDir 'node_modules\@local\dsh-openviking-bootstrap\index.js'
    $ovMemory = Join-Path $profileDir 'node_modules\@openviking\dsh-memory-plugin\index.mjs'
    $ovMemoryPatch = Join-Path $profileDir 'node_modules\@openviking\dsh-memory-plugin\cordis.patch.yml'
    Check 'openviking: bootstrap host bridge' ((HasMarker $ovBootstrap 'openviking-memory-bridge') -and (HasMarker $ovBootstrap 'startBridge')) $ovBootstrap
    Check 'openviking: memory plugin entry' (HasMarker $ovMemory 'openviking-memory') $ovMemory
    Check 'openviking: memory bundle patch' (HasMarker $ovMemoryPatch 'openviking-memory-runtime') $ovMemoryPatch

    # dsh-purge 的 revert 会先还原 bundle 再按 FROZEN_PATCH_SCRIPTS 重打。
    # 若是旧列表，revert 会把副会话重新隐藏；tree/notes 必须在列表里且 hide 不在。
    $purgeCore = Join-Path $profileDir 'node_modules\dsh-purge\lib\core.js'
    Check 'purge: reapplies side-chat tree' (HasMarker $purgeCore 'patch-side-chat-tree.js') $purgeCore
    Check 'purge: reapplies workspace notes' (HasMarker $purgeCore 'patch-workspace-notes.js') $purgeCore
    Check 'purge: no obsolete side-chat hide' (-not (HasMarker $purgeCore 'patch-side-chat-hide.js')) $purgeCore
    Check 'tool: obsolete side-chat hide removed' (-not (Test-Path (Join-Path $toolsDir 'patch-side-chat-hide.js'))) $toolsDir

    # Tracker and panel receive the raw `⧉ <id> · name` title. They must strip
    # the marker; otherwise side chats show a UUID twice, in the tracker and in
    # desktop notifications.
    $trackerClient = Join-Path $profileDir 'node_modules\@local\dsh-session-tracker\client.js'
    Check 'side-chat: tracker strips title marker' ((HasMarker $trackerClient 'SIDE_TITLE_RE') -and (HasMarker $trackerClient 'sideTitleText')) $trackerClient
    $panelClient = Join-Path $profileDir 'node_modules\@local\dsh-session-panel\client.js'
    Check 'side-chat: panel strips title marker' ((HasMarker $panelClient 'SIDE_TITLE_RE') -and (HasMarker $panelClient 'sideTitleText')) $panelClient

    # Task guardian (0.2.11-rc.10+): the host half registers the `taskGuardian`
    # projection and tags its writes; the board reads that projection. A package
    # carrying the old placeholder-only fallback would bring back the
    # "board stuck on the prompt / pending left after the turn" bugs.
    $nudge = Join-Path $profileDir 'node_modules\@local\dsh-todo-nudge\index.js'
    $board = Join-Path $profileDir 'node_modules\@local\dsh-task-board\client.js'
    Check 'task guardian: host projection + tagged writes' ((HasMarker $nudge "key: 'taskGuardian'") -and (HasMarker $nudge "const GUARD_TAG = 'task-guardian'")) $nudge
    Check 'task guardian: end-of-turn audit' (HasMarker $nudge 'const runFinalAudit') $nudge
    Check 'task guardian: board reads guardian view' (HasMarker $board "useProjection('taskGuardian')") $board
    # 0.2.11-rc.11+: a finished turn leaves only completed rows (waiting rows are deferred, not left pending).
    Check 'task guardian: finished turn settles every row' ((HasMarker $nudge "verdict === 'wait'") -and (HasMarker $board 'settledLines')) $nudge
    # 0.2.11-rc.15+: planning and audits use the session's own route. A package
    # that still picks a "fast" model by name can land on another API adapter
    # that answers with empty text, freezing the board for the whole turn.
    Check 'task guardian: audits use the session route' ((HasMarker $nudge 'return main === undefined ? [] : [main]') -and (-not (HasMarker $nudge 'listModels('))) $nudge

    # Session overview panel: Host routes (MCP / VCS) and the right-sidebar tab.
    $panelHost = Join-Path $profileDir 'node_modules\@local\dsh-session-panel\index.js'
    $panelClient = Join-Path $profileDir 'node_modules\@local\dsh-session-panel\client.js'
    Check 'session panel: host MCP + VCS routes' ((HasMarker $panelHost "/api/sessionPanel.mcp") -and (HasMarker $panelHost "/api/sessionPanel.vcs")) $panelHost
    Check 'session panel: right-sidebar tab + toggle' ((HasMarker $panelClient "'sidebar.right.pane.tab'") -and (HasMarker $panelClient "'conversation.session.header.utilities'")) $panelClient
    # 0.2.11-rc.20+: per-session free-text notes, stored in localStorage only.
    Check 'session panel: per-session notes' (HasMarker $panelClient 'dsh-session-panel:note:v1:') $panelClient

    # Session tracker (0.2.11-rc.12+): the panel binds the frozen sidebar hole and
    # the desktop attention bridge; both would stay silent if either half were lost.
    $trackerClient = Join-Path $profileDir 'node_modules\@local\dsh-session-tracker\client.js'
    Check 'session tracker: sidebar panel + attention bridge' ((HasMarker $trackerClient "'sidebar.tracker'") -and (HasMarker $trackerClient 'dshDesktop.attention')) $trackerClient

    # agent-desktop (0.2.11-rc.17+): the bundle must register the MCP client and the
    # vendored native exe must exist. A package missing the exe would still "install"
    # but the server would register 0 tools and fail on every call.
    $adPatch = Join-Path $profileDir 'node_modules\dsh-mcp-agent-desktop\cordis.patch.yml'
    Check 'agent-desktop: MCP client registered' ((HasMarker $adPatch 'serverName: agent-desktop') -and (HasMarker $adPatch 'agent-desktop-win32-x64.exe')) $adPatch
    Check 'agent-desktop: vendored native exe' (Test-Path (Join-Path $Tree 'vendor\agent-desktop\bin\agent-desktop-win32-x64.exe')) (Join-Path $Tree 'vendor\agent-desktop')

    # Codex computer-use (0.2.11-rc.21+): the bundle entry, the vendored Sky
    # helper and the nodeRepl shim must all survive. Without the shim's
    # `config: {}` every screenshot/AX call dies with "elicitations are
    # unavailable"; without the helper the server starts but lists zero apps.
    $cuaDir = Join-Path $profileDir 'node_modules\dsh-codex-cua'
    $cuaPatch = Join-Path $cuaDir 'cordis.patch.yml'
    $cuaServer = Join-Path $cuaDir 'mcp\server.mjs'
    Check 'codex-cua: MCP client registered' ((HasMarker $cuaPatch 'serverName: cua') -and (HasMarker $cuaPatch 'dsh-codex-cua')) $cuaPatch
    Check 'codex-cua: nodeRepl elicitation shim' ((HasMarker $cuaServer 'config: {}') -and (HasMarker $cuaServer 'createElicitation')) $cuaServer
    Check 'codex-cua: vendored Sky helper' (Test-Path (Join-Path $cuaDir 'vendor\@oai\sky\bin\windows\codex-computer-use.exe')) $cuaDir

    # billion-context (0.2.11-rc.19+): the bundle patch must mount the native plugin
    # and its compaction gate, and must stand the host auto-compaction row down —
    # losing any of the three brings back double compression or a preset boot hang.
    $biliPatch = Join-Path $profileDir 'node_modules\billion-context\dsh.bundle.patch.yml'
    Check 'billion-context: native plugin + gate inserted' ((HasMarker $biliPatch 'bili-native') -and (HasMarker $biliPatch 'bili-compaction-gate')) $biliPatch
    Check 'billion-context: host auto-compaction stood down' (HasMarker $biliPatch 'auto: false') $biliPatch
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
