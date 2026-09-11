$ErrorActionPreference = "Stop"
$appPath = "C:\Users\Gaurav Batule\AppData\Local\Programs\SUTRA IDE\resources\app"
$exePath = "C:\Users\Gaurav Batule\AppData\Local\Programs\SUTRA IDE"

Write-Output "Stopping any running SUTRA IDE instances..."
Get-Process | Where-Object { $_.Path -match 'SUTRA IDE' -or $_.CommandLine -match 'dist-server' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

Write-Output "Deploying to $appPath..."
if (Test-Path $appPath) {
    Copy-Item -Path "dist\*" -Destination "$appPath\dist" -Recurse -Force
    Copy-Item -Path "dist-server\*" -Destination "$appPath\dist-server" -Recurse -Force
    Copy-Item -Path "desktop\*" -Destination "$appPath\desktop" -Recurse -Force
    Copy-Item -Path "server\*" -Destination "$appPath\server" -Recurse -Force
    Copy-Item -Path "package.json" -Destination "$appPath\package.json" -Force
    Write-Output "Successfully updated resources/app!"
}

if (Test-Path $exePath) {
    Copy-Item -Path "SUTRA-IDE.exe" -Destination "$exePath\SUTRA IDE.exe" -Force
}

powershell -ExecutionPolicy Bypass -File 'scripts\refresh-shortcuts.ps1'

Write-Output "Launching fresh SUTRA IDE..."
Start-Process -FilePath "$exePath\SUTRA IDE.exe"
Start-Sleep -Seconds 3

Write-Output "Verification of port 3001:"
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess
