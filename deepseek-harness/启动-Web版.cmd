@echo off
chcp 65001 >nul
cd /d "%~dp0"
set DSH_HOME=%~dp0.dsh
echo Starting DeepSeek Harness (Web) ...
echo   DSH_HOME = %DSH_HOME%
echo   Model    = OpenCode Go / deepseek-v4.1-flash
echo.
call "%~dp0node_modules\.bin\dsh.cmd" web --port 3080
pause
