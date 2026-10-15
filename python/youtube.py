#!/usr/bin/env python3
"""Download a YouTube video with pytubefix and write an audio file."""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


def emit(payload):
    print(json.dumps(payload), flush=True)


def fail(message):
    emit({"event": "error", "message": message or "The download failed."})
    raise SystemExit(1)


def require_ffmpeg():
    if shutil.which("ffmpeg") is None:
        fail("ffmpeg was not found. Install ffmpeg and try again.")


def safe_name(title):
    cleaned = []
    for char in title or "":
        if char.isalnum() or char in " -_":
            cleaned.append(char)
        else:
            cleaned.append(" ")
    name = " ".join("".join(cleaned).split()).strip()[:80]
    return name or "track"


def unique_path(path):
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    number = 2
    while True:
        candidate = path.with_name(f"{stem} {number}{suffix}")
        if not candidate.exists():
            return candidate
        number += 1


def height_of(stream):
    resolution = getattr(stream, "resolution", None) or ""
    digits = "".join(char for char in str(resolution) if char.isdigit())
    return int(digits) if digits else 0


def abr_of(stream):
    raw = getattr(stream, "abr", None) or "0"
    digits = "".join(char for char in str(raw) if char.isdigit())
    return int(digits) if digits else 0


def progressive_mp4(yt):
    streams = list(yt.streams.filter(progressive=True, file_extension="mp4"))
    return sorted(streams, key=lambda stream: (height_of(stream), stream.filesize or 0))


def adaptive_video(yt):
    streams = list(yt.streams.filter(adaptive=True, only_video=True, file_extension="mp4"))
    return sorted(streams, key=lambda stream: (height_of(stream), stream.filesize or 0))


def audio_streams(yt):
    return list(yt.streams.filter(only_audio=True))


def best_audio(yt):
    streams = audio_streams(yt)
    if not streams:
        return None
    return max(streams, key=lambda stream: (abr_of(stream), stream.filesize or 0))


def resolution_list(yt):
    found = {}
    for stream in progressive_mp4(yt):
        height = height_of(stream)
        if height <= 0:
            continue
        found[height] = {"height": height, "progressive": True, "label": f"{height}p"}
    for stream in adaptive_video(yt):
        height = height_of(stream)
        if height <= 0 or height in found:
            continue
        found[height] = {"height": height, "progressive": False, "label": f"{height}p"}
    return [found[height] for height in sorted(found)]


def open_video(url, on_progress):
    from pytubefix import YouTube

    return YouTube(url, on_progress_callback=on_progress)


def playlist_url(url):
    lowered = url.lower()
    if "youtu.be/" in lowered:
        return False
    if "/playlist" in lowered:
        return True
    return "list=" in lowered and "watch?" not in lowered


def probe(url):
    require_ffmpeg()
    if playlist_url(url):
        probe_playlist(url)
        return
    video = open_video(url, lambda *_args: None)
    resolutions = resolution_list(video)
    if not resolutions:
        fail("This video has no downloadable stream.")
    emit(
        {
            "event": "probe",
            "kind": "video",
            "title": video.title or "Untitled",
            "author": video.author or "",
            "length": int(video.length or 0),
            "resolutions": resolutions,
            "entries": [],
        }
    )


def probe_playlist(url):
    from pytubefix import Playlist

    playlist = Playlist(url)
    entries = []
    for index, video in enumerate(playlist.videos):
        try:
            entries.append(
                {
                    "index": index,
                    "title": video.title or "Untitled",
                    "author": video.author or "",
                    "url": video.watch_url,
                    "length": int(video.length or 0),
                }
            )
        except Exception:
            continue
    if not entries:
        fail("This playlist has no videos that can be downloaded.")
    emit(
        {
            "event": "probe",
            "kind": "playlist",
            "title": playlist.title or "Playlist",
            "author": "",
            "length": 0,
            "resolutions": [],
            "entries": entries,
        }
    )


class Span:
    def __init__(self, start, width):
        self.start = start
        self.width = width

    def __call__(self, stream, _chunk, bytes_remaining):
        total = stream.filesize or getattr(stream, "filesize_approx", None) or 0
        done = 0 if total <= 0 else max(0, total - bytes_remaining) / total
        percent = min(100, self.start + done * self.width)
        emit(
            {
                "event": "progress",
                "phase": "download",
                "percent": round(percent, 1),
                "label": "Downloading",
            }
        )


def download_stream(stream, folder, filename):
    folder.mkdir(parents=True, exist_ok=True)
    saved = stream.download(output_path=str(folder), filename=filename)
    return Path(saved)


def run_ffmpeg(args):
    return subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args],
        capture_output=True,
        text=True,
    )


