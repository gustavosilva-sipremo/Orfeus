use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

use crate::models::{
    CoverDto, CoverHolder, ImportProgress, ImportReport, PlaylistDto, SavePlaylist, ShelfDto,
    TrackDto, UpdateTrack, WatchedFolder,
};
use crate::tags;
use crate::util::{self, now_secs};
use crate::AppState;

#[tauri::command]
pub fn list_tracks(app: AppHandle, state: State<AppState>) -> Result<Vec<TrackDto>, String> {
    let tracks = {
        let conn = state.db.lock().map_err(|err| err.to_string())?;
        refresh_missing(&conn)?;
        query_tracks(&conn)?
    };
    schedule_upkeep(app);
    Ok(tracks)
}

fn schedule_upkeep(app: AppHandle) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        let Some(state) = app.try_state::<crate::AppState>() else {
            return;
        };
        let changed = {
            let Ok(conn) = state.db.lock() else {
                return;
            };
            let collapsed = collapse_duplicate_audio(&conn, &state.data_dir).unwrap_or(false);
            let playing = state.audio.current_track_id();
            let covers = backfill_covers(&conn, &state.data_dir, &playing).unwrap_or(false);
            collapsed || covers
        };
        if changed {
            let _ = app.emit("library://refresh", 0);
        }
    });
}

#[tauri::command]
pub fn list_covers(state: State<AppState>) -> Result<Vec<CoverDto>, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    saved_covers(&conn, &state.data_dir)
}

#[tauri::command]
pub fn delete_cover(state: State<AppState>, path: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let playing = state.audio.current_track_id();
    forget_cover(&conn, &state.data_dir, &path)?;
    if playing.is_empty() {
        return Ok(());
    }
    let current = query_track(&conn, &playing)?;
    drop(conn);
    if let Some(dto) = current {
        state
            .audio
            .set_display(&dto.id, &dto.title, &dto.artist, dto.cover_path.as_deref());
    }
    Ok(())
}

#[tauri::command]
pub fn stage_cover(state: State<AppState>, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("The image is larger than 20 MB.".into());
    }
    let ext = util::image_ext(&bytes)
        .ok_or_else(|| "Unsupported image. Use JPG, PNG, WebP, GIF, or AVIF.".to_string())?;
    let dir = state.data_dir.join("cover-drops");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    sweep_old_drops(&dir);
    let dest = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    fs::write(&dest, &bytes).map_err(|err| err.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_image(path: String) -> Result<tauri::ipc::Response, String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("Image not found.".into());
    }
    let bytes = fs::read(&source).map_err(|err| err.to_string())?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("The image is larger than 20 MB.".into());
    }
    if util::image_ext(&bytes).is_none() {
        return Err("This file is not a supported image.".into());
    }
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn import_paths(
    app: AppHandle,
    state: State<AppState>,
    paths: Vec<String>,
    recursive: Option<bool>,
    watch: Option<bool>,
    shelf_id: Option<String>,
) -> Result<ImportReport, String> {
    import_all(
        &app,
        &state,
        &paths,
        recursive.unwrap_or(true),
        watch.unwrap_or(false),
        shelf_id.as_deref(),
    )
}

#[tauri::command]
pub fn import_folder(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    recursive: Option<bool>,
    watch: Option<bool>,
) -> Result<ImportReport, String> {
    import_all(
        &app,
        &state,
        &[path],
        recursive.unwrap_or(true),
        watch.unwrap_or(false),
        None,
    )
}

#[tauri::command]
pub fn list_shelves(state: State<AppState>) -> Result<Vec<ShelfDto>, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    query_shelves(&conn)
}

#[tauri::command]
pub fn create_shelf(
    state: State<AppState>,
    name: String,
    kind: String,
) -> Result<ShelfDto, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Name the library.".into());
    }
    let kind = shelf_kind(&kind);
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO shelves (id, name, kind, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, kind, now_secs()],
    )
    .map_err(|err| err.to_string())?;
    Ok(ShelfDto {
        id,
        name: name.to_string(),
        kind: kind.to_string(),
        created_at: now_secs(),
    })
}

#[tauri::command]
pub fn update_shelf(state: State<AppState>, id: String, kind: String) -> Result<ShelfDto, String> {
    let kind = shelf_kind(&kind);
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let changed = conn
        .execute(
            "UPDATE shelves SET kind = ?1 WHERE id = ?2",
            params![kind, &id],
        )
        .map_err(|err| err.to_string())?;
    if changed == 0 {
        return Err("That library is no longer here.".into());
    }
    query_shelves(&conn)?
        .into_iter()
        .find(|shelf| shelf.id == id)
        .ok_or_else(|| "That library is no longer here.".into())
}

#[tauri::command]
pub fn delete_shelf(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM shelves", [], |row| row.get(0))
        .map_err(|err| err.to_string())?;
    if count <= 1 {
        return Err("Keep at least one library.".into());
    }
    let fallback: String = conn
        .query_row(
            "SELECT id FROM shelves WHERE id != ?1 ORDER BY created_at LIMIT 1",
            [&id],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE tracks SET shelf_id = ?1 WHERE shelf_id = ?2",
        params![fallback, id],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE watched_folders SET shelf_id = ?1 WHERE shelf_id = ?2",
        params![fallback, id],
    )
    .map_err(|err| err.to_string())?;
    conn.execute("DELETE FROM shelves WHERE id = ?1", [&id])
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_watched(state: State<AppState>) -> Result<Vec<WatchedFolder>, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    watched_folders(&conn)
}

#[tauri::command]
pub fn rescan_folders(app: AppHandle, state: State<AppState>) -> Result<usize, String> {
    refresh_watched(&app, &state)
}

