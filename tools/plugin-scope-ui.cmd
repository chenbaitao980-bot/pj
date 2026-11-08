@echo off
setlocal
set NODE=%~dp0..\resources\runtime\primary-runtime\dependencies\node\bin\node.exe
if not exist "%NODE%" set NODE=node
"%NODE%" "%~dp0plugin-scope-ui.mjs" %*