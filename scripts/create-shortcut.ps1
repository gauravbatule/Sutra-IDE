$ws = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "SUTRA IDE.lnk"
$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
$ico = Join-Path $rootDir "desktop\sutra.ico"
$target = Join-Path $rootDir "SUTRA-IDE.exe"
$workingDir = $rootDir

$s = $ws.CreateShortcut($shortcutPath)
$s.TargetPath = $target
$s.WorkingDirectory = $workingDir
$s.IconLocation = $ico
$s.Description = "SUTRA IDE - AI-Native Autonomous Studio"
$s.Save()

$startMenu = [System.Environment]::GetFolderPath('Programs')
$smPath = Join-Path $startMenu "SUTRA IDE.lnk"
$sm = $ws.CreateShortcut($smPath)
$sm.TargetPath = $target
$sm.WorkingDirectory = $workingDir
$sm.IconLocation = $ico
$sm.Description = "SUTRA IDE"
$sm.Save()

Write-Output "SUTRA IDE desktop & start menu shortcuts created successfully."