def ffmpeg_error(proc, fallback):
    lines = [line.strip() for line in (proc.stderr or "").splitlines() if line.strip()]
    return lines[-1] if lines else fallback


def encode_mp3(source, dest):
    emit({"event": "progress", "phase": "convert", "percent": 0, "label": "Converting to audio"})
    encoded = run_ffmpeg(
        [
            "-i",
            str(source),
            "-vn",
            "-map",
            "0:a:0",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "320k",
            str(dest),
        ]
    )
    if encoded.returncode != 0 or not dest.is_file():
        dest.unlink(missing_ok=True)
        fail(ffmpeg_error(encoded, "Could not convert the audio to mp3."))
    emit({"event": "progress", "phase": "convert", "percent": 100, "label": "Converting to audio"})


def mux(video, audio, dest):
    emit({"event": "progress", "phase": "convert", "percent": 0, "label": "Preparing the video"})
    merged = run_ffmpeg(
        [
            "-i",
            str(video),
            "-i",
            str(audio),
            "-c",
            "copy",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            str(dest),
        ]
    )
    if merged.returncode != 0 or not dest.is_file():
        fail(ffmpeg_error(merged, "Could not prepare the video file."))
    emit({"event": "progress", "phase": "convert", "percent": 100, "label": "Preparing the video"})


def stream_at(streams, height):
    matches = [stream for stream in streams if height_of(stream) == height]
    if not matches:
        return None
    return max(matches, key=lambda stream: stream.filesize or 0)


def download(args, on_progress):
    require_ffmpeg()
    audio_dir = Path(args.audio_dir)
    video_dir = Path(args.video_dir)
    work = Path(args.work_dir)
    audio_dir.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    video = open_video(args.url, on_progress)
    title = safe_name(video.title or "track")
    author = video.author or ""
    keep = args.keep == "yes"
    audio = best_audio(video)
    if audio is None:
        fail("This video has no audio stream.")
    kept = None
    audio_source = None

    if keep:
        if not str(args.resolution).isdigit():
            fail("Choose a resolution for the video you want to keep.")
        height = int(args.resolution)
        video_dir.mkdir(parents=True, exist_ok=True)
        progressive = stream_at(progressive_mp4(video), height)
        if progressive is not None:
            on_progress.use(0, 60)
            emit({"event": "progress", "phase": "download", "percent": 0, "label": "Downloading"})
            saved = download_stream(progressive, work, f"{title}.mp4")
            kept = unique_path(video_dir / f"{title}.mp4")
            shutil.move(str(saved), kept)
        else:
            chosen = stream_at(adaptive_video(video), height)
            if chosen is None:
                fail("That resolution is no longer available.")
            on_progress.use(0, 60)
            emit({"event": "progress", "phase": "download", "percent": 0, "label": "Downloading"})
            video_part = download_stream(chosen, work, "video.mp4")
            on_progress.use(60, 40)
            audio_source = download_stream(audio, work, f"audio.{audio.subtype or 'webm'}")
            kept = unique_path(video_dir / f"{title}.mp4")
            mux(video_part, audio_source, kept)
        if audio_source is None:
            on_progress.use(60, 40)
            audio_source = download_stream(audio, work, f"audio.{audio.subtype or 'webm'}")
    else:
        on_progress.use(0, 100)
        emit({"event": "progress", "phase": "download", "percent": 0, "label": "Downloading"})
        audio_source = download_stream(audio, work, f"audio.{audio.subtype or 'webm'}")

    if audio_source is None or not audio_source.is_file():
        fail("The audio stream was not saved.")
    audio_path = unique_path(audio_dir / f"{title}.mp3")
    encode_mp3(audio_source, audio_path)
    emit(
        {
            "event": "done",
            "audioPath": str(audio_path),
            "videoPath": str(kept) if kept is not None else None,
            "title": video.title or title,
            "author": author,
        }
    )


class ProgressSwitch:
    def __init__(self):
        self.span = Span(0, 100)

    def use(self, start, width):
        self.span = Span(start, width)

    def __call__(self, stream, chunk, bytes_remaining):
        self.span(stream, chunk, bytes_remaining)


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="cmd", required=True)
    look = commands.add_parser("probe")
    look.add_argument("--url", required=True)
    save = commands.add_parser("download")
    save.add_argument("--url", required=True)
    save.add_argument("--audio-dir", required=True)
    save.add_argument("--video-dir", required=True)
    save.add_argument("--work-dir", required=True)
    save.add_argument("--keep", choices=["yes", "no"], required=True)
    save.add_argument("--resolution", default="")
    args = parser.parse_args()
    if args.cmd == "probe":
        probe(args.url.strip())
        return
    download(args, ProgressSwitch())


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        fail(str(exc) or "The download failed.")
