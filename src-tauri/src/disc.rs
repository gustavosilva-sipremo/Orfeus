use std::path::Path;
use std::process::Command;

#[cfg(target_os = "linux")]
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::AppState;
use crate::models::OpticalDrive;

const AUDIO_LIMIT_MS: i64 = 80 * 60 * 1000;

#[cfg(target_os = "linux")]
#[derive(Deserialize)]
struct Lsblk {
    blockdevices: Vec<Block>,
}

#[cfg(target_os = "linux")]
#[derive(Deserialize)]
struct Block {
    name: String,
    size: Option<String>,
    model: Option<String>,
    #[serde(default)]
    children: Vec<Block>,
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn list_drives() -> Result<Vec<OpticalDrive>, String> {
    let output = Command::new("lsblk")
        .args(["-J", "-o", "NAME,SIZE,MODEL"])
        .output()
        .map_err(|_| "Could not list drives. Install util-linux (lsblk).".to_string())?;
    if !output.status.success() {
        return Err("Could not list optical drives.".into());
    }
    let parsed: Lsblk = serde_json::from_slice(&output.stdout).map_err(|_| "Could not read the drive list.".to_string())?;
    let mut drives = Vec::new();
    collect(&parsed.blockdevices, &mut drives);
    Ok(drives)
}

#[cfg(target_os = "linux")]
fn collect(blocks: &[Block], drives: &mut Vec<OpticalDrive>) {
    for block in blocks {
        if block.name.starts_with("sr") {
            drives.push(OpticalDrive {
                device: format!("/dev/{}", block.name),
                label: block.model.clone().unwrap_or_else(|| "Optical drive".into()),
                size: block.size.clone().unwrap_or_default(),
            });
        }
        if !block.children.is_empty() {
            collect(&block.children, drives);
        }
    }
}

#[tauri::command]
pub fn burn_disc(app: AppHandle, state: tauri::State<'_, AppState>, kind: String, device: String, track_ids: Vec<String>) -> Result<(), String> {
    if !device_ok(&device) {
        return Err("Choose an optical drive from the list.".into());
    }
    if track_ids.is_empty() {
        return Err("Choose at least one track.".into());
    }
    if kind != "audio" && kind != "data" {
        return Err("Choose an audio CD or a data disc.".into());
    }
    let jobs = tracks(&state, &track_ids)?;
    if kind == "audio" {
        let total: i64 = jobs.iter().map(|job| job.duration_ms.max(0)).sum();
        if total > AUDIO_LIMIT_MS {
            return Err("An audio CD holds about 80 minutes. Choose fewer tracks.".into());
        }
    }
    let dir = std::env::temp_dir().join(format!("orfeus-burn-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let result = burn(&app, &dir, &kind, &device, &jobs);
    let _ = std::fs::remove_dir_all(&dir);
    result
}

struct Job {
    title: String,
    path: String,
    duration_ms: i64,
}

fn tracks(state: &tauri::State<'_, AppState>, ids: &[String]) -> Result<Vec<Job>, String> {
    let conn = state.db.lock().map_err(|_| "The library is busy.".to_string())?;
    let mut jobs = Vec::new();
    for id in ids {
        let row = conn
            .query_row("SELECT title, path, duration_ms FROM tracks WHERE id = ?1", [id], |row| {
                Ok(Job { title: row.get(0)?, path: row.get(1)?, duration_ms: row.get(2)? })
            })
            .map_err(|_| format!("A selected track is no longer in the library."))?;
        if !Path::new(&row.path).is_file() {
            return Err(format!("{} is missing from disk.", row.title));
        }
        jobs.push(row);
    }
    Ok(jobs)
}

fn burn(app: &AppHandle, dir: &Path, kind: &str, device: &str, jobs: &[Job]) -> Result<(), String> {
    let _ = app.emit("disc://progress", "Preparing the tracks");
    let mut maps = Vec::new();
    for (index, job) in jobs.iter().enumerate() {
        let name = disc_name(&job.title, index + 1);
        let source = if kind == "audio" {
            let wav = dir.join(format!("{index:02}.wav"));
            let status = Command::new("ffmpeg")
                .args(["-y", "-i", &job.path, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le"])
                .arg(&wav)
                .status()
                .map_err(|_| "Install ffmpeg to burn an audio CD.".to_string())?;
            if !status.success() {
                return Err(format!("Could not prepare {}.", job.title));
            }
            wav
        } else {
            Path::new(&job.path).to_path_buf()
        };
        maps.push((source, name));
    }
    let _ = app.emit("disc://progress", "Writing the disc");
    let mut args = vec!["-outdev".into(), device.into(), "-blank".into(), "as_needed".into(), "-close".into(), "on".into()];
    for (source, name) in &maps {
        if kind == "audio" {
            args.push("-audio".into());
        }
        args.push("-map".into());
        args.push(source.to_string_lossy().into_owned());
        args.push(name.clone());
    }
    args.push("-commit".into());
    match run_xorriso(&args) {
        Ok(()) => Ok(()),
        Err(message) if message.to_lowercase().contains("blank") => {
            let mut retry = args;
            if let Some(pos) = retry.iter().position(|arg| arg == "-blank") {
                let end = (pos + 2).min(retry.len());
                retry.drain(pos..end);
            }
            run_xorriso(&retry)
        }
        Err(message) => Err(message),
    }
}

fn run_xorriso(args: &[String]) -> Result<(), String> {
    let output = Command::new("xorriso").args(args).output().map_err(|_| "Install xorriso to burn a disc.".to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let text = String::from_utf8_lossy(&output.stderr);
    let line = text.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or("The disc could not be written.");
    Err(line.trim().to_string())
}

fn device_ok(device: &str) -> bool {
    if let Some(rest) = device.strip_prefix("/dev/sr") {
        return !rest.is_empty() && rest.chars().all(|char| char.is_ascii_digit());
    }
    let bytes = device.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn list_drives() -> Result<Vec<OpticalDrive>, String> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_CDROMDrive | Select-Object DeviceID,Name | ConvertTo-Json -Compress",
        ])
        .output()
        .map_err(|_| "Could not list optical drives.".to_string())?;
    if !output.status.success() {
        return Err("Could not list optical drives.".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let text = text.trim();
    if text.is_empty() || text == "null" {
        return Ok(Vec::new());
    }
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| "Could not read the drive list.".to_string())?;
    let rows = match value {
        serde_json::Value::Array(rows) => rows,
        other => vec![other],
    };
    let mut drives = Vec::new();
    for row in rows {
        let Some(device) = row.get("DeviceID").and_then(|value| value.as_str()) else {
            continue;
        };
        let device = device.trim().to_string();
        if !device_ok(&device) {
            continue;
        }
        let label = row.get("Name").and_then(|value| value.as_str()).unwrap_or("Optical drive");
        drives.push(OpticalDrive { device, label: label.to_string(), size: String::new() });
    }
    Ok(drives)
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
#[tauri::command]
pub fn list_drives() -> Result<Vec<OpticalDrive>, String> {
    Ok(Vec::new())
}

fn disc_name(title: &str, index: usize) -> String {
    let clean: String = title
        .chars()
        .map(|char| if char.is_ascii_alphanumeric() || char == ' ' || char == '-' { char } else { ' ' })
        .collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let clean: String = clean.chars().take(60).collect();
    if clean.is_empty() { format!("{index:02} Track") } else { format!("{index:02} {clean}") }
}
