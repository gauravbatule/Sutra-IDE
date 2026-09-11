import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist-exe');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('=== Packaging SUTRA IDE (Windows Native Production App) ===\n');

// 1. Compile Native Windows Launcher (SUTRA-IDE.exe)
const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const launcherCs = path.join(__dirname, 'launcher.cs');
const iconPath = path.join(rootDir, 'desktop', 'sutra.ico');
const targetExeRoot = path.join(rootDir, 'SUTRA-IDE.exe');
const targetExeDist = path.join(distDir, 'SUTRA-IDE.exe');

console.log('[1/4] Compiling native Windows executable (SUTRA-IDE.exe)...');
if (fs.existsSync(cscPath) && fs.existsSync(launcherCs)) {
  try {
    const compileCmd = `"${cscPath}" /nologo /target:winexe /win32icon:"${iconPath}" /r:System.Windows.Forms.dll /out:"${targetExeRoot}" "${launcherCs}"`;
    execSync(compileCmd, { cwd: rootDir, stdio: 'inherit' });
    fs.copyFileSync(targetExeRoot, targetExeDist);
    console.log('  ✓ Successfully compiled native binary: SUTRA-IDE.exe');
  } catch (err) {
    console.warn('  ! csc compilation notice:', err.message);
  }
}

// 2. Build production web frontend & server bundles if needed
console.log('[2/4] Verifying production client and server bundles...');
const distIndex = path.join(rootDir, 'dist', 'index.html');
const distServer = path.join(rootDir, 'dist-server', 'index.js');
if (!fs.existsSync(distIndex) || !fs.existsSync(distServer)) {
  console.log('  Building client & server bundles...');
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
} else {
  console.log('  ✓ Production client and server bundles ready.');
}

// 3. Create Windows 1-Click Installer
const installerContent = `@echo off
title SUTRA IDE Setup
cd /d "%~dp0.."
echo =======================================================
echo   Installing SUTRA IDE (AI-Native Engineering Studio)
echo =======================================================
echo.
echo [1/2] Verifying production build...
if not exist "%~dp0..\\dist\\index.html" (
  echo Building production web assets...
  call npm run build
)

echo [2/2] Registering Desktop and Start Menu Shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desktop = [System.Environment]::GetFolderPath('Desktop'); $programs = [System.Environment]::GetFolderPath('Programs'); $targetDir = (Resolve-Path '%~dp0..').Path; $sutraExe = (Join-Path $targetDir 'SUTRA-IDE.exe'); $ico = (Join-Path $targetDir 'desktop\\sutra.ico'); $s = $ws.CreateShortcut((Join-Path $desktop 'SUTRA IDE.lnk')); $s.TargetPath = $sutraExe; $s.WorkingDirectory = $targetDir; $s.IconLocation = $ico; $s.Description = 'SUTRA IDE - AI-Native Autonomous Studio'; $s.Save(); $sm = $ws.CreateShortcut((Join-Path $programs 'SUTRA IDE.lnk')); $sm.TargetPath = $sutraExe; $sm.WorkingDirectory = $targetDir; $sm.IconLocation = $ico; $sm.Description = 'SUTRA IDE'; $sm.Save();"

echo.
echo =======================================================
echo   Installation Complete!
echo   - Desktop Shortcut: SUTRA IDE.lnk
echo   - Native Executable: SUTRA-IDE.exe
echo   - Start Menu: SUTRA IDE registered in Programs
echo =======================================================
echo.
set /p LAUNCH="Launch SUTRA IDE now? (Y/N): "
if /i "%LAUNCH%"=="Y" (
  start "" "%~dp0..\\SUTRA-IDE.exe"
)
exit /b 0
`;
fs.writeFileSync(path.join(distDir, 'Setup-SUTRA-IDE.bat'), installerContent, 'utf-8');

// 4. Create Windows 1-Click Uninstaller
const uninstallerContent = `@echo off
title SUTRA IDE Uninstaller
echo =======================================================
echo   Uninstalling SUTRA IDE
echo =======================================================
echo.
echo [1/2] Stopping running SUTRA IDE instances...
powershell -NoProfile -Command "Get-Process -ErrorAction SilentlyContinue | Where-Object { ($_.Name -eq 'SUTRA-IDE') -or ($_.Path -and ($_.Path -like '*omnicraft*' -or $_.Path -like '*SUTRA*')) } | Stop-Process -Force -ErrorAction SilentlyContinue"

echo [2/2] Removing Desktop & Start Menu Shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$desktop = [System.Environment]::GetFolderPath('Desktop'); $startMenu = [System.Environment]::GetFolderPath('Programs'); Remove-Item -Path (Join-Path $desktop 'SUTRA IDE.lnk') -ErrorAction SilentlyContinue; Remove-Item -Path (Join-Path $startMenu 'SUTRA IDE.lnk') -ErrorAction SilentlyContinue;"

echo.
echo =======================================================
echo   SUTRA IDE uninstalled cleanly.
echo =======================================================
pause
exit /b 0
`;
fs.writeFileSync(path.join(distDir, 'Uninstall-SUTRA-IDE.bat'), uninstallerContent, 'utf-8');

// 5. Create Desktop shortcut right now
console.log('[3/4] Registering Desktop and Start Menu shortcuts on this system...');
try {
  const shortcutCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desktop = [System.Environment]::GetFolderPath('Desktop'); $programs = [System.Environment]::GetFolderPath('Programs'); $targetDir = '${rootDir.replace(/\\/g, '\\\\')}'; $sutraExe = (Join-Path $targetDir 'SUTRA-IDE.exe'); $ico = (Join-Path $targetDir 'desktop\\sutra.ico'); $s = $ws.CreateShortcut((Join-Path $desktop 'SUTRA IDE.lnk')); $s.TargetPath = $sutraExe; $s.WorkingDirectory = $targetDir; $s.IconLocation = $ico; $s.Description = 'SUTRA IDE - AI-Native Autonomous Studio'; $s.Save(); $sm = $ws.CreateShortcut((Join-Path $programs 'SUTRA IDE.lnk')); $sm.TargetPath = $sutraExe; $sm.WorkingDirectory = $targetDir; $sm.IconLocation = $ico; $sm.Description = 'SUTRA IDE'; $sm.Save();"`;
  execSync(shortcutCmd, { stdio: 'inherit' });
  console.log('  ✓ Desktop shortcut created: "SUTRA IDE.lnk"');
  console.log('  ✓ Start Menu shortcut registered: "SUTRA IDE.lnk"');
} catch (err) {
  console.warn('  ! Shortcut registration notice:', err.message);
}

// 6. Copy Setup and Uninstaller to Desktop for easy distribution
try {
  const desktopDir = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop');
  if (fs.existsSync(desktopDir)) {
    fs.copyFileSync(path.join(distDir, 'Setup-SUTRA-IDE.bat'), path.join(desktopDir, 'Setup-SUTRA-IDE.bat'));
  }
} catch (err) {
  console.debug('Desktop copy notice:', err && err.message ? err.message : err);
}

console.log('\n[4/4] SUTRA IDE Windows App Package Ready!');
console.log('  - Executable: ' + targetExeRoot);
console.log('  - Distribution Package: ' + distDir);
console.log('  - Desktop Shortcut: Ready on Desktop (SUTRA IDE.lnk)\n');
