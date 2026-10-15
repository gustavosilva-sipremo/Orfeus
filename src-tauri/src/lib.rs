mod audio;
mod db;
mod export;
mod library;
mod models;
mod package;
mod search;
mod tags;
mod util;
mod youtube;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::Connection;
use tauri::Manager;

use audio::AudioEngine;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub audio: AudioEngine,
    pub data_dir: PathBuf,
}

fn setup_app(app: &mut tauri::App) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(data_dir.join("covers")).map_err(|err| err.to_string())?;
    std::fs::create_dir_all(data_dir.join("owned")).map_err(|err| err.to_string())?;
    std::fs::create_dir_all(data_dir.join("playlist-covers")).map_err(|err| err.to_string())?;
    let db = db::open(&data_dir.join("library.db"))?;
    let audio = AudioEngine::start(app.handle().clone());
    app.manage(AppState {
        db: Mutex::new(db),
        audio,
        data_dir,
    });
    let handle = app.handle().clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(8));
        let Some(state) = handle.try_state::<AppState>() else {
            continue;
        };
        if let Err(err) = library::refresh_watched(&handle, &state) {
            eprintln!("orfeus folders: {err}");
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| setup_app(app).map_err(|err| std::io::Error::other(err).into()))
        .invoke_handler(tauri::generate_handler![
            library::list_tracks,
            library::import_paths,
            library::import_folder,
            library::list_watched,
            library::rescan_folders,
            library::unwatch_folder,
            library::update_track,
            library::reorder_tracks,
            library::read_image,
            library::delete_track,
            library::list_playlists,
            library::create_playlist,
            library::save_playlist,
            library::delete_playlist,
            library::add_to_playlist,
            library::remove_from_playlist,
            library::move_playlist_track,
            search::search_metadata,
            search::fetch_cover,
            export::export_tracks,
            export::reveal_path,
            package::export_package,
            package::import_package,
            youtube::youtube_defaults,
            youtube::youtube_probe,
            youtube::youtube_download,
            youtube::youtube_reveal,
            audio::play,
            audio::pause,
            audio::resume,
            audio::toggle,
            audio::seek,
            audio::set_rate,
            audio::set_loop,
            audio::set_volume,
            audio::set_track_gain,
            audio::next,
            audio::previous,
            audio::stop,
            audio::playback_state,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Orfeus");
}