#[tauri::command]
pub fn unwatch_folder(state: State<AppState>, path: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    conn.execute("DELETE FROM watched_folders WHERE path = ?1", [path])
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_track(state: State<AppState>, input: UpdateTrack) -> Result<TrackDto, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("The title cannot be empty.".into());
    }
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let current = query_track(&conn, &input.id)?.ok_or("Track not found.")?;
    let mut cover_path = current.cover_path.clone();
    let mut retired = Vec::new();
    if input.clear_cover {
        if let Some(path) = cover_path.take() {
            retired.push(path);
        }
    }
    if let Some(source) = input.cover_source.as_deref() {
        let stored = store_image(&state.data_dir.join("covers"), &input.id, Path::new(source))?;
        if let Some(previous) = cover_path.replace(stored) {
            if previous != cover_path.clone().unwrap_or_default() {
                retired.push(previous);
            }
        }
    }
    let synced = input.synced_lyrics.unwrap_or(current.synced_lyrics.clone());
    let gain = finite_unit(input.gain.unwrap_or(current.gain), 1.0);
    conn.execute(
        "UPDATE tracks SET title = ?1, artist = ?2, album = ?3, lyrics = ?4, cover_path = ?5, synced_lyrics = ?6, gain = ?7 WHERE id = ?8",
        params![
            title,
            input.artist.trim(),
            input.album.trim(),
            input.lyrics,
            cover_path,
            synced,
            gain,
            input.id,
        ],
    )
    .map_err(|err| err.to_string())?;
    for path in retired {
        release_cover(&conn, &state.data_dir, &path);
    }
    let dto = query_track(&conn, &input.id)?.ok_or_else(|| "Track not found.".to_string())?;
    drop(conn);
    state
        .audio
        .set_display(&dto.id, &dto.title, &dto.artist, dto.cover_path.as_deref());
    Ok(dto)
}

#[tauri::command]
pub fn delete_track(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    trash_track(&conn, &id)
}

#[tauri::command]
pub fn list_trash(state: State<AppState>) -> Result<Vec<TrackDto>, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    refresh_missing(&conn)?;
    query_trash(&conn)
}

#[tauri::command]
pub fn restore_track(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    restore_trashed(&conn, &id)
}

#[tauri::command]
pub fn purge_track(state: State<AppState>, id: String) -> Result<(), String> {
    let playing = state.audio.current_track_id();
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    purge_trashed(&conn, &state.data_dir, &id)?;
    drop(conn);
    if playing == id {
        let _ = state.audio.stop();
    }
    Ok(())
}

#[tauri::command]
pub fn list_playlists(state: State<AppState>) -> Result<Vec<PlaylistDto>, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    query_playlists(&conn)
}

#[tauri::command]
pub fn create_playlist(state: State<AppState>, name: String) -> Result<PlaylistDto, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the playlist a name.".into());
    }
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO playlists (id, name, cover_path, loop_mode, created_at) VALUES (?1, ?2, NULL, 'off', ?3)",
        params![id, name, now_secs()],
    )
    .map_err(|err| err.to_string())?;
    query_playlist(&conn, &id)?.ok_or_else(|| "Playlist not found.".into())
}

#[tauri::command]
pub fn save_playlist(state: State<AppState>, input: SavePlaylist) -> Result<PlaylistDto, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let current = query_playlist(&conn, &input.id)?.ok_or("Playlist not found.")?;
    if let Some(name) = input.name.as_deref() {
        let name = name.trim();
        if name.is_empty() {
            return Err("Give the playlist a name.".into());
        }
        conn.execute(
            "UPDATE playlists SET name = ?1 WHERE id = ?2",
            params![name, input.id],
        )
        .map_err(|err| err.to_string())?;
    }
    if let Some(mode) = input.loop_mode.as_deref() {
        conn.execute(
            "UPDATE playlists SET loop_mode = ?1 WHERE id = ?2",
            params![util::normalize_loop(mode), input.id],
        )
        .map_err(|err| err.to_string())?;
    }
    if let Some(favorite) = input.favorite {
        conn.execute(
            "UPDATE playlists SET favorite = ?1 WHERE id = ?2",
            params![favorite, input.id],
        )
        .map_err(|err| err.to_string())?;
    }
    let mut retired = Vec::new();
    if input.clear_cover {
        if let Some(path) = current.cover_path.clone() {
            retired.push(path);
        }
        conn.execute(
            "UPDATE playlists SET cover_path = NULL WHERE id = ?1",
            [&input.id],
        )
        .map_err(|err| err.to_string())?;
    }
    if let Some(source) = input.cover_source.as_deref() {
        let stored = store_image(
            &state.data_dir.join("playlist-covers"),
            &input.id,
            Path::new(source),
        )?;
        if let Some(previous) = current.cover_path.as_ref() {
            if previous != &stored {
                retired.push(previous.clone());
            }
        }
        conn.execute(
            "UPDATE playlists SET cover_path = ?1 WHERE id = ?2",
            params![stored, input.id],
        )
        .map_err(|err| err.to_string())?;
    }
    for path in retired {
        release_cover(&conn, &state.data_dir, &path);
    }
    if let Some(track_ids) = input.track_ids.as_ref() {
        replace_playlist_tracks(&conn, &input.id, track_ids)?;
    }
    query_playlist(&conn, &input.id)?.ok_or_else(|| "Playlist not found.".into())
}

#[tauri::command]
pub fn delete_playlist(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let cover = query_playlist(&conn, &id)?.and_then(|playlist| playlist.cover_path);
    conn.execute("DELETE FROM playlists WHERE id = ?1", [&id])
        .map_err(|err| err.to_string())?;
    if let Some(cover) = cover {
        release_cover(&conn, &state.data_dir, &cover);
    }
    Ok(())
}

#[tauri::command]
pub fn add_to_playlist(
    state: State<AppState>,
    playlist_id: String,
    track_ids: Vec<String>,
) -> Result<PlaylistDto, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let mut next: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1",
            [&playlist_id],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    for track_id in track_ids {
        let exists = conn
            .query_row(
                "SELECT 1 FROM tracks WHERE id = ?1 AND deleted_at IS NULL",
                [&track_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|err| err.to_string())?;
        if exists.is_none() {
            continue;
        }
        next += 1;
        conn.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
            params![playlist_id, track_id, next],
        )
        .map_err(|err| err.to_string())?;
    }
    query_playlist(&conn, &playlist_id)?.ok_or_else(|| "Playlist not found.".into())
}

#[tauri::command]
pub fn remove_from_playlist(
    state: State<AppState>,
    playlist_id: String,
    track_id: String,
) -> Result<PlaylistDto, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
        params![playlist_id, track_id],
    )
    .map_err(|err| err.to_string())?;
    renumber(&conn, &playlist_id)?;
    query_playlist(&conn, &playlist_id)?.ok_or_else(|| "Playlist not found.".into())
}

