@echo off
rem Double-click to run the Darbna API server on this PC (testing only). See start-server.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
echo.
type "%~dp0server-status.txt"
echo.
pause
