@echo off
set "PATH=%PATH%;%APPDATA%\npm"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-reader-home.ps1" -Restart -Publish
set "result=%errorlevel%"
pause
exit /b %result%
