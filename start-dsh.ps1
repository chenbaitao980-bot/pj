# DSH 一键安装：启动 web 服务
# 用法：在 PowerShell 里执行  .\启动-DSH.ps1

$ErrorActionPreference = 'Stop'
$Root    = 'E:\claude\project4\pj'
$DshRoot = Join-Path $Root 'deepseek-harness'
$DshHome = Join-Path $DshRoot '.dsh'
$Dsh     = Join-Path $DshRoot 'node_modules\.bin\dsh.cmd'

if (-not (Test-Path $Dsh)) {
    Write-Host "找不到 $Dsh" -ForegroundColor Red
    Write-Host "先在 $DshRoot 执行：npm install @deepseek-ai/dsh@0.2.1-rc.2"
    exit 1
}

$env:DSH_HOME = $DshHome
Write-Host "DSH_HOME = $env:DSH_HOME" -ForegroundColor Cyan
Write-Host "启动 dsh web（浏览器会自动打开）..." -ForegroundColor Cyan

& $Dsh web
