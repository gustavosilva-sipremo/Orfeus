use std::path::Path;

use rusqlite::Connection;

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    storage TEXT NOT NULL CHECK (storage IN ('linked', 'owned')),
    content_hash TEXT,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    cover_path TEXT,
    lyrics TEXT NOT NULL DEFAULT '',
    missing INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cover_path TEXT,
    loop_mode TEXT NOT NULL DEFAULT 'off',
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order
    ON playlist_tracks (playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_tracks_hash ON tracks (content_hash);
";

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let conn = Connection::open(path).map_err(|err| err.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|err| err.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    ensure_column(conn, "tracks", "synced_lyrics", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(conn, "tracks", "gain", "REAL NOT NULL DEFAULT 1")?;
    ensure_column(conn, "tracks", "sort_index", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "tracks", "shelf_id", "TEXT NOT NULL DEFAULT ''")?;
    backfill_sort_index(conn)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS watched_folders (
            path TEXT PRIMARY KEY,
            recursive INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS dismissed_paths (
            path TEXT PRIMARY KEY
        );",
    )
    .map_err(|err| err.to_string())?;
    ensure_shelves(conn)
}

fn backfill_sort_index(conn: &Connection) -> Result<(), String> {
    let (count, distinct): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COUNT(DISTINCT sort_index) FROM tracks",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|err| err.to_string())?;
    if count <= 1 || distinct > 1 {
        return Ok(());
    }
    conn.execute_batch(
        "WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY added_at DESC, title COLLATE NOCASE) - 1 AS n
            FROM tracks
        )
        UPDATE tracks
        SET sort_index = ranked.n
        FROM ranked
        WHERE tracks.id = ranked.id;",
    )
    .map_err(|err| err.to_string())
}

fn ensure_shelves(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS shelves (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'music',
            created_at INTEGER NOT NULL
        );",
    )
    .map_err(|err| err.to_string())?;
    ensure_column(conn, "watched_folders", "shelf_id", "TEXT NOT NULL DEFAULT ''")?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM shelves", [], |row| row.get(0))
        .map_err(|err| err.to_string())?;
    if count == 0 {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO shelves (id, name, kind, created_at) VALUES (?1, 'Library', 'music', ?2)",
            rusqlite::params![id, crate::util::now_secs()],
        )
        .map_err(|err| err.to_string())?;
        conn.execute("UPDATE tracks SET shelf_id = ?1 WHERE shelf_id = ''", [id])
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, decl: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|err| err.to_string())?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    if names.iter().any(|name| name == column) {
        return Ok(());
    }
    conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"), [])
        .map_err(|err| err.to_string())?;
    Ok(())
}
