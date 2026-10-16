use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackDto {
    pub id: String,
    pub path: String,
    pub storage: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: i64,
    pub cover_path: Option<String>,
    pub lyrics: String,
    pub synced_lyrics: String,
    pub gain: f32,
    pub missing: bool,
    pub added_at: i64,
    pub shelf_id: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDto {
    pub id: String,
    pub name: String,
    pub cover_path: Option<String>,
    pub loop_mode: String,
    pub created_at: i64,
    pub track_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub lyrics: String,
    #[serde(default)]
    pub synced_lyrics: Option<String>,
    #[serde(default)]
    pub gain: Option<f32>,
    #[serde(default)]
    pub cover_source: Option<String>,
    #[serde(default)]
    pub clear_cover: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePlaylist {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub loop_mode: Option<String>,
    #[serde(default)]
    pub cover_source: Option<String>,
    #[serde(default)]
    pub clear_cover: bool,
    #[serde(default)]
    pub track_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover_url: Option<String>,
    pub lyrics: Option<String>,
    pub synced_lyrics: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldLookup {
    pub field: String,
    pub outcome: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchReport {
    pub hits: Vec<SearchHit>,
    pub lookups: Vec<FieldLookup>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueTrack {
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub cover_path: Option<String>,
    #[serde(default)]
    pub duration_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest {
    pub tracks: Vec<QueueTrack>,
    pub start_index: usize,
    #[serde(default)]
    pub loop_mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub done: usize,
    pub total: usize,
    pub current: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub exported: usize,
    pub errors: Vec<String>,
    pub dest_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub done: usize,
    pub total: usize,
    pub current: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolder {
    pub path: String,
    pub recursive: bool,
    pub shelf_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfDto {
    pub id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub track_id: Option<String>,
    pub title: String,
    pub artist: String,
    pub cover_path: Option<String>,
    pub position: f64,
    pub duration: f64,
    pub playing: bool,
    pub rate: f32,
    pub loop_mode: String,
    pub index: usize,
    pub queue_length: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackageTrack {
    pub file: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub lyrics: String,
    #[serde(default)]
    pub synced_lyrics: String,
    pub cover: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackagePlaylist {
    pub name: String,
    pub cover: Option<String>,
    pub loop_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackageManifest {
    pub format: String,
    pub version: u32,
    pub playlist: PackagePlaylist,
    pub tracks: Vec<PackageTrack>,
}
