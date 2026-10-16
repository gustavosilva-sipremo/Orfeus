use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::export;
use crate::AppState;

static DOWNLOAD_BUSY: AtomicBool = AtomicBool::new(false);
static DOWNLOAD_CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeDefaults {
    pub audio_dir: String,
    pub video_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeResolution {
    pub height: u32,
    pub progressive: bool,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeEntry {
    pub index: u32,
    pub title: String,
    pub author: String,
    pub url: String,
    pub length: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeProbe {
    pub kind: String,
    pub title: String,
    pub author: String,
    pub length: u64,
    pub resolutions: Vec<YoutubeResolution>,
    pub entries: Vec<YoutubeEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeProgress {
    pub phase: String,
    pub percent: f32,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeDone {
    pub audio_path: String,
    pub video_path: Option<String>,
    pub title: String,
    pub author: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeDownload {
    pub url: String,
    pub audio_dir: String,
    pub video_dir: String,
    pub keep_video: bool,
    pub resolution: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptEvent {
    event: String,
    #[serde(default)]
    phase: String,
    #[serde(default)]
    percent: f32,
    #[serde(default)]
    label: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    length: u64,
    #[serde(default)]
    resolutions: Vec<YoutubeResolution>,
    #[serde(default)]
    audio_path: String,
    #[serde(default)]
    video_path: Option<String>,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    entries: Vec<YoutubeEntry>,
}

#[tauri::command]
pub fn youtube_defaults(app: AppHandle, state: State<AppState>) -> Result<YoutubeDefaults, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let audio = first_watched(&conn)?.unwrap_or_else(|| system_audio(&app).to_string_lossy().to_string());
    let video = system_video(&app).to_string_lossy().to_string();
    Ok(YoutubeDefaults {
        audio_dir: ready_dir(&audio),
        video_dir: ready_dir(&video),
    })
}

fn ready_dir(path: &str) -> String {
    export::usable_directory(Path::new(path))
        .map(|dir| dir.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

#[tauri::command]
pub async fn youtube_probe(state: State<'_, AppState>, url: String) -> Result<YoutubeProbe, String> {
    let url = check_url(&url)?;
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || probe_blocking(&data_dir, &url))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn youtube_download(
    app: AppHandle,
    state: State<'_, AppState>,
    request: YoutubeDownload,
) -> Result<YoutubeDone, String> {
    let url = check_url(&request.url)?;
    let audio_dir = folder(&request.audio_dir, "audio")?;
    let video_dir = folder(&request.video_dir, "videos")?;
    if request.keep_video && request.resolution.is_none() {
        return Err("Choose a resolution for the video you want to keep.".into());
    }
    if DOWNLOAD_BUSY.swap(true, Ordering::SeqCst) {
        return Err("A download is already running.".into());
    }
    let data_dir = state.data_dir.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        download_blocking(app, &data_dir, &url, &audio_dir, &video_dir, request.keep_video, request.resolution)
    })
    .await
    .map_err(|err| err.to_string());
    DOWNLOAD_BUSY.store(false, Ordering::SeqCst);
    outcome?
}

#[tauri::command]
pub fn youtube_skip() {
    DOWNLOAD_CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn youtube_reveal(path: String) -> Result<(), String> {
    let folder = PathBuf::from(path.trim());
    if folder.as_os_str().is_empty() {
        return Err("Choose a folder first.".into());
    }
    let Some(folder) = export::usable_directory(&folder) else {
        return Err("That folder could not be created.".into());
    };
    export::open_folder(&folder)
}

fn probe_blocking(data_dir: &Path, url: &str) -> Result<YoutubeProbe, String> {
    let runtime = ensure_runtime(data_dir)?;
    let mut probe = None;
    let mut error = None;
    run_script(
        &runtime,
        &["probe".into(), "--url".into(), url.into()],
        &mut |event| {
            let kind = event.event.clone();
            match kind.as_str() {
                "probe" => {
                probe = Some(YoutubeProbe {
                    kind: if event.kind == "playlist" { "playlist".into() } else { "video".into() },
                    title: event.title,
                    author: event.author,
                    length: event.length,
                    resolutions: event.resolutions,
                    entries: event.entries,
                });
                }
                "error" => error = Some(event.message),
                _ => {}
            }
        },
    )?;
    if let Some(message) = error {
        return Err(message);
    }
    probe.ok_or_else(|| "The video details did not come back.".into())
}

fn download_blocking(
    app: AppHandle,
    data_dir: &Path,
    url: &str,
    audio_dir: &Path,
    video_dir: &Path,
    keep_video: bool,
    resolution: Option<u32>,
) -> Result<YoutubeDone, String> {
    emit_progress(&app, "prepare", 0.0, "Preparing the downloader");
    let runtime = ensure_runtime(data_dir)?;
    let work = data_dir.join("youtube-tmp").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&work).map_err(|err| err.to_string())?;
    let mut done = None;
    let mut error = None;
    let args = vec![
        "download".into(),
        "--url".into(),
        url.into(),
        "--audio-dir".into(),
        audio_dir.to_string_lossy().to_string(),
        "--video-dir".into(),
        video_dir.to_string_lossy().to_string(),
        "--work-dir".into(),
        work.to_string_lossy().to_string(),
        "--keep".into(),
        if keep_video { "yes" } else { "no" }.into(),
        "--resolution".into(),
        resolution.map(|height| height.to_string()).unwrap_or_default(),
    ];
    let run = run_script(&runtime, &args, &mut |event| {
        let kind = event.event.clone();
        match kind.as_str() {
            "progress" => emit_progress(&app, &event.phase, event.percent, &event.label),
            "done" => {
                done = Some(YoutubeDone {
                    audio_path: event.audio_path,
                    video_path: event.video_path.filter(|path| !path.is_empty()),
                    title: event.title,
                    author: event.author,
                });
            }
            "error" => error = Some(event.message),
            _ => {}
        }
    });
    let _ = fs::remove_dir_all(&work);
    run?;
    if let Some(message) = error {
        return Err(message);
    }
    let saved = done.ok_or_else(|| "The audio file was not created.".to_string())?;
    if !Path::new(&saved.audio_path).is_file() {
        return Err("The audio file was not created.".into());
    }
    Ok(saved)
}

fn emit_progress(app: &AppHandle, phase: &str, percent: f32, label: &str) {
    let percent = if percent.is_finite() { percent.clamp(0.0, 100.0) } else { 0.0 };
    let _ = app.emit(
        "youtube://progress",
        YoutubeProgress {
            phase: phase.to_string(),
            percent,
            label: label.to_string(),
        },
    );
}

struct Runtime {
    command: Vec<String>,
    script: PathBuf,
    libs: PathBuf,
}

fn python_launchers() -> Vec<Vec<String>> {
    if cfg!(windows) {
        vec![vec!["py".into(), "-3".into()], vec!["python".into()], vec!["python3".into()]]
    } else {
        vec![vec!["python3".into()], vec!["python".into()]]
    }
}

fn prepare_python(command: &mut Command) {
    command.env_remove("PYTHONHOME");
    command.env_remove("PYTHONPATH");
    command.env_remove("PYTHONSTARTUP");
    command.env("PYTHONNOUSERSITE", "1");
    command.env("PYTHONUNBUFFERED", "1");
    command.env("PYTHONWARNINGS", "ignore");
}

fn python_command(argv: &[String]) -> Command {
    let mut command = Command::new(&argv[0]);
    prepare_python(&mut command);
    if argv.len() > 1 {
        command.args(&argv[1..]);
    }
    command
}

fn python_starts(argv: &[String]) -> bool {
    python_command(argv)
        .args(["-c", "import encodings"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn find_python() -> Result<Vec<String>, String> {
    for launcher in python_launchers() {
        if python_starts(&launcher) {
            return Ok(launcher);
        }
    }
    Err("Python 3 was not found, or it started without its standard library. Install Python 3 and try again.".into())
}

fn ensure_runtime(data_dir: &Path) -> Result<Runtime, String> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        return Err("ffmpeg was not found. Install ffmpeg and try again.".into());
    }
    let command = find_python()?;
    let libs = data_dir.join("pylibs");
    fs::create_dir_all(&libs).map_err(|err| err.to_string())?;
    let requirements = include_str!("../../python/requirements.txt");
    let req_path = data_dir.join("requirements.txt");
    let installed = data_dir.join(".pylibs-installed");
    let current = fs::read_to_string(&req_path).unwrap_or_default();
    if current != requirements || !installed.is_file() {
        fs::write(&req_path, requirements).map_err(|err| err.to_string())?;
        let output = python_command(&command)
            .args(["-m", "pip", "install", "--disable-pip-version-check", "--target"])
            .arg(&libs)
            .arg("-r")
            .arg(&req_path)
            .output()
            .map_err(|err| format!("Could not install pytubefix. {err}"))?;
        if !output.status.success() {
            let detail = tail_text(&output.stderr);
            return Err(if detail.is_empty() {
                "Could not install pytubefix.".into()
            } else {
                format!("Could not install pytubefix. {detail}")
            });
        }
        fs::write(&installed, "ok").map_err(|err| err.to_string())?;
    }
    let script_path = data_dir.join("youtube.py");
    let script = include_str!("../../python/youtube.py");
    if fs::read_to_string(&script_path).unwrap_or_default() != script {
        fs::write(&script_path, script).map_err(|err| err.to_string())?;
    }
    Ok(Runtime { command, script: script_path, libs })
}

fn run_script(runtime: &Runtime, args: &[String], on_event: &mut dyn FnMut(ScriptEvent)) -> Result<(), String> {
    if DOWNLOAD_CANCEL.swap(false, Ordering::SeqCst) {
        return Err("Skipped.".into());
    }
    let mut child = python_command(&runtime.command)
        .arg(&runtime.script)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONPATH", &runtime.libs)
        .spawn()
        .map_err(|err| err.to_string())?;
    let pid = child.id();
    let stop_watch = std::sync::Arc::new(AtomicBool::new(false));
    let watch_flag = stop_watch.clone();
    let watcher = std::thread::spawn(move || {
        while !watch_flag.load(Ordering::SeqCst) {
            if DOWNLOAD_CANCEL.load(Ordering::SeqCst) {
                stop_process(pid);
                break;
            }
            std::thread::sleep(Duration::from_millis(120));
        }
    });
    let stdout = child.stdout.take().ok_or("Could not read the downloader.")?;
    let mut stderr = child.stderr.take().ok_or("Could not read the downloader.")?;
    let stderr_task = std::thread::spawn(move || {
        let mut buffer = String::new();
        let _ = stderr.read_to_string(&mut buffer);
        buffer
    });
    let mut script_error = None;
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|err| err.to_string())?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<ScriptEvent>(line) else {
            continue;
        };
        if event.event == "error" && script_error.is_none() {
            script_error = Some(if event.message.is_empty() {
                "The download failed.".to_string()
            } else {
                event.message.clone()
            });
        }
        on_event(event);
    }
    let stderr_text = stderr_task.join().unwrap_or_default();
    let status = child.wait().map_err(|err| err.to_string())?;
    stop_watch.store(true, Ordering::SeqCst);
    let _ = watcher.join();
    let skipped = DOWNLOAD_CANCEL.swap(false, Ordering::SeqCst);
    if skipped {
        return Err("Skipped.".into());
    }
    if !status.success() {
        return Err(script_error.unwrap_or_else(|| {
            let detail = tail_text(stderr_text.as_bytes());
            if detail.is_empty() {
                "The download failed.".into()
            } else {
                detail
            }
        }));
    }
    Ok(())
}

fn stop_process(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/F"]).status();
    }
}

fn first_watched(conn: &Connection) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT path FROM watched_folders ORDER BY path COLLATE NOCASE LIMIT 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())
}

fn system_audio(app: &AppHandle) -> PathBuf {
    app.path()
        .audio_dir()
        .unwrap_or_else(|_| home_child(app, "Music"))
}

fn system_video(app: &AppHandle) -> PathBuf {
    app.path()
        .video_dir()
        .unwrap_or_else(|_| home_child(app, "Videos"))
        .join("Orfeus")
}

fn home_child(app: &AppHandle, name: &str) -> PathBuf {
    app.path()
        .home_dir()
        .map(|home| home.join(name))
        .unwrap_or_else(|_| PathBuf::from(name))
}

fn check_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Paste a YouTube link.".into());
    }
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("Paste a full YouTube link.".into());
    }
    if !(lower.contains("youtube.com/") || lower.contains("youtu.be/")) {
        return Err("That link is not a YouTube video.".into());
    }
    Ok(url.to_string())
}

fn folder(path: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(format!("Choose a folder for the {label}."));
    }
    Ok(path)
}

fn tail_text(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(" ")
}
