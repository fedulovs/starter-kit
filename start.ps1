# Starts every service in the stack. Ctrl-C stops them all.
# PowerShell equivalent of start.sh, for Windows.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Die($message) {
    Write-Host ''
    Write-Error $message
    exit 1
}

# --- Java -------------------------------------------------------------------
# Any JDK 17 or newer works. The build targets Java 17 bytecode, so it does not
# matter if the JDK that compiles is newer than the one that runs.
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    Die "No 'java' on PATH. Install a JDK 17 or newer (https://adoptium.net) and try again."
}
$versionLine = (& java -version 2>&1)[0]
if ($versionLine -match 'version "(\d+)') {
    $javaMajor = [int]$Matches[1]
    if ($javaMajor -lt 17) {
        Die "Java $javaMajor found, but this needs 17 or newer. See https://adoptium.net"
    }
}

# --- Node -------------------------------------------------------------------
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Die @"
No 'npm' on PATH. Install Node 22 or newer (https://nodejs.org).
If you use nvm-windows or fnm, select a version in this shell first.
"@
}

# --- Dependencies -----------------------------------------------------------
if (-not (Test-Path 'storefront/node_modules')) {
    Write-Host 'Installing storefront dependencies (first run only)...'
    Push-Location storefront
    npm install --silent
    Pop-Location
}

Write-Host 'Building the Java services...'
& .\gradlew.bat installDist -q --console=plain

# --- Run --------------------------------------------------------------------
$procs = @()
try {
    $procs += Start-Process -FilePath '.\games\build\install\games\bin\games.bat' -NoNewWindow -PassThru
    $procs += Start-Process -FilePath '.\platform\build\install\platform\bin\platform.bat' -NoNewWindow -PassThru
    $procs += Start-Process -FilePath 'npm' -ArgumentList 'start' -WorkingDirectory 'storefront' -NoNewWindow -PassThru

    Write-Host ''
    Write-Host '  ---------------------------------------------'
    Write-Host '   Open the store:  http://localhost:3000'
    Write-Host '  ---------------------------------------------'
    Write-Host ''
    Write-Host '   platform API     http://localhost:4000'
    Write-Host '   game backends    http://localhost:4101-4104'
    Write-Host ''
    Write-Host '  Ctrl-C stops everything.'
    Write-Host ''

    Wait-Process -InputObject $procs
}
finally {
    foreach ($p in $procs) {
        if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
}
