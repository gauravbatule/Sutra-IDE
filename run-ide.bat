@echo off
title SUTRA IDE - Autonomous AI Studio
echo ============================================================
echo  Starting SUTRA IDE...
echo ============================================================

cd /d "%~dp0"

echo [1/3] Launching backend server on port 3001...
start "SUTRA Server" /min cmd /c "npx tsx server/index.ts"

echo [2/3] Waiting for the server to come online...
set /a tries=0
:waitloop
set READY=0
for /f %%i in ('powershell -NoProfile -Command "try{ if((Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:3001/health).StatusCode -eq 200){'1'}else{'0'} }catch{'0'}"') do set READY=%%i
if "%READY%"=="1" goto ready
set /a tries+=1
if %tries% geq 90 (
  echo [ERROR] Server did not start within 90 seconds. Check that port 3001 is free.
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto waitloop

:ready
echo [3/3] Server is up - opening SUTRA IDE...
start msedge --app=http://localhost:3001 || start chrome --app=http://localhost:3001 || start http://localhost:3001

echo ============================================================
echo SUTRA IDE is running at http://localhost:3001
echo Phone Connect: see the mobile URL printed by the server
echo ============================================================
pause
