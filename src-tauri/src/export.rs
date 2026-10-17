use std::fs::{self, File};
use std::io;
use std::path::Path;
use std::process::Command;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use std::io::ErrorKind;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use std::process::Stdio;

use tauri::{AppHandle, Emitter, State};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

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
    if track_ids.is_empty() {
        return Err("Choose at least one track.".into());
    }
    export_archive(&app, &state, &track_ids, dest, "Orfeus.zip")
}

fn export_archive(
    app: &AppHandle,
    state: &State<AppState>,
    track_ids: &[String],
    dest: &Path,
    archive_name: &str,
) -> Result<ExportReport, String> {
    let jobs = {
        let conn = state.db.lock().map_err(|err| err.to_string())?;
        let mut jobs = Vec::new();
        for id in track_ids {
            let Some(track) = library::query_track(&conn, id)? else {
                jobs.push(Err(format!("Track {id} was not found.")));
                continue;
            };
            jobs.push(Ok(track));
        }
        jobs
    };
    let archive = unique_path(dest, archive_name);
    let file = File::create(&archive).map_err(|err| err.to_string())?;
    let mut zip = ZipWriter::new(file);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let total = jobs.len();
    let mut exported = 0;
    let mut errors = Vec::new();
    let scratch = std::env::temp_dir().join(format!("orfeus-export-{}", std::process::id()));
    fs::create_dir_all(&scratch).map_err(|err| err.to_string())?;
    for (index, job) in jobs.into_iter().enumerate() {
        let track = match job {
            Ok(track) => track,
            Err(message) => {
                errors.push(message);
                continue;
            }
        };
        let _ = app.emit(
            "export://progress",
            ExportProgress { done: index, total, current: track.title.clone() },
        );
        if track.missing || !Path::new(&track.path).is_file() {
            errors.push(format!("\"{}\" is no longer on disk.", track.title));
            continue;
        }
        let ext = Path::new(&track.path).extension().and_then(|ext| ext.to_str()).unwrap_or("audio");
        let name = format!("{:02}.{}.{}", index + 1, sanitize_name(&track.title), ext);
        let staged = scratch.join(format!("{index}.{ext}"));
        fs::copy(&track.path, &staged).map_err(|err| err.to_string())?;
        let cover = track.cover_path.as_deref().map(Path::new).filter(|path| path.is_file());
        let _ = tags::write_tags(&staged, &track.title, &track.artist, &track.album, &track.lyrics, &track.synced_lyrics, cover);
        zip.start_file(&name, stored).map_err(|err| err.to_string())?;
        let mut input = File::open(&staged).map_err(|err| err.to_string())?;
        io::copy(&mut input, &mut zip).map_err(|err| err.to_string())?;
        exported += 1;
    }
    zip.finish().map_err(|err| err.to_string())?;
    let _ = fs::remove_dir_all(&scratch);
    let _ = app.emit("export://progress", ExportProgress { done: total, total, current: String::new() });
    if exported == 0 {
        let _ = fs::remove_file(&archive);
        return Err(errors.first().cloned().unwrap_or_else(|| "Nothing was exported.".into()));
    }
    Ok(ExportReport {
        exported,
        errors,
        dest_dir: dest.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn extract_playlist(app: AppHandle, state: State<AppState>, playlist_id: String, dest_dir: String) -> Result<ExportReport, String> {
    let dest = Path::new(&dest_dir);
    if !dest.is_dir() {
        return Err("Choose a destination folder.".into());
    }
    let (name, ids) = {
        let conn = state.db.lock().map_err(|err| err.to_string())?;
        let playlist = library::query_playlist(&conn, &playlist_id)?.ok_or("Playlist not found.")?;
        if playlist.track_ids.is_empty() {
            return Err("This playlist has no tracks to extract.".into());
        }
        (sanitize_name(&playlist.name), playlist.track_ids)
    };
    let stem = if name.is_empty() { "Playlist".to_string() } else { name };
    let report = export_archive(&app, &state, &ids, dest, &format!("{stem}.zip"))?;
    {
        let conn = state.db.lock().map_err(|err| err.to_string())?;
        let package = unique_path(dest, &format!("{stem}.orfeus"));
        crate::package::write_package(&conn, &playlist_id, &package)?;
    }
    Ok(report)
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    open_folder(Path::new(&path))
}

#[tauri::command]
pub fn ensure_folder(path: String) -> Result<String, String> {
    Ok(usable_directory(Path::new(path.trim()))
        .map(|dir| dir.to_string_lossy().to_string())
        .unwrap_or_default())
}

pub(crate) fn usable_directory(path: &Path) -> Option<std::path::PathBuf> {
    if path.as_os_str().is_empty() {
        return None;
    }
    if path.is_file() {
        return path.parent().filter(|parent| parent.is_dir()).map(Path::to_path_buf);
    }
    let _ = fs::create_dir_all(path);
    if path.is_dir() {
        return Some(path.to_path_buf());
    }
    let mut cursor = path.to_path_buf();
    while !cursor.is_dir() {
        if !cursor.pop() {
            return None;
        }
    }
    Some(cursor)
}

pub(crate) fn open_folder(path: &Path) -> Result<(), String> {
    let folder = if path.is_dir() {
        path.to_path_buf()
    } else if path.is_file() {
        path.parent()
            .filter(|parent| parent.is_dir())
            .map(Path::to_path_buf)
            .ok_or_else(|| "That location is no longer available.".to_string())?
    } else {
        return Err("That location is no longer available.".into());
    };
    let folder = folder.canonicalize().unwrap_or(folder);
    #[cfg(target_os = "windows")]
    {
        return Command::new("explorer")
            .arg(&folder)
            .spawn()
            .map(|_| ())
            .map_err(|err| err.to_string());
    }
    #[cfg(target_os = "macos")]
    {
        return Command::new("open")
            .arg(&folder)
            .spawn()
            .map(|_| ())
            .map_err(|err| err.to_string());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        open_graphical_folder(&folder)
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn open_graphical_folder(path: &Path) -> Result<(), String> {
    let path_arg = path.as_os_str();
    let mut last_error = None;
    for (program, args, wait) in [
        ("gio", vec![std::ffi::OsStr::new("open"), path_arg], false),
        ("xdg-open", vec![path_arg], false),
        ("nautilus", vec![path_arg], false),
        ("dolphin", vec![path_arg], false),
        ("nemo", vec![path_arg], false),
        ("thunar", vec![path_arg], false),
        ("caja", vec![path_arg], false),
        ("pcmanfm-qt", vec![path_arg], false),
        ("pcmanfm", vec![path_arg], false),
        ("cosmic-files", vec![path_arg], false),
    ] {
        match launch(program, &args, wait) {
            Launch::Opened => return Ok(()),
            Launch::Missing => {}
            Launch::Failed(message) => {
                let _ = last_error.replace(message);
            }
        }
    }
    if let Some(message) = show_folder_over_dbus(path) {
        let _ = last_error.replace(message);
    } else {
        return Ok(());
    }
    Err(last_error.unwrap_or_else(|| "Could not open the file manager.".into()))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
enum Launch {
    Opened,
    Missing,
    Failed(String),
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn launch(program: &str, args: &[&std::ffi::OsStr], wait: bool) -> Launch {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let result = if wait { command.status().map(|status| status.success()) } else { command.spawn().map(|_| true) };
    match result {
        Ok(true) => Launch::Opened,
        Ok(false) => Launch::Failed(format!("{program} could not open that folder.")),
        Err(err) if err.kind() == ErrorKind::NotFound => Launch::Missing,
        Err(err) => Launch::Failed(err.to_string()),
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn show_folder_over_dbus(path: &Path) -> Option<String> {
    let uri = file_uri(path);
    let status = Command::new("dbus-send")
        .args([
            "--session",
            "--print-reply",
            "--dest=org.freedesktop.FileManager1",
            "--type=method_call",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowFolders",
            &format!("array:string:\"{uri}\""),
            "string:",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Ok(status) if status.success() => None,
        Ok(_) => Some("The file manager rejected that folder.".into()),
        Err(err) if err.kind() == ErrorKind::NotFound => Some("Could not open the file manager.".into()),
        Err(err) => Some(err.to_string()),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_folder_falls_back_to_a_parent_that_exists() {
        let root = std::env::temp_dir().join(format!("orfeus-dir-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let nested = root.join("audio").join("new");
        let found = usable_directory(&nested).unwrap();
        assert_eq!(found, nested);
        assert!(nested.is_dir());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    #[test]
    fn folder_uri_escapes_spaces_and_accents() {
        assert_eq!(file_uri(Path::new("/tmp/música nova")), "file:///tmp/m%C3%BAsica%20nova");
    }
}
