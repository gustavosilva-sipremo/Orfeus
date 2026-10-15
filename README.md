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

Then build an AppImage:

```bash
npm install
npm run tauri build -- --bundles appimage
```

The AppImage is written under `src-tauri/target/release/bundle/appimage/`. The bare binary is `src-tauri/target/release/orfeus`.

## Background

The default background is Peter Paul Rubens, *Orpheus and Eurydice*, 1636–1638.
