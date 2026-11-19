use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "linux")]
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::models::OpticalDrive;
use crate::AppState;

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
        .map_err(|err| format!("Could not list drives. Install util-linux (lsblk).\n\n{err}"))?;
    if !output.status.success() {
        return Err(with_output("Could not list optical drives.", &output));
    }
    let parsed: Lsblk = serde_json::from_slice(&output.stdout).map_err(|err| {
        with_text(
            &format!("Could not read the drive list. {err}"),
            &String::from_utf8_lossy(&output.stdout),
        )
    })?;
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
                label: block
                    .model
                    .clone()
                    .unwrap_or_else(|| "Optical drive".into()),
                size: block.size.clone().unwrap_or_default(),
            });
        }
        if !block.children.is_empty() {
            collect(&block.children, drives);
        }
    }
}

#[tauri::command]
pub fn burn_disc(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    kind: String,
    device: String,
    track_ids: Vec<String>,
) -> Result<(), String> {
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
    let conn = state
        .db
        .lock()
        .map_err(|_| "The library is busy.".to_string())?;
    let mut jobs = Vec::new();
    for id in ids {
        let row = conn
            .query_row(
                "SELECT title, path, duration_ms FROM tracks WHERE id = ?1",
                [id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .map_err(|_| "A selected track is no longer in the library.".to_string())?;
        if !Path::new(&row.1).is_file() {
            return Err(format!("{} is missing from disk.", row.0));
        }
        let size = std::fs::metadata(&row.1)
            .map(|meta| meta.len())
            .unwrap_or(0);
        jobs.push(Job {
            title: row.0,
            path: row.1,
            duration_ms: row.2,
            size,
        });
    }
    Ok(jobs)
}

fn burn(app: &AppHandle, dir: &Path, kind: &str, device: &str, jobs: &[Job]) -> Result<(), String> {
    let medium = medium_state(device)?;
    let _ = app.emit("disc://progress", "Preparing the tracks");
    let mut maps = Vec::new();
    for (index, job) in jobs.iter().enumerate() {
        let ext = Path::new(&job.path)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("audio");
        let name = if kind == "audio" {
            format!("/{}.wav", disc_name(&job.title, index + 1))
        } else {
            format!("/{}.{}", disc_name(&job.title, index + 1), ext)
        };
        let source = if kind == "audio" {
            let wav = dir.join(format!("{index:02}.wav"));
            let output = crate::util::command("ffmpeg")
                .args([
                    "-y",
                    "-i",
                    &job.path,
                    "-ar",
                    "44100",
                    "-ac",
                    "2",
                    "-c:a",
                    "pcm_s16le",
                ])
                .arg(&wav)
                .output()
                .map_err(|err| format!("Install ffmpeg to burn an audio CD.\n\n{err}"))?;
            if !output.status.success() {
                return Err(with_output(&format!("Could not prepare {}.", job.title), &output));
            }
            wav
        } else {
            Path::new(&job.path).to_path_buf()
        };
        maps.push((source, name));
    }
    let _ = app.emit("disc://progress", "Writing the disc");
    if kind == "audio" {
        let wavs: Vec<PathBuf> = maps.into_iter().map(|(source, _)| source).collect();
        return burn_audio(device, &wavs);
    }
    let mut args = vec!["-outdev".into(), burn_target(device)];
    if medium == Medium::Written {
        args.push("-blank".into());
        args.push("as_needed".into());
    }
    args.extend(["-joliet".into(), "on".into(), "-close".into(), "on".into()]);
    for (source, name) in &maps {
        args.push("-map".into());
        args.push(source.to_string_lossy().into_owned());
        args.push(name.clone());
    }
    args.push("-commit".into());
    match run_xorriso(&args) {
        Ok(()) => Ok(()),
        Err(message) if medium == Medium::Written && blank_failure(&message) => Err(not_erasable("disc")),
        Err(message) => Err(message),
    }
}

fn burn_audio(device: &str, wavs: &[PathBuf]) -> Result<(), String> {
    let mut args = vec![
        "-as".into(),
        "cdrecord".into(),
        "-v".into(),
        format!("dev={}", burn_target(device)),
        "-dao".into(),
        "-pad".into(),
        "-audio".into(),
    ];
    for wav in wavs {
        args.push(wav.to_string_lossy().into_owned());
    }
    run_xorriso(&args).map_err(|message| {
        if blank_failure(&message) {
            not_erasable("CD")
        } else {
            message
        }
    })
}

fn not_erasable(kind: &str) -> String {
    format!("This disc already has data and cannot be erased. Use a blank {kind} or a rewritable one.")
}

fn command_text(output: &std::process::Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

fn with_output(summary: &str, output: &std::process::Output) -> String {
    with_text(summary, &command_text(output))
}

fn with_text(summary: &str, text: &str) -> String {
    let full = text.trim();
    if full.is_empty() || full == summary {
        summary.to_string()
    } else {
        format!("{summary}\n\n{full}")
    }
}

fn full_failure(text: &str) -> String {
    with_text(&xorriso_reason(text), text)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Medium {
    Blank,
    Written,
    Unknown,
}

fn medium_state(device: &str) -> Result<Medium, String> {
    let output = crate::util::command("xorriso")
        .args(["-outdev", &burn_target(device), "-toc"])
        .output()
        .map_err(|err| format!("Install xorriso to burn a disc.\n\n{err}"))?;
    classify_medium(&command_text(&output), output.status.success())
}

fn classify_medium(text: &str, success: bool) -> Result<Medium, String> {
    let lower = text.to_lowercase();
    if lower.contains("no disc")
        || lower.contains("no medium")
        || lower.contains("cannot load")
        || lower.contains("no such device")
    {
        return Err(with_text("Put a disc in the drive and close the tray.", text));
    }
    if lower.contains("is blank") {
        return Ok(Medium::Blank);
    }
    if lower.contains("is written") || lower.contains("is appendable") {
        return Ok(Medium::Written);
    }
    if success {
        return Ok(Medium::Unknown);
    }
    Err(full_failure(text))
}

fn blank_failure(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("blank") || lower.contains("not empty") || lower.contains("medium not writable")
}

fn run_xorriso(args: &[String]) -> Result<(), String> {
    let output = crate::util::command("xorriso")
        .args(args)
        .output()
        .map_err(|err| format!("Install xorriso to burn a disc.\n\n{err}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(full_failure(&command_text(&output)))
}

fn xorriso_reason(text: &str) -> String {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.to_lowercase().contains("-abort_on"))
        .collect();
    let failure = lines.iter().rev().find(|line| {
        let lower = line.to_lowercase();
        lower.contains("failure") || lower.contains("sorry") || lower.contains("fatal")
    });
    let line = failure
        .or_else(|| lines.last())
        .copied()
        .unwrap_or("The disc could not be written.");
    let line = line
        .trim_start_matches("xorriso :")
        .trim_start_matches("xorriso:")
        .trim();
    if line.is_empty() {
        "The disc could not be written.".into()
    } else {
        line.to_string()
    }
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
    let (limit, label) = if kind == "dvd" {
        (DVD_BYTES, "DVD")
    } else {
        (CD_BYTES, "CD")
    };
    if total > limit {
        return Some(format!(
            "These files are larger than a data {label} can hold."
        ));
    }
    None
}

#[cfg(any(target_os = "windows", test))]
fn console_text(bytes: &[u8]) -> String {
    let units = if bytes.starts_with(&[0xFF, 0xFE]) {
        Some(&bytes[2..])
    } else if bytes.len() >= 4
        && bytes.len() % 2 == 0
        && bytes.iter().skip(1).step_by(2).all(|byte| *byte == 0)
    {
        Some(bytes)
    } else {
        None
    };
    if let Some(encoded) = units {
        let wide: Vec<u16> = encoded
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        return String::from_utf16_lossy(&wide);
    }
    String::from_utf8_lossy(bytes)
        .trim_start_matches('\u{feff}')
        .to_string()
}

#[cfg(any(target_os = "windows", test))]
fn json_str<'a>(row: &'a serde_json::Value, name: &str) -> Option<&'a str> {
    row.as_object()?
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .and_then(|(_, value)| value.as_str())
}

#[cfg(any(target_os = "windows", test))]
fn normalize_drive(raw: &str) -> Option<String> {
    let text = raw
        .trim()
        .trim_start_matches(r"\\.\")
        .trim_end_matches(['\\', '/']);
    drive_letter(text).map(|letter| format!("{letter}:"))
}

#[cfg(any(target_os = "windows", test))]
fn drives_from_windows_json(text: &str) -> Result<Vec<OpticalDrive>, String> {
    let text = text.trim();
    if text.is_empty() || text == "null" {
        return Ok(Vec::new());
    }
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|_| "Could not read the drive list.".to_string())?;
    let rows = match value {
        serde_json::Value::Array(rows) => rows,
        other => vec![other],
    };
    let mut drives = Vec::new();
    for row in rows {
        let raw = json_str(&row, "Drive")
            .or_else(|| json_str(&row, "DeviceID"))
            .unwrap_or("");
        let Some(device) = normalize_drive(raw) else {
            continue;
        };
        let name = json_str(&row, "Name").unwrap_or("Optical drive");
        let media = json_str(&row, "MediaType").unwrap_or("").trim();
        let label = if media.is_empty() {
            name.to_string()
        } else {
            format!("{name} · {media}")
        };
        drives.push(OpticalDrive {
            device,
            label,
            size: String::new(),
        });
    }
    Ok(drives)
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn list_drives() -> Result<Vec<OpticalDrive>, String> {
    let output = crate::util::command("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; Get-CimInstance Win32_CDROMDrive | Select-Object Drive,DeviceID,Name,MediaType | ConvertTo-Json -Compress",
        ])
        .output()
        .map_err(|err| format!("Could not list optical drives.\n\n{err}"))?;
    if !output.status.success() {
        return Err(with_output("Could not list optical drives.", &output));
    }
    let text = console_text(&output.stdout);
    drives_from_windows_json(&text).map_err(|err| with_text(&err, &text))
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
#[tauri::command]
pub fn list_drives() -> Result<Vec<OpticalDrive>, String> {
    Ok(Vec::new())
}

#[tauri::command]
pub fn read_disc(app: AppHandle, state: tauri::State<'_, AppState>, device: String) -> Result<String, String> {
    if !device_ok(&device) {
        return Err("Choose an optical drive from the list.".into());
    }
    let _ = app.emit("disc://progress", "Reading the disc");
    let dir = state.data_dir.join(format!("disc-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let cdda = audio_track_count(&device)?;
    let tracks = if let Some(count) = cdda {
        rip_cdda(&app, &device, count, &dir)?
    } else {
        copy_data_audio(&app, &device, &dir)?
    };
    if tracks.is_empty() {
        return Err("This disc has no music tracks.".into());
    }
    let ids = crate::library::adopt_files(&state, &tracks)?;
    let name = disc_label(&device).unwrap_or_else(|| {
        if cdda.is_some() {
            "Audio CD".into()
        } else {
            "Data disc".into()
        }
    });
    let conn = state
        .db
        .lock()
        .map_err(|_| "The library is busy.".to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO playlists (id, name, cover_path, loop_mode, created_at) VALUES (?1, ?2, NULL, 'off', ?3)",
        rusqlite::params![id, name, crate::util::now_secs()],
    )
    .map_err(|err| err.to_string())?;
    for (position, track_id) in ids.iter().enumerate() {
        conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
            rusqlite::params![id, track_id, position as i64],
        )
        .map_err(|err| err.to_string())?;
    }
    let _ = app.emit("disc://progress", "Playlist ready");
    Ok(id)
}

fn audio_track_count(device: &str) -> Result<Option<usize>, String> {
    let output = crate::util::command("cdparanoia")
        .args(["-Q", "-d", device])
        .output();
    let Ok(output) = output else {
        return Ok(None);
    };
    let text = command_text(&output);
    let count = cdda_tracks(&text);
    if count > 0 {
        return Ok(Some(count));
    }
    if text.to_lowercase().contains("unable to open") || text.to_lowercase().contains("no disc") {
        return Err(with_text("Put a disc in the drive and close the tray.", &text));
    }
    Ok(None)
}

fn cdda_tracks(text: &str) -> usize {
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            let (index, rest) = line.split_once('.')?;
            if !rest.starts_with(|char: char| char.is_whitespace()) {
                return None;
            }
            let index = index.trim();
            if index.is_empty() || !index.chars().all(|char| char.is_ascii_digit()) {
                return None;
            }
            Some(())
        })
        .count()
}

fn rip_cdda(app: &AppHandle, device: &str, count: usize, dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for index in 1..=count {
        let _ = app.emit("disc://progress", format!("Reading track {index} of {count}"));
        let wav = dir.join(format!("{index:02}.wav"));
        let output = crate::util::command("cdparanoia")
            .args(["-d", device, "-w", "--", &index.to_string()])
            .arg(&wav)
            .output()
            .map_err(|err| format!("Install cdparanoia to read an audio CD.\n\n{err}"))?;
        if !output.status.success() || !wav.is_file() {
            return Err(with_output(&format!("Could not read track {index}."), &output));
        }
        let flac = dir.join(format!("{index:02}.flac"));
        let encoded = crate::util::command("ffmpeg")
            .args(["-y", "-i"])
            .arg(&wav)
            .args(["-c:a", "flac"])
            .arg(&flac)
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if encoded && flac.is_file() {
            let _ = std::fs::remove_file(&wav);
            files.push(flac);
        } else {
            files.push(wav);
        }
    }
    Ok(files)
}

fn copy_data_audio(app: &AppHandle, device: &str, dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mount = mount_disc(device)?;
    let _ = app.emit("disc://progress", "Copying music from the disc");
    let mut found = Vec::new();
    for entry in walkdir::WalkDir::new(&mount).into_iter().filter_map(Result::ok) {
        if entry.file_type().is_file() && crate::util::is_audio_path(entry.path()) {
            found.push(entry.into_path());
        }
    }
    found.sort();
    let mut files = Vec::new();
    for (index, source) in found.iter().enumerate() {
        let ext = source
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("audio");
        let dest = dir.join(format!("{:02}.{}", index + 1, ext));
        std::fs::copy(source, &dest).map_err(|err| err.to_string())?;
        files.push(dest);
    }
    Ok(files)
}

fn mount_disc(device: &str) -> Result<PathBuf, String> {
    if let Some(path) = mounted_at(device)? {
        return Ok(path);
    }
    let output = crate::util::command("udisksctl")
        .args(["mount", "-b", device])
        .output()
        .map_err(|err| format!("Could not open this data disc. Install udisks.\n\n{err}"))?;
    let text = command_text(&output);
    if let Some(path) = text.split(" at ").nth(1) {
        let path = PathBuf::from(path.trim());
        if path.is_dir() {
            return Ok(path);
        }
    }
    if let Some(path) = mounted_at(device)? {
        return Ok(path);
    }
    Err(with_text(
        "This disc has no CD audio and could not be opened as a data disc.",
        &text,
    ))
}

fn mounted_at(device: &str) -> Result<Option<PathBuf>, String> {
    let output = crate::util::command("findmnt")
        .args(["-nr", "-o", "TARGET", "-S", device])
        .output()
        .map_err(|err| format!("Could not see where the disc is mounted.\n\n{err}"))?;
    let text = String::from_utf8_lossy(&output.stdout);
    let path = text.lines().find_map(|line| {
        let path = PathBuf::from(line.trim());
        path.is_dir().then_some(path)
    });
    Ok(path)
}

fn disc_label(device: &str) -> Option<String> {
    let output = crate::util::command("blkid")
        .args(["-o", "value", "-s", "LABEL", device])
        .output()
        .ok()?;
    let label = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!label.is_empty()).then_some(label)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(minutes: i64, size: u64) -> Job {
        Job {
            title: "Track".into(),
            path: "a.mp3".into(),
            duration_ms: minutes * 60 * 1000,
            size,
        }
    }

    #[test]
    fn windows_drive_json_accepts_one_drive_or_a_list() {
        let one = drives_from_windows_json(r#"{"Drive":"e:","DeviceID":"\\\\.\\CDROM0","Name":"HL-DT-ST","MediaType":"DVD Writer"}"#).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].device, "E:");
        assert_eq!(one[0].label, "HL-DT-ST · DVD Writer");
        let many = drives_from_windows_json(r#"[{"Drive":"D:"},{"DeviceID":"F:"}]"#).unwrap();
        assert_eq!(
            many.iter()
                .map(|drive| drive.device.as_str())
                .collect::<Vec<_>>(),
            ["D:", "F:"]
        );
        assert!(drives_from_windows_json("null").unwrap().is_empty());
        assert!(drives_from_windows_json(r#"{"DeviceID":"\\\\.\\CDROM0"}"#)
            .unwrap()
            .is_empty());
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
        assert_eq!(
            console_text("{\"Drive\":\"G:\"}".as_bytes()).contains("G:"),
            true
        );
    }

    #[test]
    fn windows_burn_target_uses_the_drive_path() {
        assert_eq!(windows_burn_target("E:").as_deref(), Some(r"\\.\E:"));
        assert_eq!(burn_target("/dev/sr0"), "/dev/sr0");
    }

    #[test]
    fn xorriso_reason_skips_the_abort_wrapper() {
        let text = "FAILURE : Blanking failed\nxorriso : aborting : -abort_on 'FAILURE' encountered 'FAILURE'\n";
        assert_eq!(xorriso_reason(text), "FAILURE : Blanking failed");
    }

    #[test]
    fn disc_errors_keep_the_whole_tool_log() {
        let text = "FAILURE : Blanking failed\nxorriso : aborting : -abort_on 'FAILURE' encountered 'FAILURE'\nlibburn : SCSI error on write\n";
        let message = full_failure(text);
        assert!(message.starts_with("FAILURE : Blanking failed"));
        assert!(message.contains("libburn : SCSI error on write"));
        assert!(message.contains("aborting"));
    }

    #[test]
    fn a_blank_disc_is_not_treated_as_written() {
        assert!(matches!(
            classify_medium("Media status : is blank\n", true),
            Ok(Medium::Blank)
        ));
        assert!(matches!(
            classify_medium("Media status : is written , is closed\n", true),
            Ok(Medium::Written)
        ));
        assert!(classify_medium("No medium found in drive\n", false).is_err());
    }

    #[test]
    fn cdda_table_counts_only_track_rows() {
        let text = "track length\n  1.    100 [00:01.00]  0\n  2.    100 [00:01.00]  100\nTOTAL  200\n";
        assert_eq!(cdda_tracks(text), 2);
    }

    #[test]
    fn audio_cd_and_data_discs_have_different_limits() {
        assert!(capacity_error("audio", &[job(70, 9_000_000_000)]).is_none());
        assert!(capacity_error("audio", &[job(90, 1)])
            .unwrap()
            .contains("80 minutes"));
        assert!(capacity_error("cd", &[job(1, 500_000_000)]).is_none());
        assert!(capacity_error("cd", &[job(1, 800_000_000)])
            .unwrap()
            .contains("data CD"));
        assert!(capacity_error("dvd", &[job(1, 4_000_000_000)]).is_none());
        assert!(capacity_error("dvd", &[job(1, 5_000_000_000)])
            .unwrap()
            .contains("data DVD"));
    }
}

fn disc_name(title: &str, index: usize) -> String {
    let clean: String = title
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == ' ' || char == '-' {
                char
            } else {
                ' '
            }
        })
        .collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let clean: String = clean.chars().take(60).collect();
    if clean.is_empty() {
        format!("{index:02} Track")
    } else {
        format!("{index:02} {clean}")
    }
}
