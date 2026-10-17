#[cfg(target_os = "linux")]
use std::thread;
#[cfg(target_os = "linux")]
use std::time::Duration;

use tauri::AppHandle;
#[cfg(target_os = "linux")]
use tauri::Manager;

#[cfg(target_os = "linux")]
use crate::AppState;

pub fn start(app: AppHandle) {
    #[cfg(target_os = "linux")]
    thread::Builder::new()
        .name("orfeus-mpris".into())
        .spawn(move || run(app))
        .expect("mpris thread");
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

#[cfg(target_os = "linux")]
fn run(app: AppHandle) {
    use souvlaki::{MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig};

    let config = PlatformConfig {
        dbus_name: "orfeus",
        display_name: "Orfeus",
        hwnd: None,
    };
    let Ok(mut controls) = MediaControls::new(config) else {
        eprintln!("orfeus: MPRIS is unavailable");
        return;
    };
    let events = app.clone();
    if controls
        .attach(move |event| handle(&events, event))
        .is_err()
    {
        eprintln!("orfeus: MPRIS controls could not attach");
        return;
    }
    loop {
        thread::sleep(Duration::from_millis(400));
        let Some(state) = app.try_state::<AppState>() else {
            continue;
        };
        let snap = state.audio.snapshot();
        drop(state);
        let cover = file_url(snap.cover_path.as_deref().unwrap_or(""));
        let _ = controls.set_metadata(MediaMetadata {
            title: nonempty(snap.title.as_str()),
            artist: nonempty(snap.artist.as_str()),
            album: None,
            cover_url: cover.as_deref(),
            duration: Some(Duration::from_secs_f64(snap.duration.max(0.0))),
        });
        let progress = Some(MediaPosition(Duration::from_secs_f64(
            snap.position.max(0.0),
        )));
        let playback = if snap.track_id.is_none() {
            MediaPlayback::Stopped
        } else if snap.playing {
            MediaPlayback::Playing { progress }
        } else {
            MediaPlayback::Paused { progress }
        };
        let _ = controls.set_playback(playback);
    }
}

#[cfg(target_os = "linux")]
fn handle(app: &AppHandle, event: souvlaki::MediaControlEvent) {
    use souvlaki::{MediaControlEvent, MediaPosition, SeekDirection};

    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    match event {
        MediaControlEvent::Play => {
            let _ = state.audio.resume();
        }
        MediaControlEvent::Pause => {
            let _ = state.audio.pause();
        }
        MediaControlEvent::Toggle => {
            let _ = state.audio.toggle();
        }
        MediaControlEvent::Next => {
            let _ = state.audio.next();
        }
        MediaControlEvent::Previous => {
            let _ = state.audio.previous();
        }
        MediaControlEvent::Stop => {
            let _ = state.audio.stop();
        }
        MediaControlEvent::Seek(direction) => {
            let snap = state.audio.snapshot();
            let delta = match direction {
                SeekDirection::Forward => 10.0,
                SeekDirection::Backward => -10.0,
            };
            let _ = state.audio.seek((snap.position + delta).max(0.0));
        }
        MediaControlEvent::SeekBy(direction, amount) => {
            let snap = state.audio.snapshot();
            let seconds = amount.as_secs_f64();
            let delta = match direction {
                SeekDirection::Forward => seconds,
                SeekDirection::Backward => -seconds,
            };
            let _ = state.audio.seek((snap.position + delta).max(0.0));
        }
        MediaControlEvent::SetPosition(MediaPosition(position)) => {
            let _ = state.audio.seek(position.as_secs_f64());
        }
        _ => {}
    }
}

#[cfg(target_os = "linux")]
fn nonempty(value: &str) -> Option<&str> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

#[cfg(target_os = "linux")]
fn file_url(path: &str) -> Option<String> {
    if path.is_empty() || !std::path::Path::new(path).is_file() {
        return None;
    }
    let mut encoded = String::from("file://");
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    Some(encoded)
}