#[tauri::command]
pub fn reorder_tracks(state: State<AppState>, ids: Vec<String>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    for (index, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE tracks SET sort_index = ?1 WHERE id = ?2",
            params![index as i64, id],
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn move_playlist_track(
    state: State<AppState>,
    playlist_id: String,
    track_id: String,
    direction: i32,
) -> Result<PlaylistDto, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let trashed = trashed_ids(&conn)?;
    let mut ids = track_ids_of(&conn, &playlist_id)?
        .into_iter()
        .filter(|id| !trashed.contains(id))
        .collect::<Vec<_>>();
    let Some(index) = ids.iter().position(|id| id == &track_id) else {
        return query_playlist(&conn, &playlist_id)?.ok_or_else(|| "Playlist not found.".into());
    };
    let target = index as isize + direction as isize;
    if target >= 0 && (target as usize) < ids.len() {
        ids.swap(index, target as usize);
        replace_playlist_tracks(&conn, &playlist_id, &ids)?;
    }
    query_playlist(&conn, &playlist_id)?.ok_or_else(|| "Playlist not found.".into())
}

pub fn query_tracks(conn: &Connection) -> Result<Vec<TrackDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, path, storage, title, artist, album, duration_ms, cover_path, lyrics, synced_lyrics, gain, missing, added_at, shelf_id
             FROM tracks WHERE deleted_at IS NULL ORDER BY sort_index ASC, added_at DESC, title COLLATE NOCASE",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], map_track)
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

fn query_trash(conn: &Connection) -> Result<Vec<TrackDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, path, storage, title, artist, album, duration_ms, cover_path, lyrics, synced_lyrics, gain, missing, added_at, shelf_id
             FROM tracks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, title COLLATE NOCASE",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], map_track)
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

fn trash_track(conn: &Connection, id: &str) -> Result<(), String> {
    let Some(track) = query_track(conn, id)? else {
        return Ok(());
    };
    if track_deleted(conn, id)? {
        return Ok(());
    }
    conn.execute(
        "UPDATE tracks SET deleted_at = ?1 WHERE id = ?2",
        params![now_secs(), id],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "INSERT INTO dismissed_paths (path) VALUES (?1) ON CONFLICT(path) DO NOTHING",
        [&track.path],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn restore_trashed(conn: &Connection, id: &str) -> Result<(), String> {
    let Some(track) = query_track(conn, id)? else {
        return Ok(());
    };
    if !track_deleted(conn, id)? {
        return Ok(());
    }
    let shelf = if shelf_exists(conn, &track.shelf_id)? {
        track.shelf_id
    } else {
        resolve_shelf(conn, None)?
    };
    conn.execute(
        "UPDATE tracks SET deleted_at = NULL, shelf_id = ?1 WHERE id = ?2",
        params![shelf, id],
    )
    .map_err(|err| err.to_string())?;
    conn.execute("DELETE FROM dismissed_paths WHERE path = ?1", [&track.path])
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn purge_trashed(conn: &Connection, data_dir: &Path, id: &str) -> Result<(), String> {
    let Some(track) = query_track(conn, id)? else {
        return Ok(());
    };
    let shared_file: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tracks WHERE path = ?1 AND id != ?2",
            params![track.path, id],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    conn.execute(
        "INSERT INTO dismissed_paths (path) VALUES (?1) ON CONFLICT(path) DO NOTHING",
        [&track.path],
    )
    .map_err(|err| err.to_string())?;
    conn.execute("DELETE FROM tracks WHERE id = ?1", [id])
        .map_err(|err| err.to_string())?;
    if let Some(cover) = track.cover_path {
        let cover_shared: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tracks WHERE cover_path = ?1",
                [&cover],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if cover_shared == 0 {
            util::remove_inside(data_dir, &cover);
        }
    }
    if shared_file == 0 {
        delete_audio_file(&track.path)?;
    }
    Ok(())
}

fn delete_audio_file(path: &str) -> Result<(), String> {
    let file = Path::new(path);
    if !file.exists() {
        return Ok(());
    }
    if !file.is_file() || !util::is_audio_path(file) {
        return Err("That track does not point at an audio file.".into());
    }
    fs::remove_file(file).map_err(|err| format!("Could not delete the file: {err}"))
}

fn track_deleted(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT deleted_at IS NOT NULL FROM tracks WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .map_err(|err| err.to_string())
}

fn shelf_exists(conn: &Connection, id: &str) -> Result<bool, String> {
    if id.is_empty() {
        return Ok(false);
    }
    conn.query_row("SELECT 1 FROM shelves WHERE id = ?1", [id], |_| Ok(()))
        .optional()
        .map(|found| found.is_some())
        .map_err(|err| err.to_string())
}

pub fn query_track(conn: &Connection, id: &str) -> Result<Option<TrackDto>, String> {
    conn.query_row(
        "SELECT id, path, storage, title, artist, album, duration_ms, cover_path, lyrics, synced_lyrics, gain, missing, added_at, shelf_id
         FROM tracks WHERE id = ?1",
        [id],
        map_track,
    )
    .optional()
    .map_err(|err| err.to_string())
}

pub fn query_playlists(conn: &Connection) -> Result<Vec<PlaylistDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, cover_path, loop_mode, created_at, favorite FROM playlists ORDER BY favorite DESC, created_at DESC",
        )
        .map_err(|err| err.to_string())?;
    let ids = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)? != 0,
            ))
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    ids.into_iter()
        .map(|(id, name, cover_path, loop_mode, created_at, favorite)| {
            Ok(PlaylistDto {
                track_ids: visible_track_ids(conn, &id)?,
                id,
                name,
                cover_path,
                loop_mode,
                created_at,
                favorite,
            })
        })
        .collect()
}

pub fn query_playlist(conn: &Connection, id: &str) -> Result<Option<PlaylistDto>, String> {
    let row = conn
        .query_row(
            "SELECT id, name, cover_path, loop_mode, created_at, favorite FROM playlists WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)? != 0,
                ))
            },
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let Some((id, name, cover_path, loop_mode, created_at, favorite)) = row else {
        return Ok(None);
    };
    Ok(Some(PlaylistDto {
        track_ids: visible_track_ids(conn, &id)?,
        id,
        name,
        cover_path,
        loop_mode,
        created_at,
        favorite,
    }))
}

