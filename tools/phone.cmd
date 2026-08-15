@echo off
REM Serve the app to your phone over Tailscale (tailnet only - not the public
REM internet). Double-click this, then open the https URL it prints.
setlocal
cd /d "%~dp0.."

set TS=tailscale
where tailscale >nul 2>&1 || set TS="C:\Program Files\Tailscale\tailscale.exe"

echo Starting the app on http://localhost:8123 ...
start "Rubik's Cube Coach server" /min node tools\serve.js

REM Give the server a moment before Tailscale proxies to it
timeout /t 2 /nobreak >nul

echo.
echo Putting Tailscale Serve in front of it ...
%TS% serve --bg 8123
echo.
%TS% serve status
echo.
echo Open that https address on your phone. Tailscale must be running and
echo signed into the same account there.
echo.
echo To stop sharing later:  %TS% serve --https=443 off
echo.
pause
