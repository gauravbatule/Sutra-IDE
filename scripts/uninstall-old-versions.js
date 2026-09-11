import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

console.log('=== SUTRA IDE Deep Cleanup: Removing Old Versions ===\n');

const home = os.homedir();
const desktop = path.join(home, 'Desktop');
const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
const roamingAppData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
const startMenuPrograms = path.join(roamingAppData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');

// 1. Kill any running electron/sutra processes
try {
  console.log('[1/4] Terminating any stale SUTRA IDE processes...');
  execSync('taskkill /F /IM "SUTRA IDE.exe" /T', { stdio: 'ignore' });
} catch {}
try {
  execSync('taskkill /F /IM "electron.exe" /T', { stdio: 'ignore' });
} catch {}

// 2. Paths to uninstall/clean
const pathsToRemove = [
  // Old NSIS installation directory
  path.join(localAppData, 'Programs', 'SUTRA IDE'),
  path.join(localAppData, 'Programs', 'sutra-ide'),
  path.join(localAppData, 'sutra-ide-updater'),
  path.join(localAppData, 'sutra-ide'),
  path.join(localAppData, 'sutra_ide'),
  path.join(roamingAppData, 'sutra-ide'),
  path.join(roamingAppData, 'SUTRA IDE'),
  // Old Desktop setups & shortcuts
  path.join(desktop, 'SUTRA-IDE-Setup-1.0.0.exe'),
  path.join(desktop, 'SUTRA-IDE-Setup.exe'),
  path.join(desktop, 'SUTRA IDE.lnk'),
  path.join(desktop, 'Sutra IDE.lnk'),
  path.join(desktop, 'Setup-SUTRA-IDE.bat'),
  // Old Start Menu shortcuts
  path.join(startMenuPrograms, 'SUTRA IDE.lnk'),
  path.join(startMenuPrograms, 'Sutra IDE.lnk'),
  path.join(startMenuPrograms, 'SUTRA IDE'),
  path.join(startMenuPrograms, 'Sutra IDE'),
];

console.log('[2/4] Removing old installation folders and binaries...');
for (const p of pathsToRemove) {
  try {
    if (fs.existsSync(p)) {
      const stat = fs.lstatSync(p);
      if (stat.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
        console.log(`  ✓ Removed directory: ${p}`);
      } else {
        fs.unlinkSync(p);
        console.log(`  ✓ Removed file: ${p}`);
      }
    }
  } catch (err) {
    console.warn(`  ! Could not remove ${p}: ${err.message}`);
  }
}

// 3. Clean up Windows registry uninstall entries if present
console.log('[3/4] Cleaning up Windows registry entries...');
try {
  execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\sutra-ide" /f', { stdio: 'ignore' });
  console.log('  ✓ Cleaned HKCU Uninstall key');
} catch {}
try {
  execSync('reg delete "HKCU\\Software\\sutra-ide" /f', { stdio: 'ignore' });
  console.log('  ✓ Cleaned HKCU Software key');
} catch {}

console.log('\n[4/4] Clean uninstallation of old versions completed successfully!\n');