fn collapse_duplicate_audio(conn: &Connection, data_dir: &Path) -> Result<bool, String> {
    let mut stmt = conn
        .prepare("SELECT id, path FROM tracks WHERE deleted_at IS NULL AND (content_hash IS NULL OR content_hash = '')")
        .map_err(|err| err.to_string())?;
    let pending = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    drop(stmt);
    for (id, path) in pending {
        let Ok(found) = hash_file(Path::new(&path)) else {
            continue;
        };
        conn.execute(
            "UPDATE tracks SET content_hash = ?1 WHERE id = ?2 AND (content_hash IS NULL OR content_hash = '')",
            params![found, id],
        )
        .map_err(|err| err.to_string())?;
    }
    let mut groups = conn
        .prepare(
            "SELECT content_hash FROM tracks
             WHERE deleted_at IS NULL AND content_hash IS NOT NULL AND content_hash != ''
             GROUP BY content_hash HAVING COUNT(*) > 1",
        )
        .map_err(|err| err.to_string())?;
    let hashes = groups
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    drop(groups);
    let mut changed = false;
    for hash in hashes {
        let mut rows = conn
            .prepare(
                "SELECT id, path, storage FROM tracks WHERE deleted_at IS NULL AND content_hash = ?1 ORDER BY added_at ASC",
            )
            .map_err(|err| err.to_string())?;
        let tracks = rows
            .query_map(params![hash], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|err| err.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;
        drop(rows);
        let Some(keep) = tracks
            .iter()
            .find(|(_, path, storage)| storage == "linked" && Path::new(path).is_file())
            .or_else(|| tracks.first())
        else {
            continue;
        };
        if tracks.len() > 1 {
            changed = true;
        }
        for (id, path, storage) in tracks.iter().filter(|(id, _, _)| id != &keep.0) {
            conn.execute(
                "DELETE FROM playlist_tracks WHERE track_id = ?1 AND playlist_id IN (
                    SELECT playlist_id FROM playlist_tracks WHERE track_id = ?2
                 )",
                params![id, keep.0],
            )
            .map_err(|err| err.to_string())?;
            conn.execute(
                "UPDATE playlist_tracks SET track_id = ?1 WHERE track_id = ?2",
                params![keep.0, id],
            )
            .map_err(|err| err.to_string())?;
            conn.execute("DELETE FROM tracks WHERE id = ?1", [id])
                .map_err(|err| err.to_string())?;
            if storage == "owned" {
                util::remove_inside(data_dir, path);
            } else {
                conn.execute(
                    "INSERT INTO dismissed_paths (path) VALUES (?1) ON CONFLICT(path) DO NOTHING",
                    [path],
                )
                .map_err(|err| err.to_string())?;
            }
        }
    }
    Ok(changed)
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|err| err.to_string())?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|err| err.to_string())?;
    Ok(hex::encode(hasher.finalize()))
}

fn find_track_for_hash(conn: &Connection, hash: &str) -> Result<Option<String>, String> {
    if let Some(existing) = conn
        .query_row(
            "SELECT id FROM tracks WHERE deleted_at IS NULL AND content_hash = ?1 LIMIT 1",
            [hash],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| err.to_string())?
    {
        return Ok(Some(existing));
    }
    let mut stmt = conn
        .prepare("SELECT id, path FROM tracks WHERE deleted_at IS NULL AND (content_hash IS NULL OR content_hash = '')")
        .map_err(|err| err.to_string())?;
    let pending = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    drop(stmt);
    for (id, path) in pending {
        let Ok(found) = hash_file(Path::new(&path)) else {
            continue;
        };
        conn.execute(
            "UPDATE tracks SET content_hash = ?1 WHERE id = ?2 AND (content_hash IS NULL OR content_hash = '')",
            params![found, id],
        )
        .map_err(|err| err.to_string())?;
        if found == hash {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

pub struct OwnedMeta<'a> {
    pub title: &'a str,
    pub artist: &'a str,
    pub album: &'a str,
    pub lyrics: &'a str,
    pub synced_lyrics: &'a str,
}

pub fn insert_owned_track(
    conn: &Connection,
    data_dir: &Path,
    path: &Path,
    hash: &str,
    meta: OwnedMeta<'_>,
    cover_bytes: Option<(Vec<u8>, String)>,
) -> Result<String, String> {
    if let Some(existing) = find_track_for_hash(conn, hash)? {
        let (current_path, missing): (String, i64) = conn
            .query_row(
                "SELECT path, missing FROM tracks WHERE id = ?1",
                [&existing],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|err| err.to_string())?;
        let incoming = path.to_string_lossy().to_string();
        if missing != 0 || !Path::new(&current_path).exists() {
            conn.execute(
                "UPDATE tracks SET path = ?1, storage = 'owned', content_hash = ?2, missing = 0 WHERE id = ?3",
                params![incoming, hash, existing],
            )
            .map_err(|err| err.to_string())?;
        } else if current_path != incoming {
            let _ = fs::remove_file(path);
        }
        return Ok(existing);
    }
    let tags = tags::read_tags(path);
    let id = uuid::Uuid::new_v4().to_string();
    let mut cover_path = None;
    if let Some((bytes, ext)) = cover_bytes {
        let dest = data_dir.join("covers").join(format!("{id}.{ext}"));
        fs::write(&dest, bytes).map_err(|err| err.to_string())?;
        cover_path = Some(dest.to_string_lossy().to_string());
    } else if let Some((bytes, ext)) = tags.picture {
        let dest = data_dir.join("covers").join(format!("{id}.{ext}"));
        fs::write(&dest, bytes).map_err(|err| err.to_string())?;
        cover_path = Some(dest.to_string_lossy().to_string());
    }
    let sort_index = next_sort_index(conn)?;
    let shelf = resolve_shelf(conn, None).unwrap_or_default();
    conn.execute(
        "INSERT INTO tracks (id, path, storage, content_hash, title, artist, album, duration_ms, cover_path, lyrics, synced_lyrics, missing, added_at, sort_index, shelf_id)
         VALUES (?1, ?2, 'owned', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, ?12, ?13)",
        params![
            id,
            path.to_string_lossy().to_string(),
            hash,
            meta.title,
            meta.artist,
            meta.album,
            tags.duration_ms,
            cover_path,
            meta.lyrics,
            meta.synced_lyrics,
            now_secs(),
            sort_index,
            shelf,
        ],
    )
    .map_err(|err| err.to_string())?;
    Ok(id)
}

fn import_all(
    app: &AppHandle,
    state: &AppState,
    paths: &[String],
    recursive: bool,
    watch: bool,
    shelf_id: Option<&str>,
) -> Result<ImportReport, String> {
    let files = collect_audio(paths, recursive);
    let total = files.len();
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let shelf = resolve_shelf(&conn, shelf_id)?;
    let mut imported = 0;
    let mut skipped = 0;
    for (index, path) in files.iter().enumerate() {
        let _ = app.emit(
            "library://progress",
            ImportProgress {
                done: index,
                total,
                current: path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("track")
                    .to_string(),
            },
        );
        if import_one(&conn, &state.data_dir, path, true, &shelf)? {
            imported += 1;
        } else {
            skipped += 1;
        }
    }
    let _ = app.emit(
        "library://progress",
        ImportProgress {
            done: total,
            total,
            current: String::new(),
        },
    );
    if watch {
        remember_watched(&conn, paths, recursive, &shelf)?;
    }
    collapse_duplicate_audio(&conn, &state.data_dir)?;
    Ok(ImportReport { imported, skipped })
}

pub fn refresh_watched(app: &AppHandle, state: &AppState) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let folders = watched_folders(&conn)?;
    let mut imported = 0;
    for folder in folders {
        let files = collect_audio(&[folder.path], folder.recursive);
        for path in files {
            let shelf = if folder.shelf_id.is_empty() {
                resolve_shelf(&conn, None)?
            } else {
                folder.shelf_id.clone()
            };
            if import_one(&conn, &state.data_dir, &path, false, &shelf)? {
                imported += 1;
            }
        }
    }
    if imported > 0 {
        collapse_duplicate_audio(&conn, &state.data_dir)?;
        let _ = app.emit("library://refresh", imported);
    }
    Ok(imported)
}

fn watched_folders(conn: &Connection) -> Result<Vec<WatchedFolder>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT path, recursive, shelf_id FROM watched_folders ORDER BY path COLLATE NOCASE",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(WatchedFolder {
                path: row.get(0)?,
                recursive: row.get::<_, i64>(1)? != 0,
                shelf_id: row.get(2)?,
            })
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    Ok(rows)
}

