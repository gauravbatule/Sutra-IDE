$ErrorActionPreference = "Stop"
$installDir = "C:\Users\Gaurav Batule\AppData\Local\Programs\SUTRA IDE"
$appDir = "$installDir\resources\app"

Write-Output "[1/3] Terminating existing SUTRA IDE and server processes..."
Get-Process -Name 'SUTRA IDE', 'electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Output "[2/3] Syncing latest compiled assets to resources/app..."
Copy-Item -Path "dist\*" -Destination "$appDir\dist" -Recurse -Force
Copy-Item -Path "dist-server\*" -Destination "$appDir\dist-server" -Recurse -Force
Copy-Item -Path "desktop\*" -Destination "$appDir\desktop" -Recurse -Force
Copy-Item -Path "server\*" -Destination "$appDir\server" -Recurse -Force
Copy-Item -Path "package.json" -Destination "$appDir\package.json" -Force

Write-Output "[3/3] Starting SUTRA IDE..."
Start-Process -FilePath "$installDir\SUTRA IDE.exe"
Start-Sleep -Seconds 4

Write-Output "Checking active port listeners:"
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -ge 3001 -and $_.LocalPort -le 3006 } | Select-Object LocalAddress, LocalPort, OwningProcess
