@echo off
chcp 65001 >nul
cd /d "%~dp0"
set DSH_HOME=%~dp0.dsh
if exist "%~dp0desktop-app\dsh-desktop-windowos.exe" (
  echo Starting DeepSeek Harness desktop shell ...
  start "" "%~dp0desktop-app\dsh-desktop-windowos.exe"
) else (
  echo Desktop exe not found in .\desktop-app\
  echo Run 启动-Web版.cmd first; the desktop plugin downloads it automatically.
  pause
)
