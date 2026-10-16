param(
    [switch]$Data
)

$ErrorActionPreference = "Stop"

$roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

$apps = foreach ($root in $roots) {
    $parent = Split-Path $root -Parent
    if (Test-Path $parent) {
        Get-ItemProperty $root -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq "Orfeus" }
    }
}

if (-not $apps) {
    Write-Error "Orfeus is not listed in Installed apps. If it was never installed, there is nothing to remove."
}

foreach ($app in $apps) {
    $command = $app.QuietUninstallString
    if (-not $command) { $command = $app.UninstallString }
    if (-not $command) { continue }
    Write-Host "Removing $($app.DisplayName)..."
    if ($command -match '^\s*"([^"]+)"\s*(.*)$' -or $command -match '^\s*(\S+\.exe)\s*(.*)$') {
        $exe = $Matches[1]
        $rest = $Matches[2].Trim()
        $args = @()
        if ($rest) { $args += $rest.Split(" ") }
        if ($args -notcontains "/S") { $args += "/S" }
        $proc = Start-Process -FilePath $exe -ArgumentList $args -Wait -PassThru
        if ($proc.ExitCode -ne 0) {
            Write-Error "The uninstaller exited with code $($proc.ExitCode)."
        }
    } else {
        Write-Error "Could not read the uninstaller command: $command"
    }
}

if ($Data) {
    $library = Join-Path $env:APPDATA "app.orfeus.desktop"
    if (Test-Path $library) {
        Remove-Item -Recurse -Force $library
        Write-Host "Library data removed from $library"
    }
    Write-Host "Orfeus and its library data were removed."
} else {
    Write-Host "Orfeus was removed from Installed apps."
    Write-Host "Playlists, covers, and the library database are still in $env:APPDATA\app.orfeus.desktop"
    Write-Host "Run .\scripts\uninstall-windows.ps1 -Data to remove that folder too. Music files elsewhere are left in place."
}
