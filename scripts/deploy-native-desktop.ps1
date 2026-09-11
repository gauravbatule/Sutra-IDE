$desktop = [System.Environment]::GetFolderPath('Desktop')
$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
$installerSrc = Join-Path $rootDir "dist-exe\native\SUTRA-IDE-Setup-1.0.0.exe"
$installerDst = Join-Path $desktop "SUTRA-IDE-Setup-1.0.0.exe"

# Copy installer to desktop if present
if (Test-Path $installerSrc) {
    Copy-Item -Path $installerSrc -Destination $installerDst -Force
    Write-Output "Copied fresh installer to Desktop: $installerDst"
}

# Create/Update Desktop shortcut pointing directly to compiled SUTRA IDE.exe
$exePath = Join-Path $rootDir "SUTRA-IDE.exe"
$workingDir = $rootDir
$ico = Join-Path $rootDir "desktop\sutra.ico"

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut((Join-Path $desktop "SUTRA IDE.lnk"))
$s.TargetPath = $exePath
$s.WorkingDirectory = $workingDir
$s.IconLocation = $ico
$s.Description = "SUTRA IDE - Standalone AI Studio Desktop App"
$s.Save()

# Update Start Menu
$startMenu = [System.Environment]::GetFolderPath('Programs')
$sm = $ws.CreateShortcut((Join-Path $startMenu "SUTRA IDE.lnk"))
$sm.TargetPath = $exePath
$sm.WorkingDirectory = $workingDir
$sm.IconLocation = $ico
$sm.Description = "SUTRA IDE"
$sm.Save()

Write-Output "Native standalone desktop application shortcut deployed to Desktop and Start Menu."