fn remember_watched(
    conn: &Connection,
    paths: &[String],
    recursive: bool,
    shelf_id: &str,
) -> Result<(), String> {
    for raw in paths {
        let path = PathBuf::from(raw);
        if !path.is_dir() {
            continue;
        }
        conn.execute(
            "INSERT INTO watched_folders (path, recursive, shelf_id) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET recursive = excluded.recursive, shelf_id = excluded.shelf_id",
            params![path.to_string_lossy().to_string(), i64::from(recursive), shelf_id],
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn import_one(
    conn: &Connection,
    data_dir: &Path,
    path: &Path,
    revive: bool,
    shelf_id: &str,
) -> Result<bool, String> {
    let path_str = path.to_string_lossy().to_string();
    if revive {
        conn.execute("DELETE FROM dismissed_paths WHERE path = ?1", [&path_str])
            .map_err(|err| err.to_string())?;
    } else {
        let dismissed = conn
            .query_row(
                "SELECT 1 FROM dismissed_paths WHERE path = ?1",
                [&path_str],
                |_| Ok(()),
            )
            .optional()
            .map_err(|err| err.to_string())?;
        if dismissed.is_some() {
            return Ok(false);
        }
    }
    let exists = conn
        .query_row("SELECT 1 FROM tracks WHERE path = ?1", [&path_str], |_| {
            Ok(())
        })
        .optional()
        .map_err(|err| err.to_string())?;
    if exists.is_some() {
        return Ok(false);
    }
    let tags = tags::read_tags(path);
    let id = uuid::Uuid::new_v4().to_string();
    let content_hash = hash_file(path).ok();
    let title = tags.title.unwrap_or_else(|| {
        path.file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("Untitled")
            .to_string()
    });
    let cover_path = if let Some((bytes, ext)) = tags.picture {
        let dest = data_dir.join("covers").join(format!("{id}.{ext}"));
        fs::create_dir_all(data_dir.join("covers")).map_err(|err| err.to_string())?;
        fs::write(&dest, bytes).map_err(|err| err.to_string())?;
        Some(dest.to_string_lossy().to_string())
    } else {
        None
    };
    let sort_index = next_sort_index(conn)?;
    conn.execute(
        "INSERT INTO tracks (id, path, storage, content_hash, title, artist, album, duration_ms, cover_path, lyrics, missing, added_at, sort_index, shelf_id)
         VALUES (?1, ?2, 'linked', ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12)",
        params![
            id,
            path_str,
            content_hash,
            title,
            tags.artist.unwrap_or_default(),
            tags.album.unwrap_or_default(),
            tags.duration_ms,
            cover_path,
            tags.lyrics.unwrap_or_default(),
            now_secs(),
            sort_index,
            shelf_id,
        ],
    )
    .map_err(|err| err.to_string())?;
    Ok(true)
}

fn next_sort_index(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_index), -1) + 1 FROM tracks",
        [],
        |row| row.get(0),
    )
    .map_err(|err| err.to_string())
}

fn collect_audio(paths: &[String], recursive: bool) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        if path.is_dir() {
            if recursive {
                for entry in WalkDir::new(&path).into_iter().filter_map(Result::ok) {
                    if entry.file_type().is_file() && util::is_audio_path(entry.path()) {
                        files.push(entry.into_path());
                    }
                }
            } else if let Ok(entries) = fs::read_dir(&path) {
                for entry in entries.filter_map(Result::ok) {
                    let file = entry.path();
                    if file.is_file() && util::is_audio_path(&file) {
                        files.push(file);
                    }
                }
            }
        } else if util::is_audio_path(&path) {
            files.push(path);
        }
    }
    files.sort();
    files.dedup();
    files
}

