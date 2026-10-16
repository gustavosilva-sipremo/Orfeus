$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm is required. Install Node.js, then run this script again."
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "cargo is required. Install Rust from https://rustup.rs, then run this script again."
}

npm install
npm run tauri build -- --bundles nsis

$bundle = Join-Path $root "src-tauri\target\release\bundle\nsis"
$setup = Get-ChildItem -Path $bundle -Filter "*-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $setup) {
    Write-Error "Build finished without a setup wizard in $bundle"
}

Write-Host ""
Write-Host "Setup wizard:"
Write-Host $setup.FullName
Write-Host ""
Write-Host "Double-click that .exe and follow the wizard."
Write-Host "Orfeus is then available from the Start menu."
Write-Host "To remove it later: .\scripts\uninstall-windows.ps1"
