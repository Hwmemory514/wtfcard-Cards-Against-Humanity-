@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\first-run-setup.ps1"
set "SETUP_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %SETUP_EXIT_CODE%
