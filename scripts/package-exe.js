import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist-exe');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Windows launcher: boots the local server, waits until it is actually
// listening (health poll), and only then opens the app window — so the user
// never lands on a connection-error or blank page.
const makeLauncher = (cdLine) => `@echo off
title SUTRA IDE
${cdLine}
echo Starting SUTRA IDE...
start "SUTRA Server" /min cmd /c "npm run start"
set /a tries=0
:waitloop
set READY=0
for /f %%i in ('powershell -NoProfile -Command "try{ if((Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:3001/health).StatusCode -eq 200){'1'}else{'0'} }catch{'0'}"') do set READY=%%i
if "%READY%"=="1" goto ready
set /a tries+=1
if %tries% geq 90 (
  echo [ERROR] SUTRA IDE server did not start within 90 seconds.
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto waitloop
:ready
start msedge --app=http://localhost:3001 || start http://localhost:3001
exit
`;

// dist-exe copy: the project root is one level up from dist-exe/
fs.writeFileSync(path.join(distDir, 'SUTRA-IDE.bat'), makeLauncher('cd /d "%~dp0.."'), 'utf-8');

// stage copy: this folder IS the distributable project root
const stageDir = path.join(distDir, 'stage');
if (fs.existsSync(stageDir)) {
  fs.writeFileSync(path.join(stageDir, 'SUTRA-IDE.bat'), makeLauncher('cd /d "%~dp0"'), 'utf-8');
  console.log('✅ Stage launcher updated in dist-exe/stage/SUTRA-IDE.bat');
}
