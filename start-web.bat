@echo off
title WinGo TimesFM 3 Intelligence Center
echo =======================================================
echo   WinGo TimesFM 3 Live Multi-Model Web Platform
echo   Launching server on http://localhost:8080 ...
echo =======================================================

timeout /t 2 /nobreak >nul
start "" http://localhost:8080

"C:\Users\Gaurav Batule\AppData\Local\Programs\Python\Python313\python.exe" wingo-predictor-web\server.py
pause
