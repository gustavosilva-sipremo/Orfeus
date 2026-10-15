#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js, then run this script again." >&2
  exit 1
fi

npm install
npm run tauri build -- --bundles appimage

binary="$root/src-tauri/target/release/orfeus"
icon="$root/src-tauri/app-icon.png"
if [[ ! -x "$binary" && ! -f "$binary" ]]; then
  echo "Build finished without $binary" >&2
  exit 1
fi
if [[ ! -f "$icon" ]]; then
  echo "Missing $icon" >&2
  exit 1
fi

install -Dm755 "$binary" "$HOME/.local/bin/orfeus"
install -Dm644 "$icon" "$HOME/.local/share/icons/hicolor/256x256/apps/orfeus.png"
if [[ -f "$root/src-tauri/icons/128x128.png" ]]; then
  install -Dm644 "$root/src-tauri/icons/128x128.png" "$HOME/.local/share/icons/hicolor/128x128/apps/orfeus.png"
fi
if [[ -f "$root/src-tauri/icons/32x32.png" ]]; then
  install -Dm644 "$root/src-tauri/icons/32x32.png" "$HOME/.local/share/icons/hicolor/32x32/apps/orfeus.png"
fi

mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/orfeus.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Orfeus
Comment=Local music player
Exec=$HOME/.local/bin/orfeus
Icon=orfeus
Terminal=false
Categories=Audio;AudioVideo;Player;
StartupWMClass=app.orfeus.desktop
EOF

chmod +x "$HOME/.local/bin/orfeus" "$HOME/.local/share/applications/orfeus.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f "$HOME/.local/share/icons/hicolor" || true
fi

echo "Orfeus is installed at ~/.local/bin/orfeus"
echo "Open it from the app menu, or run: orfeus"