fn refresh_missing(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id, path, missing FROM tracks")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    for (id, path, missing) in rows {
        let flag = if Path::new(&path).exists() { 0 } else { 1 };
        if flag != missing {
            conn.execute(
                "UPDATE tracks SET missing = ?1 WHERE id = ?2",
                params![flag, id],
            )
            .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn map_track(row: &rusqlite::Row<'_>) -> rusqlite::Result<TrackDto> {
    let path: String = row.get(1)?;
    let size_bytes = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    Ok(TrackDto {
        id: row.get(0)?,
        path,
        storage: row.get(2)?,
        title: row.get(3)?,
        artist: row.get(4)?,
        album: row.get(5)?,
        duration_ms: row.get(6)?,
        cover_path: row.get(7)?,
        lyrics: row.get(8)?,
        synced_lyrics: row.get(9)?,
        gain: row.get(10)?,
        missing: row.get::<_, i64>(11)? != 0,
        added_at: row.get(12)?,
        shelf_id: row.get(13)?,
        size_bytes,
    })
}

fn query_shelves(conn: &Connection) -> Result<Vec<ShelfDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, kind, created_at FROM shelves ORDER BY created_at, name COLLATE NOCASE")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ShelfDto {
                id: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    Ok(rows)
}

fn resolve_shelf(conn: &Connection, requested: Option<&str>) -> Result<String, String> {
    if let Some(id) = requested {
        let found: Option<String> = conn
            .query_row("SELECT id FROM shelves WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|err| err.to_string())?;
        if let Some(id) = found {
            return Ok(id);
        }
    }
    conn.query_row(
        "SELECT id FROM shelves ORDER BY created_at LIMIT 1",
        [],
        |row| row.get(0),
    )
    .map_err(|err| err.to_string())
}

fn shelf_kind(kind: &str) -> &'static str {
    if kind == "podcast" {
        "podcast"
    } else {
        "music"
    }
}

fn visible_track_ids(conn: &Connection, playlist_id: &str) -> Result<Vec<String>, String> {
    let trashed = trashed_ids(conn)?;
    Ok(track_ids_of(conn, playlist_id)?
        .into_iter()
        .filter(|id| !trashed.contains(id))
        .collect())
}

fn trashed_ids(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM tracks WHERE deleted_at IS NOT NULL")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get(0))
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|err| err.to_string())
}

fn track_ids_of(conn: &Connection, playlist_id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position ASC",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([playlist_id], |row| row.get(0))
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

fn merge_playlist_ids(
    previous: &[String],
    incoming: &[String],
    trashed: &HashSet<String>,
) -> Vec<String> {
    let active = incoming
        .iter()
        .filter(|id| !trashed.contains(*id))
        .cloned()
        .collect::<Vec<_>>();
    let mut pending = active.into_iter();
    let mut merged = Vec::new();
    let mut seen = HashSet::new();
    for id in previous {
        let next = if trashed.contains(id) {
            Some(id.clone())
        } else {
            pending.next()
        };
        if let Some(id) = next {
            if seen.insert(id.clone()) {
                merged.push(id);
            }
        }
    }
    for id in pending {
        if seen.insert(id.clone()) {
            merged.push(id);
        }
    }
    merged
}

fn replace_playlist_tracks(
    conn: &Connection,
    playlist_id: &str,
    track_ids: &[String],
) -> Result<(), String> {
    let previous = track_ids_of(conn, playlist_id)?;
    let trashed = trashed_ids(conn)?;
    let track_ids = merge_playlist_ids(&previous, track_ids, &trashed);
    conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
        [playlist_id],
    )
    .map_err(|err| err.to_string())?;
    for (position, track_id) in track_ids.iter().enumerate() {
        let exists = conn
            .query_row("SELECT 1 FROM tracks WHERE id = ?1", [track_id], |_| Ok(()))
            .optional()
            .map_err(|err| err.to_string())?;
        if exists.is_none() {
            continue;
        }
        conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
            params![playlist_id, track_id, position as i64],
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn renumber(conn: &Connection, playlist_id: &str) -> Result<(), String> {
    let ids = track_ids_of(conn, playlist_id)?;
    replace_playlist_tracks(conn, playlist_id, &ids)
}

fn sweep_old_drops(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(86_400))
        .unwrap_or(std::time::UNIX_EPOCH);
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.modified().ok().is_some_and(|time| time < cutoff) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn saved_covers(conn: &Connection, data_dir: &Path) -> Result<Vec<CoverDto>, String> {
    let mut groups: HashMap<String, CoverGroup> = HashMap::new();
    for folder in ["covers", "playlist-covers"] {
        let dir = data_dir.join(folder);
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || !is_saved_image_name(&path) {
                continue;
            }
            let stored = path.to_string_lossy().to_string();
            let added_at = entry
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|time| time.as_secs() as i64)
                .unwrap_or(0);
            groups.insert(
                stored.clone(),
                CoverGroup {
                    path: stored,
                    holders: Vec::new(),
                    added_at,
                },
            );
        }
    }
    let mut tracks = conn
        .prepare("SELECT id, title, artist, cover_path FROM tracks WHERE cover_path IS NOT NULL AND deleted_at IS NULL ORDER BY title COLLATE NOCASE")
        .map_err(|err| err.to_string())?;
    let track_rows = tracks
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    drop(tracks);
    for (id, title, artist, cover) in track_rows {
        let Some(group) = groups.get_mut(&cover) else {
            continue;
        };
        group.holders.push(CoverHolder {
            kind: "track".into(),
            id,
            title,
            detail: artist,
        });
    }
    let mut playlists = conn
        .prepare("SELECT id, name, cover_path FROM playlists WHERE cover_path IS NOT NULL ORDER BY name COLLATE NOCASE")
        .map_err(|err| err.to_string())?;
    let playlist_rows = playlists
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    drop(playlists);
    for (id, name, cover) in playlist_rows {
        let Some(group) = groups.get_mut(&cover) else {
            continue;
        };
        group.holders.push(CoverHolder {
            kind: "playlist".into(),
            id,
            title: name,
            detail: String::new(),
        });
    }
    collapse_duplicate_covers(conn, data_dir, &mut groups);
    groups.retain(|path, group| {
        if !group.holders.is_empty() {
            return true;
        }
        let unused_search = Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("incoming-"));
        if unused_search {
            util::remove_inside(data_dir, path);
        }
        false
    });
    let mut covers: Vec<CoverDto> = groups
        .into_values()
        .map(|group| {
            let titles: Vec<String> = group
                .holders
                .iter()
                .map(|holder| holder.title.clone())
                .collect();
            CoverDto {
                path: group.path,
                uses: titles.len() as u32,
                label: cover_label(&titles),
                added_at: group.added_at,
                holders: group.holders,
            }
        })
        .collect();
    covers.sort_by(|left, right| {
        right
            .uses
            .cmp(&left.uses)
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(covers)
}

fn collapse_duplicate_covers(
    conn: &Connection,
    data_dir: &Path,
    groups: &mut HashMap<String, CoverGroup>,
) {
    let mut by_hash: HashMap<String, Vec<String>> = HashMap::new();
    for path in groups.keys() {
        let Ok(bytes) = fs::read(path) else {
            continue;
        };
        by_hash
            .entry(hex::encode(Sha256::digest(bytes)))
            .or_default()
            .push(path.clone());
    }
    for paths in by_hash.into_values() {
        if paths.len() < 2 {
            continue;
        }
        let Some(keeper) = paths
            .iter()
            .max_by_key(|path| {
                groups
                    .get(*path)
                    .map(|group| group.holders.len())
                    .unwrap_or(0)
            })
            .cloned()
        else {
            continue;
        };
        for path in paths {
            if path == keeper {
                continue;
            }
            let _ = conn.execute(
                "UPDATE tracks SET cover_path = ?1 WHERE cover_path = ?2",
                params![keeper, path],
            );
            let _ = conn.execute(
                "UPDATE playlists SET cover_path = ?1 WHERE cover_path = ?2",
                params![keeper, path],
            );
            if let Some(group) = groups.remove(&path) {
                if let Some(kept) = groups.get_mut(&keeper) {
                    kept.holders.extend(group.holders);
                }
            }
            util::remove_inside(data_dir, &path);
        }
    }
}

struct CoverGroup {
    path: String,
    holders: Vec<CoverHolder>,
    added_at: i64,
}

fn is_saved_image_name(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "avif")
    )
}

