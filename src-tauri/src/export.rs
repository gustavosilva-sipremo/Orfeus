use std::fs;
use std::io::ErrorKind;
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
        ("gio", vec![std::ffi::OsStr::new("open"), path_arg], true),
        ("xdg-open", vec![path_arg], true),
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
