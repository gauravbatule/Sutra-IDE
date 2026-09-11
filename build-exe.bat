@echo off
title Build SUTRA Windows Launcher
echo Building SUTRA IDE for Windows...
cd /d "%~dp0"
call npm run build
node scripts/package-exe.js
echo.
echo Build complete! Executable launcher available at dist-exe/SUTRA-IDE.bat
pause
