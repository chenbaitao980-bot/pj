@echo off
setlocal
set NODE="C:\Users\Administrator\AppData\Local\Programs\DeepSeekHarnessFrozen\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
%NODE% "%~dp0usage-report.mjs" %*
pause
