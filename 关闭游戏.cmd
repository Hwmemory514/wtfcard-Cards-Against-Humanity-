@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-game.ps1"
set "GAME_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %GAME_EXIT_CODE%
