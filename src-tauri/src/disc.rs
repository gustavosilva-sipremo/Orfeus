use std::path::Path;
use std::process::Command;

#[cfg(target_os = "linux")]
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::AppState;
use crate::models::OpticalDrive;

const AUDIO_LIMIT_MS: i64 = 80 * 60 * 1000;
const AUDIO_TRACKS: usize = 99;
const CD_BYTES: u64 = 680 * 1_000_000;
const DVD_BYTES: u64 = 4_500 * 1_000_000;

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
    if kind != "audio" && kind != "cd" && kind != "dvd" {
        return Err("Choose an audio CD, a data CD, or a data DVD.".into());
    }
    let jobs = tracks(&state, &track_ids)?;
    if let Some(reason) = capacity_error(&kind, &jobs) {
        return Err(reason);
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
    size: u64,
}

fn tracks(state: &tauri::State<'_, AppState>, ids: &[String]) -> Result<Vec<Job>, String> {
    let conn = state.db.lock().map_err(|_| "The library is busy.".to_string())?;
    let mut jobs = Vec::new();
    for id in ids {
        let row = conn
            .query_row("SELECT title, path, duration_ms FROM tracks WHERE id = ?1", [id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
            })
            .map_err(|_| "A selected track is no longer in the library.".to_string())?;
        if !Path::new(&row.1).is_file() {
            return Err(format!("{} is missing from disk.", row.0));
        }
        let size = std::fs::metadata(&row.1).map(|meta| meta.len()).unwrap_or(0);
        jobs.push(Job { title: row.0, path: row.1, duration_ms: row.2, size });
    }
    Ok(jobs)
}

fn burn(app: &AppHandle, dir: &Path, kind: &str, device: &str, jobs: &[Job]) -> Result<(), String> {
    let _ = app.emit("disc://progress", "Preparing the tracks");
    let mut maps = Vec::new();
    for (index, job) in jobs.iter().enumerate() {
        let ext = Path::new(&job.path).extension().and_then(|ext| ext.to_str()).unwrap_or("audio");
        let name = if kind == "audio" {
            disc_name(&job.title, index + 1)
        } else {
            format!("{}.{}", disc_name(&job.title, index + 1), ext)
        };
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
    let mut args = vec!["-outdev".into(), burn_target(device), "-blank".into(), "as_needed".into(), "-close".into(), "on".into()];
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
    drive_letter(device).is_some()
}

fn drive_letter(device: &str) -> Option<char> {
    let bytes = device.as_bytes();
    if bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Some((bytes[0] as char).to_ascii_uppercase());
    }
    None
}

fn windows_burn_target(device: &str) -> Option<String> {
    drive_letter(device).map(|letter| format!(r"\\.\{letter}:"))
}

fn burn_target(device: &str) -> String {
    if cfg!(windows) {
        if let Some(target) = windows_burn_target(device) {
            return target;
        }
    }
    device.to_string()
}

fn capacity_error(kind: &str, jobs: &[Job]) -> Option<String> {
    if kind == "audio" {
        if jobs.len() > AUDIO_TRACKS {
            return Some("An audio CD holds 99 tracks.".into());
        }
        let total: i64 = jobs.iter().map(|job| job.duration_ms.max(0)).sum();
        if total > AUDIO_LIMIT_MS {
            return Some("An audio CD holds about 80 minutes. Choose fewer tracks.".into());
        }
        return None;
    }
    let total: u64 = jobs.iter().map(|job| job.size).sum();
    let (limit, label) = if kind == "dvd" { (DVD_BYTES, "DVD") } else { (CD_BYTES, "CD") };
    if total > limit {
        return Some(format!("These files are larger than a data {label} can hold."));
    }
    None
}

fn console_text(bytes: &[u8]) -> String {
    let units = if bytes.starts_with(&[0xFF, 0xFE]) {
        Some(&bytes[2..])
    } else if bytes.len() >= 4 && bytes.len() % 2 == 0 && bytes.iter().skip(1).step_by(2).all(|byte| *byte == 0) {
        Some(bytes)
    } else {
        None
    };
    if let Some(encoded) = units {
        let wide: Vec<u16> = encoded.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
        return String::from_utf16_lossy(&wide);
    }
    String::from_utf8_lossy(bytes).trim_start_matches('\u{feff}').to_string()
}

