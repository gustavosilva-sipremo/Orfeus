# Orfeus

Orfeus is a local music player for Linux and Windows. It plays files you already have on disk: import tracks or a folder, edit titles, covers, and lyrics, build playlists, and export a playlist as one `.orfeus` package. The stage can show the cover, a spectrum, and timed lyrics in any combination.

Paste a YouTube link from the library to save it as a 320 kbps MP3 from the best available audio. You choose whether to keep the video, which resolution to keep, and the folders for audio and video. If you do not keep the video, only the MP3 is stored. This step needs Python 3 and ffmpeg (`python` and `ffmpeg` on CachyOS).

## Run from source

From the project folder:

```bash
npm install
npm run tauri dev
```

That opens the desktop window with the Rust audio engine. The Vite page on its own is only a preview and cannot play your files.

## Installable build on CachyOS

CachyOS and Arch need the WebKit and GTK libraries Tauri uses, plus the usual build tools:

```bash
sudo pacman -S --needed webkit2gtk-4.1 gtk3 pkg-config file openssl python ffmpeg
```

Then install a launcher with the app icon:

```bash
./scripts/cachyos.sh
```

The script builds the release binary, copies it to `~/.local/bin/orfeus`, installs `src-tauri/app-icon.png` as the `orfeus` icon, and writes `~/.local/share/applications/orfeus.desktop`. After that, Orfeus shows up in the app menu and can be started with `orfeus`.

An AppImage is also written under `src-tauri/target/release/bundle/appimage/`. The bare binary is `src-tauri/target/release/orfeus`. On CachyOS the installed binary is the one to use: it does not need FUSE.

## Uninstall on CachyOS

Close Orfeus, then remove the launcher, the binary, and the icons that `scripts/cachyos.sh` installed for your user:

```bash
rm -f ~/.local/bin/orfeus
rm -f ~/.local/share/applications/orfeus.desktop
rm -f ~/.local/share/icons/hicolor/256x256/apps/orfeus.png
rm -f ~/.local/share/icons/hicolor/128x128/apps/orfeus.png
rm -f ~/.local/share/icons/hicolor/32x32/apps/orfeus.png
update-desktop-database ~/.local/share/applications
gtk-update-icon-cache -f ~/.local/share/icons/hicolor
```

That takes Orfeus out of the app menu. It does not delete your music files. Playlists, covers, lyrics, and the library database stay in `~/.local/share/app.orfeus.desktop`. Remove that folder only if you also want to erase the library data:

```bash
rm -rf ~/.local/share/app.orfeus.desktop
```

The AppImage and the release binary inside the project folder are build output. Delete `src-tauri/target` from the project if you want those gone too.

## Background

The default background is Peter Paul Rubens, *Orpheus and Eurydice*, 1636–1638.

Orfeus is released under the MIT license. See `LICENSE`.
