# Orfeus

Orfeus is a desktop music player for the files you already have. It stays on your computer: the library, covers, lyrics, and listening history live in a local database, and playback goes through the system audio device.

Version 1.6.2. The interface is in English.

## What it does

- Import songs or a whole folder into one or more libraries. The first library keeps a library icon. Extra libraries can be marked as music or a podcast.
- Play the visible list in order, or keep the queue on the current track. Changing that choice takes effect during the song that is already playing.
- Change speed to 0.5×, 1×, 1.2×, 1.5×, and 2×, and play backward at −1.2× and −1.5×.
- Edit a track’s title, artist, album, volume, lyrics, and cover. A cover can be pasted with Ctrl+V, dropped on the artwork, or chosen from a file. Search can fill the cover, lyrics, and timing from MusicBrainz, Cover Art Archive, iTunes, and LRCLIB. A searched image is kept only after you save it on a track or a playlist, and the same picture is stored once.
- Build playlists, pin a favorite to the top of the sidebar, and set playback to stop, repeat the track, or repeat the playlist.
- Extract several library tracks as one zip, or extract a playlist as `01.Track name.mp3` into a folder you choose. The folder is remembered. Extraction starts when you press Extract.
- Import a playlist from an `.orfeus` package.
- Save a YouTube link as a 320 kbps MP3. You choose whether to keep the video, which resolution to keep, and where the files go.
- Open a stage with the cover, a spectrum, and timed lyrics. The corner shows the playlist or the library the song came from.
- Keep listening history by day, month, and year, with the time written on each bar.
- Burn an audio CD for a CD player, a data CD, or a data DVD. An audio CD needs `ffmpeg`. Every disc needs `xorriso`.
- Move a library track to Trash, then restore it or delete the file after confirmation.

## Stack

| Layer | Pieces |
| --- | --- |
| Desktop shell | Tauri 2. Windows uses WebView2. Linux uses WebKitGTK. |
| Interface | React 19, TypeScript, Vite 7, Tailwind CSS 4, Zustand |
| Audio | Rust, cpal, Symphonia (MP3, FLAC, Ogg Vorbis, WAV, AAC, ALAC), rustfft |
| Library | SQLite through rusqlite, tags through lofty |
| Other | reqwest for cover and lyric lookup, zip for packages and multi-track export, souvlaki for system media controls |

## Run from source

Each block has a copy button in the preview and on GitHub.

```bash
npm install
```

```bash
npm run tauri dev
```

`npm run tauri dev` opens the desktop window and the Rust audio engine. The Vite page alone is only a preview and cannot play your files.

## Linux

Orfeus installs for the current user. The launcher is `~/.local/bin/orfeus`.

On CachyOS or Arch, install the libraries used to build and the tools used by YouTube import:

```bash
sudo pacman -S --needed webkit2gtk-4.1 gtk3 pkg-config file openssl python ffmpeg
```

Build the AppImage and install it:

```bash
./scripts/install-linux.sh
```

The launcher sets `APPIMAGE_EXTRACT_AND_RUN`, so the app starts without FUSE. Orfeus then appears in the app menu.

On CachyOS, this installs the native release binary instead of the AppImage:

```bash
./scripts/cachyos.sh
```

Burning needs `xorriso`. An audio CD also needs `ffmpeg`. Listing the drive needs `lsblk`. Audio CD is only for a blank CD. Data CD and data DVD keep the original files.

### Uninstall on Linux

Close Orfeus first.

```bash
./scripts/uninstall-linux.sh
```

That removes the launcher, the AppImage under `~/.local/lib/orfeus`, the desktop entry, and the icons. Your music files stay where they are. Playlists, covers, lyrics, and the database stay in `~/.local/share/app.orfeus.desktop`.

Remove the program and that library data together:

```bash
./scripts/uninstall-linux.sh --data
```

The same launcher files can be removed by hand:

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

## Windows

Orfeus runs on Windows 10 and Windows 11, 64-bit (x86_64). It does not run on 32-bit Windows or on Windows ARM. The installed app uses WebView2. The setup wizard downloads WebView2 when it is missing.

To build the installer, use a 64-bit Windows 10 or Windows 11 machine with:

1. [Node.js](https://nodejs.org/) LTS, which includes npm.
2. [Rust](https://rustup.rs/). Open a new terminal after installing so `cargo` is on the PATH.
3. Visual Studio Build Tools with the Desktop development with C++ workload.

From the project folder in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

```powershell
.\scripts\install-windows.ps1
```

The script installs the npm packages and builds the setup wizard:

```text
src-tauri\target\release\bundle\nsis\Orfeus_1.6.2_x64-setup.exe
```

The file name follows `version` in `src-tauri/tauri.conf.json`. The wizard asks you to accept the terms, then whether to install for you or for everyone, then checks this PC. It installs Python, FFmpeg, and xorriso only when they are missing, and adds them to the user PATH. WebView2 is downloaded when Windows does not already have it. The setup is unsigned: if SmartScreen appears, choose More info, then Run anyway. The setup icon and the uninstall icon are the Orfeus icon.

YouTube import needs Python (`py`, `python`, or `python3`) and `ffmpeg` on the PATH. Burning needs `xorriso` and, for an audio CD, `ffmpeg`. The drive list uses Windows PowerShell. Audio CD is a blank CD for a CD player. Data CD and data DVD keep the original files.

### Uninstall on Windows

Close Orfeus. In Settings, open Apps, find Orfeus, and choose Uninstall. From the project folder, the same uninstall can be started with:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

```powershell
.\scripts\uninstall-windows.ps1
```

That removes the program, the Start menu shortcut, and the Installed apps entry. Music files are left alone. The library data stays in `%APPDATA%\app.orfeus.desktop`, usually `C:\Users\<you>\AppData\Roaming\app.orfeus.desktop`.

Remove the program and that data together:

```powershell
.\scripts\uninstall-windows.ps1 -Data
```

## Background

The default background is the painting *Orpheus and Eurydice* by Peter Paul Rubens (1577–1640), painted in 1636–1638.

Orfeus is released under the MIT license. See `LICENSE`.
