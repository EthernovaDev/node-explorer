@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1"

echo.
echo If nothing opened, check the logs folder and config files.
pause