fn forget_cover(conn: &Connection, data_dir: &Path, path: &str) -> Result<(), String> {
    let file = local_cover_file(data_dir, path)?;
    let stored = file.to_string_lossy().to_string();
    conn.execute(
        "UPDATE tracks SET cover_path = NULL WHERE cover_path = ?1 OR cover_path = ?2",
        params![path, stored],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE playlists SET cover_path = NULL WHERE cover_path = ?1 OR cover_path = ?2",
        params![path, stored],
    )
    .map_err(|err| err.to_string())?;
    fs::remove_file(&file).map_err(|err| err.to_string())?;
    Ok(())
}

fn local_cover_file(data_dir: &Path, path: &str) -> Result<PathBuf, String> {
    let target = Path::new(path);
    if !target.is_file() {
        return Err("That cover is no longer on disk.".into());
    }
    let file = target.canonicalize().map_err(|err| err.to_string())?;
    let allowed = ["covers", "playlist-covers"].iter().any(|folder| {
        let root = data_dir.join(folder);
        let root = root.canonicalize().unwrap_or(root);
        file.starts_with(&root)
    });
    if !allowed {
        return Err("Only covers saved in the library can be removed.".into());
    }
    Ok(file)
}

fn cover_label(titles: &[String]) -> String {
    match titles {
        [] => "Saved cover".to_string(),
        [title] => title.clone(),
        [title, _] => format!("{title} and 1 more"),
        [title, ..] => format!("{title} and {} more", titles.len() - 1),
    }
}

pub fn store_image(dir: &Path, id: &str, source: &Path) -> Result<String, String> {
    let bytes = fs::read(source).map_err(|err| err.to_string())?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("The image is larger than 20 MB.".into());
    }
    let ext = util::image_ext(&bytes)
        .ok_or_else(|| "Unsupported image. Use JPG, PNG, WebP, GIF, or AVIF.".to_string())?;
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    if let Some(existing) = identical_saved_image(dir, &bytes) {
        drop_owned_copies(dir, id, Some(Path::new(&existing)));
        return Ok(existing);
    }
    drop_owned_copies(dir, id, None);
    let dest = dir.join(format!("{id}-{}.{}", uuid::Uuid::new_v4(), ext));
    fs::write(&dest, &bytes).map_err(|err| err.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

fn identical_saved_image(dir: &Path, bytes: &[u8]) -> Option<String> {
    let parent = dir.parent()?;
    for folder in ["covers", "playlist-covers"] {
        let Ok(entries) = fs::read_dir(parent.join(folder)) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && fs::read(&path).ok().as_deref() == Some(bytes) {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn drop_owned_copies(dir: &Path, id: &str, keep: Option<&Path>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !(name.starts_with(&format!("{id}.")) || name.starts_with(&format!("{id}-"))) {
            continue;
        }
        if keep.is_some_and(|path| path == entry.path()) {
            continue;
        }
        let _ = fs::remove_file(entry.path());
    }
}

fn release_cover(conn: &Connection, data_dir: &Path, path: &str) {
    let tracks: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tracks WHERE cover_path = ?1",
            [path],
            |row| row.get(0),
        )
        .unwrap_or(1);
    let playlists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM playlists WHERE cover_path = ?1",
            [path],
            |row| row.get(0),
        )
        .unwrap_or(1);
    if tracks + playlists == 0 {
        util::remove_inside(data_dir, path);
    }
}

fn finite_unit(value: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 2.0)
    } else {
        fallback
    }
}

