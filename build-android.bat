@echo off
rem Double-click to build Darbna.apk. See build-android.ps1 for what it does.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-android.ps1" %*
echo.
type "%~dp0build-status.txt"
echo.
pause