fn json_str<'a>(row: &'a serde_json::Value, name: &str) -> Option<&'a str> {
    row.as_object()?.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).and_then(|(_, value)| value.as_str())
}

fn normalize_drive(raw: &str) -> Option<String> {
    let text = raw.trim().trim_start_matches(r"\\.\").trim_end_matches(['\\', '/']);
    drive_letter(text).map(|letter| format!("{letter}:"))
}

fn drives_from_windows_json(text: &str) -> Result<Vec<OpticalDrive>, String> {
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
        let raw = json_str(&row, "Drive").or_else(|| json_str(&row, "DeviceID")).unwrap_or("");
        let Some(device) = normalize_drive(raw) else {
            continue;
        };
        let name = json_str(&row, "Name").unwrap_or("Optical drive");
        let media = json_str(&row, "MediaType").unwrap_or("").trim();
        let label = if media.is_empty() { name.to_string() } else { format!("{name} · {media}") };
        drives.push(OpticalDrive { device, label, size: String::new() });
    }
    Ok(drives)
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn list_drives() -> Result<Vec<OpticalDrive>, String> {
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; Get-CimInstance Win32_CDROMDrive | Select-Object Drive,DeviceID,Name,MediaType | ConvertTo-Json -Compress",
        ])
        .output()
        .map_err(|_| "Could not list optical drives.".to_string())?;
    if !output.status.success() {
        return Err("Could not list optical drives.".into());
    }
    drives_from_windows_json(&console_text(&output.stdout))
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
#[tauri::command]
pub fn list_drives() -> Result<Vec<OpticalDrive>, String> {
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(minutes: i64, size: u64) -> Job {
        Job { title: "Track".into(), path: "a.mp3".into(), duration_ms: minutes * 60 * 1000, size }
    }

    #[test]
    fn windows_drive_json_accepts_one_drive_or_a_list() {
        let one = drives_from_windows_json(r#"{"Drive":"e:","DeviceID":"\\\\.\\CDROM0","Name":"HL-DT-ST","MediaType":"DVD Writer"}"#).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].device, "E:");
        assert_eq!(one[0].label, "HL-DT-ST · DVD Writer");
        let many = drives_from_windows_json(r#"[{"Drive":"D:"},{"DeviceID":"F:"}]"#).unwrap();
        assert_eq!(many.iter().map(|drive| drive.device.as_str()).collect::<Vec<_>>(), ["D:", "F:"]);
        assert!(drives_from_windows_json("null").unwrap().is_empty());
        assert!(drives_from_windows_json(r#"{"DeviceID":"\\\\.\\CDROM0"}"#).unwrap().is_empty());
    }

    #[test]
    fn windows_console_text_reads_utf16() {
        let wide: Vec<u8> = "{}"
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect();
        assert_eq!(console_text(&wide), "{}");
        let mut bom = vec![0xFF, 0xFE];
        bom.extend(wide);
        assert_eq!(console_text(&bom), "{}");
        assert_eq!(console_text("{\"Drive\":\"G:\"}".as_bytes()).contains("G:"), true);
    }

    #[test]
    fn windows_burn_target_uses_the_drive_path() {
        assert_eq!(windows_burn_target("E:").as_deref(), Some(r"\\.\E:"));
        assert_eq!(burn_target("/dev/sr0"), "/dev/sr0");
    }

    #[test]
    fn audio_cd_and_data_discs_have_different_limits() {
        assert!(capacity_error("audio", &[job(70, 9_000_000_000)]).is_none());
        assert!(capacity_error("audio", &[job(90, 1)]).unwrap().contains("80 minutes"));
        assert!(capacity_error("cd", &[job(1, 500_000_000)]).is_none());
        assert!(capacity_error("cd", &[job(1, 800_000_000)]).unwrap().contains("data CD"));
        assert!(capacity_error("dvd", &[job(1, 4_000_000_000)]).is_none());
        assert!(capacity_error("dvd", &[job(1, 5_000_000_000)]).unwrap().contains("data DVD"));
    }
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
