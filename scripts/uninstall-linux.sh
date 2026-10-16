#!/usr/bin/env bash
set -euo pipefail

remove_data=0
if [[ "${1:-}" == "--data" ]]; then
  remove_data=1
elif [[ -n "${1:-}" ]]; then
  echo "Usage: ./scripts/uninstall-linux.sh [--data]" >&2
  exit 1
fi

rm -f "$HOME/.local/bin/orfeus"
rm -rf "$HOME/.local/lib/orfeus"
rm -f "$HOME/.local/share/applications/orfeus.desktop"
rm -f "$HOME/.local/share/icons/hicolor/256x256/apps/orfeus.png"
rm -f "$HOME/.local/share/icons/hicolor/128x128/apps/orfeus.png"
rm -f "$HOME/.local/share/icons/hicolor/32x32/apps/orfeus.png"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f "$HOME/.local/share/icons/hicolor" || true
fi

if [[ "$remove_data" -eq 1 ]]; then
  rm -rf "$HOME/.local/share/app.orfeus.desktop"
  echo "Orfeus and its library data were removed."
else
  echo "Orfeus was removed from the app menu."
  echo "Playlists, covers, and the library database are still in ~/.local/share/app.orfeus.desktop"
  echo "Run ./scripts/uninstall-linux.sh --data to remove that folder too. Music files elsewhere are left in place."
fi
