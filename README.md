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

## Install on Linux

From the project folder, on most desktop distros:

```bash
./scripts/install-linux.sh
```

The script builds an AppImage and installs it for the current user. The launcher is `~/.local/bin/orfeus`. It sets `APPIMAGE_EXTRACT_AND_RUN`, so the app starts without FUSE and without installing system packages for each distro. Orfeus then appears in the app menu.

Building still needs Node.js, Rust, and the WebKit libraries used by Tauri. On CachyOS or Arch:

```bash
sudo pacman -S --needed webkit2gtk-4.1 gtk3 pkg-config file openssl python ffmpeg
```

`scripts/cachyos.sh` is the same build, but it installs the native release binary instead of the AppImage. Use that on CachyOS when you already have those libraries.

Burning a CD or DVD from the app needs `xorriso` and, for an audio CD, `ffmpeg`. Listing the drive needs `lsblk`.

## Uninstall on Linux

Close Orfeus, then from the project folder:

```bash
./scripts/uninstall-linux.sh
```

That removes the launcher installed by `scripts/install-linux.sh` or `scripts/cachyos.sh`:

- `~/.local/bin/orfeus`
- `~/.local/lib/orfeus` (the AppImage)
- `~/.local/share/applications/orfeus.desktop`
- the `orfeus` icons under `~/.local/share/icons/hicolor`

It does not delete your music files. Playlists, covers, lyrics, and the library database stay in `~/.local/share/app.orfeus.desktop`. To remove the program and that library data together:

```bash
./scripts/uninstall-linux.sh --data
```

The same files can be removed by hand:

```bash
rm -f ~/.local/bin/orfeus
rm -rf ~/.local/lib/orfeus
rm -f ~/.local/share/applications/orfeus.desktop
rm -f ~/.local/share/icons/hicolor/256x256/apps/orfeus.png
rm -f ~/.local/share/icons/hicolor/128x128/apps/orfeus.png
rm -f ~/.local/share/icons/hicolor/32x32/apps/orfeus.png
update-desktop-database ~/.local/share/applications
gtk-update-icon-cache -f ~/.local/share/icons/hicolor
```

The AppImage and the release binary inside the project folder are build output. Delete `src-tauri/target` from the project if you want those gone too.

## Install on Windows

Build the installer on a Windows 10 or Windows 11 machine. Orfeus plays through the Windows audio device and uses the system WebView2 runtime.

Install these once:

1. [Node.js](https://nodejs.org/) (the LTS build includes `npm`).
2. [Rust](https://rustup.rs/). After it installs, open a new terminal so `cargo` is on the PATH.
3. Visual Studio Build Tools with the **Desktop development with C++** workload. The Rust installer can prompt for this.
4. WebView2 is already on current Windows 11. The setup wizard downloads it if a machine does not have it.

Then, in PowerShell, from the project folder:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-windows.ps1
```

The script installs the npm packages and runs `npm run tauri build -- --bundles nsis`. That produces a setup wizard:

```text
src-tauri\target\release\bundle\nsis\Orfeus_1.0.0_x64-setup.exe
```

The version in the file name follows `version` in `src-tauri/tauri.conf.json`. Double-click the `.exe`. The wizard asks whether to install for the current user or for everyone, then copies Orfeus and adds it to the Start menu. You can copy that setup file to another PC and run it there without the source tree.

YouTube import on Windows needs Python (`py`, `python`, or `python3`) and `ffmpeg` on the PATH. Burning a disc needs `xorriso` and, for an audio CD, `ffmpeg`.

## Uninstall on Windows

Close Orfeus. Either open **Settings → Apps → Installed apps**, find **Orfeus**, and choose **Uninstall**, or from the project folder in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\uninstall-windows.ps1
```

The script runs the uninstaller that the setup wizard registered. It removes the program, the Start menu shortcut, and the Installed apps entry. It does not delete your music files. Playlists, covers, lyrics, and the library database stay in:

```text
%APPDATA%\app.orfeus.desktop
```

That is usually `C:\Users\<you>\AppData\Roaming\app.orfeus.desktop`. To remove the program and that library data together:

```powershell
.\scripts\uninstall-windows.ps1 -Data
```

The setup `.exe` inside `src-tauri\target` is build output. Delete `src-tauri\target` from the project if you want that file gone too.

## Background

The default background is the mythological painting *Orpheus and Eurydice* by Peter Paul Rubens (1577–1640), painted in 1636–1638.

Orfeus is released under the MIT license. See `LICENSE`.
