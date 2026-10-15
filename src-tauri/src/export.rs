use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

use tauri::{AppHandle, Emitter, State};

use crate::library;
use crate::models::{ExportProgress, ExportReport};
use crate::tags;
use crate::util::sanitize_name;
use crate::AppState;

#[tauri::command]
pub fn export_tracks(
    app: AppHandle,
    state: State<AppState>,
    track_ids: Vec<String>,
    dest_dir: String,
) -> Result<ExportReport, String> {
    let dest = Path::new(&dest_dir);
    if !dest.is_dir() {
        return Err("Choose a destination folder.".into());
    }
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let total = track_ids.len();
    let mut exported = 0;
    let mut errors = Vec::new();
    for (index, id) in track_ids.iter().enumerate() {
        let Some(track) = library::query_track(&conn, id)? else {
            errors.push(format!("Track {id} was not found."));
            continue;
        };
        let _ = app.emit(
            "export://progress",
            ExportProgress {
                done: index,
                total,
                current: track.title.clone(),
            },
        );
        if track.missing || !Path::new(&track.path).is_file() {
            errors.push(format!("\"{}\" is no longer on disk.", track.title));
            continue;
        }
        let ext = Path::new(&track.path)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("audio");
        let file_name = format!("{}.{}", sanitize_name(&display_name(&track.title, &track.artist)), ext);
        let target = unique_path(dest, &file_name);
        if let Err(err) = fs::copy(&track.path, &target) {
            errors.push(format!("\"{}\": {err}", track.title));
            continue;
        }
        let cover = track.cover_path.as_deref().map(Path::new);
        if let Err(err) = tags::write_tags(
            &target,
            &track.title,
            &track.artist,
            &track.album,
            &track.lyrics,
            &track.synced_lyrics,
            cover.filter(|path| path.is_file()),
        ) {
            errors.push(format!(
                "\"{}\" was copied, but the tags were not written: {err}",
                track.title
            ));
        }
        exported += 1;
    }
    let _ = app.emit(
        "export://progress",
        ExportProgress {
            done: total,
            total,
            current: String::new(),
        },
    );
    Ok(ExportReport {
        exported,
        errors,
        dest_dir,
    })
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("That location is no longer available.".into());
    }
    let folder = if target.is_dir() {
        target.to_path_buf()
    } else {
        target
            .parent()
            .map(|parent| parent.to_path_buf())
            .unwrap_or_else(|| target.to_path_buf())
    };
    open_folder(&folder)
}

pub(crate) fn open_folder(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return Command::new("explorer")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|err| err.to_string());
    }
    #[cfg(target_os = "macos")]
    {
        return Command::new("open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|err| err.to_string());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if open_graphical_folder(path) {
            return Ok(());
        }
        Err("Could not open the file manager.".into())
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn open_graphical_folder(path: &Path) -> bool {
    let uri = file_uri(path);
    let dbus = Command::new("dbus-send")
        .args([
            "--session",
            "--dest=org.freedesktop.FileManager1",
            "--type=method_call",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowFolders",
            &format!("array:string:\"{uri}\""),
            "string:\"\"",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if matches!(&dbus, Ok(status) if status.success()) {
        return true;
    }
    for program in ["nautilus", "dolphin", "nemo", "thunar", "caja", "pcmanfm-qt", "pcmanfm"] {
        let launched = Command::new(program)
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        if launched.is_ok() {
            return true;
        }
    }
    false
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn file_uri(path: &Path) -> String {
    let mut uri = String::from("file://");
    for byte in path.to_string_lossy().bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => uri.push(byte as char),
            _ => uri.push_str(&format!("%{byte:02X}")),
        }
    }
    uri
}

fn display_name(title: &str, artist: &str) -> String {
    if artist.trim().is_empty() {
        title.to_string()
    } else {
        format!("{artist} - {title}")
    }
}

fn unique_path(dir: &Path, file_name: &str) -> std::path::PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("track");
    let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or("audio");
    for index in 2..10_000 {
        let next = dir.join(format!("{stem} ({index}).{ext}"));
        if !next.exists() {
            return next;
        }
    }
    candidate
}
