@echo off
setlocal
cd /d "%~dp0"

rem Reuse the existing local server if it is already running.
powershell.exe -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8766/' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    start "Arish portfolio server" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1"
    timeout /t 3 /nobreak >nul
)

start "" "http://127.0.0.1:8766/"
endlocal
