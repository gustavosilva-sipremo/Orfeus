use rusqlite::{params, Connection};
use tauri::State;

use crate::models::{ListenDto, RecordListen};
use crate::util::now_secs;
use crate::AppState;

#[tauri::command]
pub fn record_listen(state: State<AppState>, input: RecordListen) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    save_listen(&conn, &input)
}

#[tauri::command]
pub fn list_listens(state: State<AppState>, from: i64, to: i64) -> Result<Vec<ListenDto>, String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    query_listens(&conn, from, to)
}

fn save_listen(conn: &Connection, input: &RecordListen) -> Result<i64, String> {
    if !input.seconds.is_finite() || input.seconds <= 0.0 || input.seconds > 6.0 * 60.0 * 60.0 {
        return Err("That listen length is not valid.".into());
    }
    let seconds = input.seconds.round() as i64;
    if seconds <= 0 {
        return Err("That listen length is not valid.".into());
    }
    let track_id = input.track_id.trim();
    if track_id.is_empty() {
        return Err("That track is missing.".into());
    }
    if let Some(play_id) = input.play_id {
        let updated = conn
            .execute(
                "UPDATE plays SET seconds = seconds + ?1 WHERE id = ?2 AND track_id = ?3",
                params![seconds, play_id, track_id],
            )
            .map_err(|err| err.to_string())?;
        if updated == 1 {
            return Ok(play_id);
        }
    }
    let title = input.title.trim();
    let title = if title.is_empty() { "Untitled" } else { title };
    conn.execute(
        "INSERT INTO plays (track_id, title, artist, cover_path, played_at, seconds) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![track_id, title, input.artist.trim(), input.cover_path, now_secs(), seconds],
    )
    .map_err(|err| err.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn clear_listens(state: State<AppState>, from: i64, to: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    conn.execute(
        "DELETE FROM plays WHERE played_at >= ?1 AND played_at < ?2",
        params![from, to],
    )
    .map(|_| ())
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn clear_all_listens(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|err| err.to_string())?;
    conn.execute("DELETE FROM plays", [])
        .map(|_| ())
        .map_err(|err| err.to_string())
}

fn query_listens(conn: &Connection, from: i64, to: i64) -> Result<Vec<ListenDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, track_id, title, artist, cover_path, played_at, seconds
             FROM plays
             WHERE played_at >= ?1 AND played_at < ?2
             ORDER BY played_at DESC
             LIMIT 2000",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![from, to], |row| {
            Ok(ListenDto {
                id: row.get(0)?,
                track_id: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                cover_path: row.get(4)?,
                played_at: row.get(5)?,
                seconds: row.get(6)?,
            })
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_listen_grows_and_stays_inside_its_period() {
        let root = std::env::temp_dir().join(format!("orfeus-listens-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let conn = crate::db::open(&root.join("library.db")).unwrap();
        let input = RecordListen {
            track_id: "t1".into(),
            title: "Eurídice".into(),
            artist: "Orfeus".into(),
            cover_path: None,
            seconds: 40.4,
            play_id: None,
        };
        let id = save_listen(&conn, &input).unwrap();
        let more = RecordListen {
            seconds: 20.0,
            play_id: Some(id),
            ..input
        };
        assert_eq!(save_listen(&conn, &more).unwrap(), id);
        let now = now_secs();
        let rows = query_listens(&conn, now - 60, now + 60).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].seconds, 60);
        assert!(query_listens(&conn, now + 120, now + 180)
            .unwrap()
            .is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
}
