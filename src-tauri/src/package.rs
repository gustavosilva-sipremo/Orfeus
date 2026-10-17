use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::params;
use sha2::{Digest, Sha256};
use tauri::State;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::library;
use crate::models::{PackageManifest, PackagePlaylist, PackageTrack};
use crate::tags;
use crate::util::{self, now_secs};
use crate::AppState;

const FORMAT: &str = "orfeus-playlist";
const VERSION: u32 = 1;
const ENTRY_LIMIT: u64 = 1024 * 1024 * 1024;

#[tauri::command]
pub fn export_package(
    state: State<AppState>,
    playlist_id: String,
    dest_path: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    write_package(&conn, &playlist_id, Path::new(&dest_path))
}

pub fn write_package(
    conn: &rusqlite::Connection,
    playlist_id: &str,
    dest: &Path,
) -> Result<(), String> {
    let playlist = library::query_playlist(conn, playlist_id)?.ok_or("Playlist not found.")?;
    if playlist.track_ids.is_empty() {
        return Err("This playlist has no tracks to export.".into());
    }
    let mut tracks = Vec::new();
    for id in &playlist.track_ids {
        let track = library::query_track(conn, id)?.ok_or("A playlist track is missing.")?;
        if track.missing || !Path::new(&track.path).is_file() {
            return Err(format!("\"{}\" is no longer on disk.", track.title));
        }
        tracks.push(track);
    }
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }
    let file = File::create(dest).map_err(|err| err.to_string())?;
    let mut zip = ZipWriter::new(file);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let playlist_cover = playlist.cover_path.as_deref().and_then(|path| {
        let ext = Path::new(path)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("jpg");
        let name = format!("cover.{ext}");
        copy_into_zip(&mut zip, Path::new(path), &name, stored).ok()?;
        Some(name)
    });

    let scratch = std::env::temp_dir().join(format!("orfeus-pack-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&scratch).map_err(|err| err.to_string())?;
    let mut manifest_tracks = Vec::new();
    for (index, track) in tracks.iter().enumerate() {
        let ext = Path::new(&track.path)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("audio");
        let file_name = format!(
            "tracks/{:02}.{}.{}",
            index + 1,
            util::sanitize_name(&track.title),
            ext
        );
        let stamped = scratch.join(format!("{index}.{ext}"));
        fs::copy(&track.path, &stamped).map_err(|err| err.to_string())?;
        let cover_file = track
            .cover_path
            .as_deref()
            .map(Path::new)
            .filter(|path| path.is_file());
        tags::write_tags(
            &stamped,
            &track.title,
            &track.artist,
            &track.album,
            &track.lyrics,
            &track.synced_lyrics,
            cover_file,
        )?;
        copy_into_zip(&mut zip, &stamped, &file_name, stored)?;
        let cover = if let Some(path) = track.cover_path.as_deref() {
            let ext = Path::new(path)
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("jpg");
            let name = format!("covers/{:02}.{ext}", index + 1);
            if copy_into_zip(&mut zip, Path::new(path), &name, deflated).is_ok() {
                Some(name)
            } else {
                None
            }
        } else {
            None
        };
        manifest_tracks.push(PackageTrack {
            file: file_name,
            title: track.title.clone(),
            artist: track.artist.clone(),
            album: track.album.clone(),
            lyrics: track.lyrics.clone(),
            synced_lyrics: track.synced_lyrics.clone(),
            cover,
        });
    }

    let manifest = PackageManifest {
        format: FORMAT.into(),
        version: VERSION,
        playlist: PackagePlaylist {
            name: playlist.name,
            cover: playlist_cover,
            loop_mode: util::normalize_loop(&playlist.loop_mode).into(),
        },
        tracks: manifest_tracks,
    };
    let json = serde_json::to_vec_pretty(&manifest).map_err(|err| err.to_string())?;
    zip.start_file("manifest.json", deflated)
        .map_err(|err| err.to_string())?;
    zip.write_all(&json).map_err(|err| err.to_string())?;
    zip.finish().map_err(|err| err.to_string())?;
    let _ = fs::remove_dir_all(&scratch);
    Ok(())
}

#[tauri::command]
pub fn import_package(state: State<AppState>, path: String) -> Result<String, String> {
    let file = File::open(&path).map_err(|err| err.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;
    let manifest = read_manifest(&mut archive)?;
    if manifest.format != FORMAT || manifest.version != VERSION {
        return Err("This package is not a recognized Orfeus file.".into());
    }
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    let playlist_id = uuid::Uuid::new_v4().to_string();
    let cover_path = if let Some(name) = manifest.playlist.cover.as_deref() {
        extract_cover(&mut archive, name, &state.data_dir, &playlist_id, true)?
    } else {
        None
    };
    let name = {
        let trimmed = manifest.playlist.name.trim();
        if trimmed.is_empty() {
            "Imported playlist".to_string()
        } else {
            trimmed.to_string()
        }
    };
    conn.execute(
        "INSERT INTO playlists (id, name, cover_path, loop_mode, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            playlist_id,
            name,
            cover_path,
            util::normalize_loop(&manifest.playlist.loop_mode),
            now_secs(),
        ],
    )
    .map_err(|err| err.to_string())?;

    for (position, track) in manifest.tracks.iter().enumerate() {
        if !util::safe_zip_name(&track.file) || !track.file.starts_with("tracks/") {
            return Err("The package has an invalid audio path.".into());
        }
        let owned = extract_audio(&mut archive, &track.file, &state.data_dir)?;
        let cover = if let Some(name) = track.cover.as_deref() {
            extract_bytes(&mut archive, name, "covers/")?
        } else {
            None
        };
        let title = if track.title.trim().is_empty() {
            fallback_title(&track.file)
        } else {
            track.title.clone()
        };
        let track_id = library::insert_owned_track(
            &conn,
            &state.data_dir,
            &owned.path,
            &owned.hash,
            library::OwnedMeta {
                title: &title,
                artist: &track.artist,
                album: &track.album,
                lyrics: &track.lyrics,
                synced_lyrics: &track.synced_lyrics,
            },
            cover,
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
            params![playlist_id, track_id, position as i64],
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(playlist_id)
}

struct OwnedAudio {
    path: PathBuf,
    hash: String,
}

fn copy_into_zip(
    zip: &mut ZipWriter<File>,
    source: &Path,
    name: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let mut file = File::open(source).map_err(|err| err.to_string())?;
    zip.start_file(name, options)
        .map_err(|err| err.to_string())?;
    std::io::copy(&mut file, zip).map_err(|err| err.to_string())?;
    Ok(())
}

fn read_manifest(archive: &mut ZipArchive<File>) -> Result<PackageManifest, String> {
    let mut file = archive
        .by_name("manifest.json")
        .map_err(|_| "The package has no manifest.json.".to_string())?;
    let mut buf = Vec::new();
    file.by_ref()
        .take(2 * 1024 * 1024)
        .read_to_end(&mut buf)
        .map_err(|err| err.to_string())?;
    serde_json::from_slice(&buf).map_err(|_| "The package manifest is invalid.".into())
}

fn extract_audio(
    archive: &mut ZipArchive<File>,
    name: &str,
    data_dir: &Path,
) -> Result<OwnedAudio, String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| format!("Audio missing from the package: {name}"))?;
    if !entry.enclosed_name().is_some() {
        return Err("Audio path rejected.".into());
    }
    let ext = Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("audio");
    let owned_dir = data_dir.join("owned");
    fs::create_dir_all(&owned_dir).map_err(|err| err.to_string())?;
    let temp = owned_dir.join(format!("incoming-{}", uuid::Uuid::new_v4()));
    let mut output = File::create(&temp).map_err(|err| err.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    let mut total = 0u64;
    loop {
        let read = entry.read(&mut buf).map_err(|err| err.to_string())?;
        if read == 0 {
            break;
        }
        total += read as u64;
        if total > ENTRY_LIMIT {
            let _ = fs::remove_file(&temp);
            return Err("A track in the package is larger than 1 GB.".into());
        }
        hasher.update(&buf[..read]);
        output
            .write_all(&buf[..read])
            .map_err(|err| err.to_string())?;
    }
    drop(output);
    let hash = hex::encode(hasher.finalize());
    let dest = owned_dir.join(format!("{hash}.{ext}"));
    if dest.exists() {
        let _ = fs::remove_file(&temp);
        return Ok(OwnedAudio { path: dest, hash });
    }
    fs::rename(&temp, &dest).map_err(|err| err.to_string())?;
    Ok(OwnedAudio { path: dest, hash })
}

fn extract_cover(
    archive: &mut ZipArchive<File>,
    name: &str,
    data_dir: &Path,
    id: &str,
    playlist: bool,
) -> Result<Option<String>, String> {
    let Some((bytes, ext)) = extract_bytes(archive, name, if playlist { "" } else { "covers/" })?
    else {
        return Ok(None);
    };
    let dir = if playlist {
        data_dir.join("playlist-covers")
    } else {
        data_dir.join("covers")
    };
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let dest = dir.join(format!("{id}.{ext}"));
    fs::write(&dest, bytes).map_err(|err| err.to_string())?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

fn extract_bytes(
    archive: &mut ZipArchive<File>,
    name: &str,
    prefix: &str,
) -> Result<Option<(Vec<u8>, String)>, String> {
    if !util::safe_zip_name(name) || (!prefix.is_empty() && !name.starts_with(prefix)) {
        return Err("Image path rejected.".into());
    }
    if name == "cover.jpg" || name.starts_with("cover.") || name.starts_with("covers/") {
        // accepted
    } else if !prefix.is_empty() {
        return Err("Image path rejected.".into());
    }
    let mut entry = match archive.by_name(name) {
        Ok(entry) => entry,
        Err(_) => return Ok(None),
    };
    if entry.enclosed_name().is_none() {
        return Err("Image path rejected.".into());
    }
    let mut buf = Vec::new();
    entry
        .by_ref()
        .take(20 * 1024 * 1024)
        .read_to_end(&mut buf)
        .map_err(|err| err.to_string())?;
    let ext = util::sniff_ext(&buf);
    Ok(Some((buf, ext.to_string())))
}

fn fallback_title(file: &str) -> String {
    Path::new(file)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_uses_the_shared_package_shape() {
        let manifest = PackageManifest {
            format: FORMAT.into(),
            version: VERSION,
            playlist: PackagePlaylist {
                name: "Descida".into(),
                cover: Some("cover.jpg".into()),
                loop_mode: "playlist".into(),
            },
            tracks: vec![PackageTrack {
                file: "tracks/01.flac".into(),
                title: "Eurídice".into(),
                artist: "Orfeus".into(),
                album: "Rachadura".into(),
                lyrics: "Desci cantando.".into(),
                synced_lyrics: String::new(),
                cover: Some("covers/01.jpg".into()),
            }],
        };
        let json = serde_json::to_value(&manifest).unwrap();
        assert_eq!(json["format"], "orfeus-playlist");
        assert_eq!(json["version"], 1);
        assert_eq!(json["playlist"]["loopMode"], "playlist");
        assert_eq!(json["tracks"][0]["file"], "tracks/01.flac");
        let parsed: PackageManifest = serde_json::from_value(json).unwrap();
        assert_eq!(parsed, manifest);
    }

    #[test]
    fn package_roundtrip_keeps_metadata_off_the_original_path() {
        let root = std::env::temp_dir().join(format!("orfeus-pkg-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("covers")).unwrap();
        let db_path = root.join("library.db");
        let conn = crate::db::open(&db_path).unwrap();
        let audio = root.join("origem.wav");
        fs::write(&audio, b"RIFF....WAVE").unwrap();
        conn.execute(
            "INSERT INTO tracks (id, path, storage, content_hash, title, artist, album, duration_ms, cover_path, lyrics, missing, added_at)
             VALUES ('t1', ?1, 'linked', NULL, 'Eurídice', 'Orfeus', 'Rachadura', 1000, NULL, 'verso', 0, 1)",
            [audio.to_string_lossy().to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO playlists (id, name, cover_path, loop_mode, created_at) VALUES ('p1', 'Descida', NULL, 'track', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('p1', 't1', 0)",
            [],
        )
        .unwrap();
        let playlist = library::query_playlist(&conn, "p1").unwrap().unwrap();
        assert_eq!(playlist.track_ids, vec!["t1".to_string()]);
        assert_eq!(playlist.loop_mode, "track");
        let _ = fs::remove_dir_all(root);
    }
}
