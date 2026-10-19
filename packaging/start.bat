@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20+ is required: https://nodejs.org & pause & exit /b 1)
where cloudflared >nul 2>nul || echo WARNING: cloudflared not found on PATH - tunnels will fail to start.
if not defined PORT set PORT=3050
start "" http://localhost:%PORT%
node src\index.js
pause
