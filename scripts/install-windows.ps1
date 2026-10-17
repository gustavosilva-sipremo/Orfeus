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

$cache = Join-Path $root "src-tauri\windows\cache"
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$commit = "debcbef44b0abbb192bd5c2e14838803fc7d2773"
$exe = Join-Path $cache "xorriso.exe"
$expected = "579A3C15445F2BE105AC217E65A9B9884C22C3466C74D83D4159CED27A21C7A3"
$have = ""
if (Test-Path $exe) {
    $have = (Get-FileHash -Algorithm SHA256 $exe).Hash
}
if ($have -ne $expected) {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/rhaslund/xorriso-windows/$commit/xorriso/xorriso.exe" -OutFile $exe
    $have = (Get-FileHash -Algorithm SHA256 $exe).Hash
    if ($have -ne $expected) {
        Write-Error "xorriso.exe checksum does not match the pinned Windows build."
    }
}
$gpl = Join-Path $cache "xorriso-GPL-3.0.txt"
if (-not (Test-Path $gpl)) {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/rhaslund/xorriso-windows/$commit/OpenSource/Licenses/GPL-3.0.txt" -OutFile $gpl
}

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
