@echo off
rem Nhấp đúp để build lại API và deploy web lên Vercel (reader.ps1 -Restart -Publish).
rem Tham số thêm được chuyển tiếp, ví dụ: deploy.cmd -Port 8084
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%PATH%;%APPDATA%\npm"
where pwsh >/dev/null 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0reader.ps1" -Restart -Publish %*
) else (
  rem Chưa có PowerShell 7: reader.ps1 tự cài pwsh rồi chạy lại chính nó.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reader.ps1" -Restart -Publish %*
)
set "result=%errorlevel%"
echo.
if %result%==0 (echo Hoan tat: API da build lai va web da deploy.) else (echo That bai voi ma loi %result%. Xem thong bao phia tren.)
pause
exit /b %result%
