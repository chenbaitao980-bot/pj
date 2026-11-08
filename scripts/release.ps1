#requires -Version 5.1
<#
  Release bookkeeping for the DeepSeek Harness frozen build.

  Rule (this repo's convention): never overwrite a shipped version. Before any
  change to the frozen payload, snapshot the pieces that will be edited, then
  rebuild with a bumped -Version. The previous Setup.exe and its .sha256 stay
  in the repo root, and the snapshot stays under backup-frozen-<oldver>-<stamp>.

  Actions:
    status    Show installed / payload / shipped versions and existing backups.
    snapshot  Copy the given paths into backup-frozen-<ver>-<stamp> with a
              per-file SHA-256 manifest. Refuses to overwrite an existing one.
    bump      Stamp a new version into the payload (app manifest, dsh runtime
              manifest, FROZEN-BUILD.json) before rebuilding. Refuses a version
              whose Setup.exe is already shipped. Add -Dry to preview.

  Examples:
    powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Action status
    powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Action snapshot `
      -Version 0.2.2-rc.1 `
      -Include "C:\Users\Administrator\AppData\Local\Programs\DeepSeekHarnessFrozen\resources\app\dsh\node_modules\@deepseek-ai\dsh-client-ui-conversation\lib\client.js"
    powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Action bump -Version 0.2.3-rc.1
#>
[CmdletBinding()]
param(
    [ValidateSet('status', 'snapshot', 'bump')]
    [string]$Action = 'status',

    [string]$Version = '',
    [string[]]$Include = @(),
    [switch]$Dry,

    [string]$InstallRoot = 'C:\Users\Administrator\AppData\Local\Programs\DeepSeekHarnessFrozen',
    [string]$PayloadRoot = 'D:\dsh-freeze-new\payload',
    [string]$Repo = 'E:\claude\project4\pj'
)

$ErrorActionPreference = 'Stop'

function Fail([string]$message) {
    Write-Host "FAIL  $message" -ForegroundColor Red
    exit 1
}

function ReadJson([string]$path) {
    if (-not (Test-Path $path)) { return $null }
    try { return (Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Get-Sha256([string]$path) {
    if (-not (Test-Path $path -PathType Leaf)) { return $null }
    return (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Show-Status {
    $installedPkg = ReadJson (Join-Path $InstallRoot 'resources\app\package.json')
    $installedDsh = ReadJson (Join-Path $InstallRoot 'resources\app\dsh\package.json')
    $payloadAppPkg = ReadJson (Join-Path $PayloadRoot 'resources\app\package.json')
    $payloadManifest = ReadJson (Join-Path $PayloadRoot 'FROZEN-BUILD.json')

    Write-Host '== installed ==' -ForegroundColor Cyan
    Write-Host ("  root        {0}" -f $InstallRoot)
    Write-Host ("  desktop     {0}" -f ($(if ($installedPkg) { $installedPkg.version } else { '<missing>' })))
    Write-Host ("  dsh runtime {0}" -f ($(if ($installedDsh) { $installedDsh.version } else { '<missing>' })))

    Write-Host '== payload ==' -ForegroundColor Cyan
    Write-Host ("  root        {0}" -f $PayloadRoot)
    Write-Host ("  desktop     {0}" -f ($(if ($payloadAppPkg) { $payloadAppPkg.version } else { '<missing>' })))
    Write-Host ("  frozen      {0}" -f ($(if ($payloadManifest) { $payloadManifest.version } else { '<missing>' })))
    if ($payloadManifest) {
        Write-Host ("  builtAt     {0}" -f $payloadManifest.builtAt)
        Write-Host ("  upstream    {0}" -f $payloadManifest.upstream.commit)
    }

    Write-Host '== shipped setups (repo root) ==' -ForegroundColor Cyan
    Get-ChildItem $Repo -File -Filter 'DeepSeek-Harness-Frozen-Setup*.exe' -ErrorAction SilentlyContinue |
        Sort-Object Name |
        ForEach-Object {
            $shaFile = "$($_.FullName).sha256"
            $expected = if (Test-Path $shaFile) { ((Get-Content $shaFile -Raw) -split '\s+')[0].ToLowerInvariant() } else { $null }
            $actual = Get-Sha256 $_.FullName
            $match = if ($expected -and $actual) { if ($expected -eq $actual) { 'sha OK' } else { 'sha MISMATCH' } } else { 'no sha' }
            Write-Host ("  {0,-46} {1,8} MB  {2}" -f $_.Name, [math]::Round($_.Length / 1MB, 1), $match)
        }

    Write-Host '== backups ==' -ForegroundColor Cyan
    $backups = Get-ChildItem $Repo -Directory -Filter 'backup-frozen-*' -ErrorAction SilentlyContinue | Sort-Object Name
    if (-not $backups) { Write-Host '  (none)' }
    foreach ($b in $backups) {
        $stat = Get-ChildItem $b.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum
        Write-Host ("  {0,-52} {1,6} files {2,8} MB" -f $b.Name, $stat.Count, [math]::Round($stat.Sum / 1MB, 1))
    }
}

function New-Snapshot {
    if (-not $Version) { Fail '-Version is required for -Action snapshot (the version being replaced).' }
    if ($Include.Count -eq 0) { Fail '-Include must list at least one path to snapshot.' }

    $missing = $Include | Where-Object { -not (Test-Path $_) }
    if ($missing) { Fail ("path not found: " + ($missing -join '; ')) }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dir = Join-Path $Repo ("backup-frozen-{0}-{1}" -f $Version, $stamp)
    if (Test-Path $dir) { Fail "snapshot already exists: $dir" }
    New-Item -ItemType Directory -Path $dir | Out-Null

    $rows = @()
    foreach ($item in $Include) {
        $full = [IO.Path]::GetFullPath($item)
        $leaf = Split-Path $full -Leaf
        # Prefix the owning package folder so two packages' client.js cannot collide.
        $parent = Split-Path $full -Parent
        $owner = if ($parent) { Split-Path (Split-Path $parent -Parent) -Leaf } else { '' }
        $storedName = if ($owner) { '{0}--{1}' -f $owner, $leaf } else { $leaf }
        $dest = Join-Path $dir $storedName
        $n = 1
        while (Test-Path $dest) {
            $n++
            $dest = Join-Path $dir ("{0}.{1}" -f $storedName, $n)
        }

        if (Test-Path $full -PathType Container) {
            Copy-Item $full $dest -Recurse -Force
            $stat = Get-ChildItem $dest -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum
            $rows += [pscustomobject]@{
                source = $full
                stored = (Split-Path $dest -Leaf)
                kind   = 'directory'
                files  = [int]$stat.Count
                bytes  = [long]$stat.Sum
                sha256 = $null
            }
        }
        else {
            Copy-Item $full $dest -Force
            $f = Get-Item $dest
            $rows += [pscustomobject]@{
                source = $full
                stored = (Split-Path $dest -Leaf)
                kind   = 'file'
                files  = 1
                bytes  = [long]$f.Length
                sha256 = (Get-Sha256 $dest)
            }
        }
    }

    $manifest = [pscustomobject]@{
        version   = $Version
        createdAt = (Get-Date).ToString('o')
        install   = $InstallRoot
        payload   = $PayloadRoot
        entries   = $rows
    }
    $manifestPath = Join-Path $dir 'SNAPSHOT.json'
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8

    $totalFiles = ($rows | Measure-Object files -Sum).Sum
    $totalBytes = ($rows | Measure-Object bytes -Sum).Sum
    Write-Host ("snapshot  {0}" -f $dir) -ForegroundColor Green
    Write-Host ("          {0} entries, {1} files, {2} MB" -f $rows.Count, $totalFiles, [math]::Round($totalBytes / 1MB, 1))
    foreach ($r in $rows) { Write-Host ("          {0,-10} {1}" -f $r.kind, $r.stored) }
    Write-Host ("          manifest {0}" -f $manifestPath)
}

function Set-Version {
    if (-not $Version) { Fail '-Version is required for -Action bump.' }
    $shipped = Join-Path $Repo ("DeepSeek-Harness-Frozen-Setup-{0}.exe" -f $Version)
    if (Test-Path $shipped) { Fail "version already shipped: $shipped" }

    $targets = @(
        @{ path = (Join-Path $PayloadRoot 'resources\app\package.json'); label = 'app' },
        @{ path = (Join-Path $PayloadRoot 'resources\app\dsh\package.json'); label = 'dsh runtime' },
        @{ path = (Join-Path $PayloadRoot 'FROZEN-BUILD.json'); label = 'frozen manifest' }
    )

    $stamp = (Get-Date).ToString('o')
    foreach ($t in $targets) {
        if (-not (Test-Path $t.path)) { Fail ("missing " + $t.path) }
        $raw = Get-Content $t.path -Raw -Encoding UTF8
        $obj = $raw | ConvertFrom-Json
        $before = $obj.version
        $obj.version = $Version
        if ($t.label -eq 'frozen manifest') { $obj.builtAt = $stamp }
        $json = $obj | ConvertTo-Json -Depth 12
        if ($Dry) {
            Write-Host ("dry      {0,-16} {1} -> {2}" -f $t.label, $before, $Version)
        }
        else {
            Set-Content -Path $t.path -Value $json -Encoding UTF8
            Write-Host ("bump     {0,-16} {1} -> {2}" -f $t.label, $before, $Version)
        }
    }

    if (-not $Dry) {
        Write-Host ""
        Write-Host ("next     powershell -ExecutionPolicy Bypass -File frozen-build-src\Build-FrozenSetup.ps1 -PayloadRoot {0} -Version {1} -OutDir {2}" -f $PayloadRoot, $Version, $Repo) -ForegroundColor Cyan
    }
}


switch ($Action) {
    'status' { Show-Status }
    'snapshot' { New-Snapshot }
    'bump' { Set-Version }
}
