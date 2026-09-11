$ws = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')
$programs = [System.Environment]::GetFolderPath('Programs')
$exePath = "C:\Users\Gaurav Batule\.gemini\antigravity\scratch\omnicraft-ide\SUTRA-IDE.exe"
$workDir = "C:\Users\Gaurav Batule\.gemini\antigravity\scratch\omnicraft-ide"
$ico = "C:\Users\Gaurav Batule\.gemini\antigravity\scratch\omnicraft-ide\desktop\sutra.ico"

$s = $ws.CreateShortcut((Join-Path $desktop "SUTRA IDE.lnk"))
$s.TargetPath = $exePath
$s.WorkingDirectory = $workDir
$s.IconLocation = $ico
$s.Description = "SUTRA IDE - AI-Native Autonomous Studio"
$s.Save()

$sm = $ws.CreateShortcut((Join-Path $programs "SUTRA IDE.lnk"))
$sm.TargetPath = $exePath
$sm.WorkingDirectory = $workDir
$sm.IconLocation = $ico
$sm.Description = "SUTRA IDE"
$sm.Save()

Write-Output "Direct native shortcuts registered successfully."