fn backfill_covers(conn: &Connection, data_dir: &Path, playing_id: &str) -> Result<bool, String> {
    static CHECKED: Mutex<Option<HashSet<String>>> = Mutex::new(None);
    let mut checked = CHECKED.lock().map_err(|err| err.to_string())?;
    let seen = checked.get_or_insert_with(HashSet::new);
    let mut stmt = conn
        .prepare("SELECT id, path, cover_path FROM tracks WHERE missing = 0")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    drop(stmt);
    let mut changed = false;
    for (id, path, cover_path) in rows {
        if cover_path
            .as_deref()
            .is_some_and(|value| Path::new(value).is_file())
            || seen.contains(&id)
        {
            continue;
        }
        if id == playing_id {
            continue;
        }
        let Some((bytes, ext)) = tags::read_tags(Path::new(&path)).picture else {
            seen.insert(id);
            continue;
        };
        let dest = data_dir.join("covers").join(format!("{id}.{ext}"));
        fs::create_dir_all(data_dir.join("covers")).map_err(|err| err.to_string())?;
        fs::write(&dest, bytes).map_err(|err| err.to_string())?;
        conn.execute(
            "UPDATE tracks SET cover_path = ?1 WHERE id = ?2",
            params![dest.to_string_lossy().to_string(), id],
        )
        .map_err(|err| err.to_string())?;
        changed = true;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_audio_reuses_the_track_already_on_disk() {
        let root = std::env::temp_dir().join(format!("orfeus-hash-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("covers")).unwrap();
        let conn = crate::db::open(&root.join("library.db")).unwrap();
        let original = root.join("song.mp3");
        fs::write(&original, b"same-bytes").unwrap();
        conn.execute(
            "INSERT INTO tracks (id, path, storage, content_hash, title, artist, album, duration_ms, lyrics, missing, added_at)
             VALUES ('t1', ?1, 'linked', NULL, 'Song', '', '', 0, '', 0, 1)",
            [original.to_string_lossy().to_string()],
        )
        .unwrap();
        let copy = root.join("copy.mp3");
        fs::write(&copy, b"same-bytes").unwrap();
        let hash = hash_file(&copy).unwrap();
        let id = insert_owned_track(
            &conn,
            &root,
            &copy,
            &hash,
            OwnedMeta {
                title: "Song",
                artist: "",
                album: "",
                lyrics: "",
                synced_lyrics: "",
            },
            None,
        )
        .unwrap();
        assert_eq!(id, "t1");
        assert!(!copy.exists());
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let owned = root.join("owned-copy.mp3");
        fs::write(&owned, b"same-bytes").unwrap();
        conn.execute(
            "INSERT INTO tracks (id, path, storage, content_hash, title, artist, album, duration_ms, lyrics, missing, added_at)
             VALUES ('t2', ?1, 'owned', ?2, 'Song', '', '', 0, '', 0, 2)",
            params![owned.to_string_lossy().to_string(), hash],
        )
        .unwrap();
        collapse_duplicate_audio(&conn, &root).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(left, 1);
        assert!(!owned.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_removed_file_is_not_brought_back_by_a_watched_folder() {
        let root = std::env::temp_dir().join(format!("orfeus-dismiss-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let conn = crate::db::open(&root.join("library.db")).unwrap();
        let audio = root.join("song.mp3");
        fs::write(&audio, b"audio").unwrap();
        assert!(import_one(&conn, &root, &audio, true, "").unwrap());
        conn.execute("DELETE FROM tracks", []).unwrap();
        conn.execute(
            "INSERT INTO dismissed_paths (path) VALUES (?1)",
            [audio.to_string_lossy().to_string()],
        )
        .unwrap();
        assert!(!import_one(&conn, &root, &audio, false, "").unwrap());
        assert!(import_one(&conn, &root, &audio, true, "").unwrap());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn removing_a_track_keeps_the_file_until_it_is_deleted_from_the_trash() {
        let root = std::env::temp_dir().join(format!("orfeus-trash-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let conn = crate::db::open(&root.join("library.db")).unwrap();
        let audio = root.join("song.mp3");
        fs::write(&audio, b"audio").unwrap();
        assert!(import_one(&conn, &root, &audio, true, "").unwrap());
        let id: String = conn
            .query_row("SELECT id FROM tracks", [], |row| row.get(0))
            .unwrap();
        trash_track(&conn, &id).unwrap();
        assert!(query_tracks(&conn).unwrap().is_empty());
        assert_eq!(query_trash(&conn).unwrap().len(), 1);
        assert!(audio.is_file());
        assert!(!import_one(&conn, &root, &audio, false, "").unwrap());
        restore_trashed(&conn, &id).unwrap();
        assert_eq!(query_tracks(&conn).unwrap().len(), 1);
        assert!(query_trash(&conn).unwrap().is_empty());
        trash_track(&conn, &id).unwrap();
        purge_trashed(&conn, &root, &id).unwrap();
        assert!(query_tracks(&conn).unwrap().is_empty());
        assert!(query_trash(&conn).unwrap().is_empty());
        assert!(!audio.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_trashed_playlist_track_stays_in_place_until_restore() {
        let previous = vec!["a".into(), "trash".into(), "b".into()];
        let mut trashed = HashSet::new();
        trashed.insert("trash".into());
        let merged = merge_playlist_ids(&previous, &["b".into(), "a".into()], &trashed);
        assert_eq!(
            merged,
            vec!["b".to_string(), "trash".to_string(), "a".to_string()]
        );
    }

    #[test]
    fn saved_covers_lists_local_image_files() {
        let root = std::env::temp_dir().join(format!("orfeus-covers-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("covers")).unwrap();
        let conn = crate::db::open(&root.join("library.db")).unwrap();
        let bytes = b"\xFF\xD8\xFF\x00same-cover";
        let first = root.join("covers").join("a.jpg");
        let second = root.join("covers").join("b.jpg");
        fs::write(&first, bytes).unwrap();
        fs::write(&second, bytes).unwrap();
        for (id, title, cover) in [("t1", "First", &first), ("t2", "Second", &second)] {
            conn.execute(
                "INSERT INTO tracks (id, path, storage, title, artist, album, duration_ms, cover_path, lyrics, missing, added_at)
                 VALUES (?1, ?2, 'linked', ?3, '', '', 0, ?4, '', 0, 1)",
                params![id, format!("/tmp/{id}.mp3"), title, cover.to_string_lossy().to_string()],
            )
            .unwrap();
        }
        let covers = saved_covers(&conn, &root).unwrap();
        assert_eq!(covers.len(), 1);
        assert_eq!(covers[0].uses, 2);
        assert_eq!(covers[0].holders.len(), 2);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn deleting_a_cover_clears_every_track_that_uses_it() {
        let root =
            std::env::temp_dir().join(format!("orfeus-cover-delete-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("covers")).unwrap();
        let conn = crate::db::open(&root.join("library.db")).unwrap();
        let cover = root.join("covers").join("shared.jpg");
        fs::write(&cover, b"\xFF\xD8\xFF\x00cover").unwrap();
        let stored = cover.to_string_lossy().to_string();
        for (id, title) in [("t1", "First"), ("t2", "Second")] {
            conn.execute(
                "INSERT INTO tracks (id, path, storage, title, artist, album, duration_ms, cover_path, lyrics, missing, added_at)
                 VALUES (?1, ?2, 'linked', ?3, 'Artist', '', 0, ?4, '', 0, 1)",
                params![id, format!("/tmp/{id}.mp3"), title, stored],
            )
            .unwrap();
        }
        let listed = saved_covers(&conn, &root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].holders.len(), 2);
        forget_cover(&conn, &root, &stored).unwrap();
        let left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tracks WHERE cover_path IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(left, 0);
        assert!(!cover.exists());
        assert!(saved_covers(&conn, &root).unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_searched_cover_that_nobody_uses_is_not_kept() {
        let root = std::env::temp_dir().join(format!("orfeus-incoming-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("covers")).unwrap();
        let conn = crate::db::open(&root.join("library.db")).unwrap();
        let unused = root.join("covers").join("incoming-search.jpg");
        fs::write(&unused, b"\xFF\xD8\xFF\x00search").unwrap();
        assert!(saved_covers(&conn, &root).unwrap().is_empty());
        assert!(!unused.exists());
        let _ = fs::remove_dir_all(root);
    }
}
