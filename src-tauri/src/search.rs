use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::State;

use crate::models::{FieldLookup, SearchHit, SearchReport};
use crate::util;
use crate::AppState;

static SEARCH_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static SEARCH_CACHE: Mutex<Option<HashMap<String, CacheEntry>>> = Mutex::new(None);
static MB_NEXT: Mutex<Option<Instant>> = Mutex::new(None);

struct CacheEntry {
    at: Instant,
    report: SearchReport,
}

#[tauri::command]
pub async fn search_metadata(
    state: State<'_, AppState>,
    title: String,
    artist: String,
) -> Result<SearchReport, String> {
    let title = title.trim().to_string();
    let artist = artist.trim().to_string();
    if title.is_empty() && artist.is_empty() {
        return Err("Enter a title or an artist to search.".into());
    }
    let key = format!("{}|{}", title.to_lowercase(), artist.to_lowercase());
    let _gate = SEARCH_GATE.lock().await;
    if let Some(report) = cache_get(&key) {
        return Ok(report);
    }
    let report = search_sources(&state, &title, &artist).await?;
    cache_put(&key, report.clone());
    Ok(report)
}

async fn search_sources(
    state: &AppState,
    title: &str,
    artist: &str,
) -> Result<SearchReport, String> {
    let client = http_client()?;
    let (recordings, mb_err) = match musicbrainz(&client, title, artist).await {
        Ok(items) => (items, None),
        Err(err) => {
            eprintln!("orfeus musicbrainz: {err}");
            (Vec::new(), Some(err))
        }
    };
    let (lyrics, lrc_err) = match lrclib(&client, title, artist).await {
        Ok(items) => (items, None),
        Err(err) => {
            eprintln!("orfeus lrclib: {err}");
            (Vec::new(), Some(err))
        }
    };
    let mut hits = Vec::new();
    let mut cover_failed = false;
    let mut cover_notes = Vec::new();
    for recording in recordings {
        let mut hit = SearchHit {
            title: recording.title,
            artist: recording.artist,
            album: recording.album,
            cover_url: None,
            lyrics: None,
            synced_lyrics: None,
        };
        let cover = resolve_cover(
            &client,
            &state.data_dir,
            &recording.releases,
            &hit.title,
            &hit.artist,
        )
        .await;
        cover_failed |= cover.failed;
        if cover.path.is_none() {
            cover_notes.push(cover.detail);
        }
        hit.cover_url = cover.path;
        hits.push(hit);
    }
    let lyric_text = lyrics.into_iter().next().map(|lyric| {
        let synced = lyric.synced_lyrics.filter(|value| value.contains('['));
        let text = synced
            .as_deref()
            .map(strip_lrc)
            .filter(|value| !value.trim().is_empty())
            .or(lyric.plain_lyrics);
        (
            lyric.track_name,
            lyric.artist_name,
            lyric.album_name,
            text,
            synced,
        )
    });
    if let Some((track_name, artist_name, album_name, text, synced)) = lyric_text {
        if hits.is_empty() {
            let mut hit = SearchHit {
                title: track_name,
                artist: artist_name,
                album: album_name.unwrap_or_default(),
                cover_url: None,
                lyrics: text,
                synced_lyrics: synced,
            };
            let cover = resolve_cover(&client, &state.data_dir, &[], &hit.title, &hit.artist).await;
            cover_failed |= cover.failed;
            if cover.path.is_none() {
                cover_notes.push(cover.detail);
            }
            hit.cover_url = cover.path;
            hits.push(hit);
        } else {
            let index = hits
                .iter()
                .position(|hit| eq_loose(&hit.title, &track_name))
                .unwrap_or(0);
            if let Some(text) = text {
                hits[index].lyrics = Some(text);
            }
            hits[index].synced_lyrics = synced;
            if hits[index].album.is_empty() {
                if let Some(album) = album_name {
                    hits[index].album = album;
                }
            }
        }
    }
    let lookups = build_lookups(
        &hits,
        mb_err.as_deref(),
        lrc_err.as_deref(),
        cover_failed,
        &cover_notes,
    );
    Ok(SearchReport { hits, lookups })
}

fn build_lookups(
    hits: &[SearchHit],
    mb_err: Option<&str>,
    lrc_err: Option<&str>,
    cover_failed: bool,
    cover_notes: &[String],
) -> Vec<FieldLookup> {
    let has_meta = !hits.is_empty();
    let metadata = if has_meta {
        let note = match mb_err {
            Some(err) => format!(
                "Found from the lyric catalog. MusicBrainz failed ({}), so some editions may be missing.",
                http_status_label(err)
            ),
            None => format!(
                "{} {} from MusicBrainz.",
                hits.len(),
                if hits.len() == 1 { "match" } else { "matches" }
            ),
        };
        lookup("metadata", "found", note)
    } else if mb_err.is_some() || lrc_err.is_some() {
        lookup(
            "metadata",
            "error",
            format!(
                "Search failed. {} This is a lookup error, not an empty catalog.",
                join_source_errors(mb_err, lrc_err)
            ),
        )
    } else {
        lookup(
            "metadata",
            "missing",
            "No recording matches this title and artist.",
        )
    };

    let has_lyrics = hits.iter().any(|hit| {
        hit.lyrics
            .as_deref()
            .is_some_and(|text| !text.trim().is_empty())
            || hit
                .synced_lyrics
                .as_deref()
                .is_some_and(|text| text.contains('['))
    });
    let timed = hits.iter().any(|hit| {
        hit.synced_lyrics
            .as_deref()
            .is_some_and(|text| text.contains('['))
    });
    let lyrics = if has_lyrics {
        lookup(
            "lyrics",
            "found",
            if timed {
                "Timed lyrics from LRCLIB."
            } else {
                "Lyrics from LRCLIB, without timestamps."
            },
        )
    } else if let Some(err) = lrc_err {
        lookup(
            "lyrics",
            "error",
            format!(
                "LRCLIB failed ({}). Lyrics were not checked.",
                http_status_label(err)
            ),
        )
    } else if has_meta {
        lookup(
            "lyrics",
            "missing",
            "The catalog lists this recording, without lyrics.",
        )
    } else if mb_err.is_some() {
        lookup(
            "lyrics",
            "error",
            "Lyrics were not checked because the search failed.",
        )
    } else {
        lookup(
            "lyrics",
            "missing",
            "No lyrics are published for this title and artist.",
        )
    };

    let has_cover = hits.iter().any(|hit| hit.cover_url.is_some());
    let cover = if has_cover {
        lookup(
            "cover",
            "found",
            "Cover from Cover Art Archive, or iTunes when that archive has none.",
        )
    } else if !has_meta && (mb_err.is_some() || lrc_err.is_some()) {
        lookup(
            "cover",
            "error",
            "Cover art was not searched because the catalog request failed.",
        )
    } else if cover_failed {
        let note = cover_notes.first().cloned().unwrap_or_else(|| {
            "Cover servers failed. This is a lookup error, not a missing image.".into()
        });
        lookup("cover", "error", note)
    } else {
        lookup(
            "cover",
            "missing",
            cover_notes
                .first()
                .cloned()
                .unwrap_or_else(|| "No cover art is published for this recording.".into()),
        )
    };
    vec![metadata, cover, lyrics]
}

fn lookup(field: &str, outcome: &str, detail: impl Into<String>) -> FieldLookup {
    FieldLookup {
        field: field.to_string(),
        outcome: outcome.to_string(),
        detail: detail.into(),
    }
}

fn join_source_errors(mb_err: Option<&str>, lrc_err: Option<&str>) -> String {
    match (mb_err, lrc_err) {
        (Some(mb), Some(lrc)) => format!(
            "MusicBrainz: {}. LRCLIB: {}.",
            http_status_label(mb),
            http_status_label(lrc)
        ),
        (Some(mb), None) => format!("MusicBrainz: {}.", http_status_label(mb)),
        (None, Some(lrc)) => format!("LRCLIB: {}.", http_status_label(lrc)),
        (None, None) => "The catalog did not respond.".into(),
    }
}

fn http_status_label(err: &str) -> String {
    if let Some(start) = err.find('(') {
        let rest = &err[start + 1..];
        if let Some(end) = rest.find(')') {
            let label = &rest[..end];
            if label.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
                return label.to_string();
            }
        }
    }
    let lower = err.to_ascii_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") {
        return "the request timed out".into();
    }
    "the request failed".into()
}

fn cache_get(key: &str) -> Option<SearchReport> {
    let guard = SEARCH_CACHE
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let entry = guard.as_ref()?.get(key)?;
    let ttl = if entry
        .report
        .lookups
        .iter()
        .any(|item| item.outcome == "error")
    {
        Duration::from_secs(15)
    } else {
        Duration::from_secs(180)
    };
    (entry.at.elapsed() < ttl).then(|| entry.report.clone())
}

fn cache_put(key: &str, report: SearchReport) {
    let mut guard = SEARCH_CACHE
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let cache = guard.get_or_insert_with(HashMap::new);
    cache.retain(|_, entry| entry.at.elapsed() < Duration::from_secs(180));
    cache.insert(
        key.to_string(),
        CacheEntry {
            at: Instant::now(),
            report,
        },
    );
}

#[tauri::command]
pub async fn fetch_cover(state: State<'_, AppState>, url: String) -> Result<String, String> {
    if !cover_host_allowed(&url) {
        return Err("That cover address is not allowed.".into());
    }
    let bytes = download_bytes(&url).await?;
    write_cover(&state.data_dir, &bytes)
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Orfeus/0.1.0 (local music library)")
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|err| err.to_string())
}

fn cover_host_allowed(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    match parsed.host_str() {
        Some("coverartarchive.org") | Some("archive.org") => true,
        Some(host) if host.ends_with(".archive.org") || host.ends_with(".mzstatic.com") => true,
        _ => false,
    }
}

fn best_album(releases: &[MbRelease]) -> String {
    releases
        .iter()
        .find(|release| release.status.as_deref() == Some("Official") && is_album(release))
        .and_then(|release| release.title.clone())
        .or_else(|| {
            releases
                .iter()
                .find(|release| release.status.as_deref() == Some("Official"))
                .and_then(|release| release.title.clone())
        })
        .or_else(|| releases.first().and_then(|release| release.title.clone()))
        .unwrap_or_default()
}

fn is_album(release: &MbRelease) -> bool {
    release
        .release_group
        .as_ref()
        .and_then(|group| group.primary_type.as_deref())
        == Some("Album")
}

fn cover_indexes(releases: &[MbRelease]) -> Vec<String> {
    let mut urls = Vec::new();
    let mut push = |url: String| {
        if !urls.contains(&url) {
            urls.push(url);
        }
    };
    for release in releases {
        if release.status.as_deref() == Some("Official") && is_album(release) {
            if let Some(group) = &release.release_group {
                push(format!(
                    "https://coverartarchive.org/release-group/{}",
                    group.id
                ));
            }
        }
    }
    for release in releases {
        if release.status.as_deref() == Some("Official") {
            push(format!(
                "https://coverartarchive.org/release/{}",
                release.id
            ));
        }
    }
    for release in releases {
        if let Some(group) = &release.release_group {
            push(format!(
                "https://coverartarchive.org/release-group/{}",
                group.id
            ));
        }
        push(format!(
            "https://coverartarchive.org/release/{}",
            release.id
        ));
    }
    urls.truncate(4);
    urls
}

struct CoverResult {
    path: Option<String>,
    failed: bool,
    detail: String,
}

async fn resolve_cover(
    client: &reqwest::Client,
    data_dir: &Path,
    releases: &[MbRelease],
    title: &str,
    artist: &str,
) -> CoverResult {
    let mut misses = 0;
    let mut failure: Option<String> = None;
    for index in cover_indexes(releases) {
        match caa_front(client, &index).await {
            Front::Absent => misses += 1,
            Front::Failed(err) => {
                failure.get_or_insert(err);
            }
            Front::Present => match download_cover(data_dir, &format!("{index}/front-250")).await {
                Some(path) => {
                    return CoverResult {
                        path: Some(path),
                        failed: false,
                        detail: "Cover Art Archive".into(),
                    };
                }
                None => {
                    failure.get_or_insert_with(|| {
                        "Cover Art Archive did not return the image.".into()
                    });
                }
            },
        }
    }
    match itunes_cover(client, data_dir, title, artist).await {
        Ok(Some(path)) => {
            return CoverResult {
                path: Some(path),
                failed: false,
                detail: "iTunes".into(),
            };
        }
        Err(err) => {
            if misses > 0 && failure.is_none() {
                CoverResult {
                    path: None,
                    failed: false,
                    detail: "No cover art is published for this recording.".into(),
                }
            } else {
                CoverResult {
                    path: None,
                    failed: true,
                    detail: format!(
                        "Cover lookup failed ({}).",
                        http_status_label(&failure.unwrap_or(err))
                    ),
                }
            }
        }
        Ok(None) => {
            if let Some(err) = failure {
                if misses == 0 {
                    CoverResult {
                        path: None,
                        failed: true,
                        detail: format!("Cover lookup failed ({}).", http_status_label(&err)),
                    }
                } else {
                    CoverResult {
                        path: None,
                        failed: true,
                        detail: format!(
                            "No artwork on the releases that answered. Other cover servers failed ({}).",
                            http_status_label(&err)
                        ),
                    }
                }
            } else {
                CoverResult {
                    path: None,
                    failed: false,
                    detail: "No cover art is published for this recording.".into(),
                }
            }
        }
    }
}

enum Front {
    Present,
    Absent,
    Failed(String),
}

async fn caa_front(client: &reqwest::Client, index: &str) -> Front {
    let response =
        match tokio::time::timeout(Duration::from_secs(6), client.get(index).send()).await {
            Ok(Ok(response)) => response,
            Ok(Err(err)) => return Front::Failed(err.to_string()),
            Err(_) => return Front::Failed("the request timed out".into()),
        };
    let status = response.status();
    if status.as_u16() == 404 {
        return Front::Absent;
    }
    if !status.is_success() {
        return Front::Failed(format!("HTTP status {status}"));
    }
    let Ok(text) = response.text().await else {
        return Front::Failed("the cover index could not be read".into());
    };
    if text.contains("\"front\":true") || text.contains("\"front\": true") {
        Front::Present
    } else {
        Front::Absent
    }
}

async fn itunes_cover(
    client: &reqwest::Client,
    data_dir: &Path,
    title: &str,
    artist: &str,
) -> Result<Option<String>, String> {
    let term = format!("{artist} {title}")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if term.is_empty() {
        return Ok(None);
    }
    let response = match tokio::time::timeout(
        Duration::from_secs(6),
        client
            .get("https://itunes.apple.com/search")
            .query(&[
                ("term", term.as_str()),
                ("media", "music"),
                ("entity", "song"),
                ("limit", "1"),
            ])
            .send(),
    )
    .await
    {
        Ok(Ok(response)) => response,
        Ok(Err(err)) => return Err(err.to_string()),
        Err(_) => return Err("the request timed out".into()),
    };
    if !response.status().is_success() {
        return Err(format!("HTTP status {}", response.status()));
    }
    let Ok(body) = response.json::<ItunesResponse>().await else {
        return Err("the artwork response could not be read".into());
    };
    let Some(url) = body.results.into_iter().find_map(|item| {
        item.artwork_url_100
            .map(|url| url.replace("100x100bb", "600x600bb"))
    }) else {
        return Ok(None);
    };
    download_cover(data_dir, &url)
        .await
        .map(Some)
        .ok_or_else(|| "the artwork download failed".to_string())
}

async fn download_cover(data_dir: &Path, url: &str) -> Option<String> {
    if !cover_host_allowed(url) {
        return None;
    }
    let bytes = download_bytes(url).await.ok()?;
    write_cover(data_dir, &bytes).ok()
}

fn cover_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Orfeus/0.1.0 (local music library)")
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|err| err.to_string())
}

async fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let client = cover_client()?;
    let mut current =
        reqwest::Url::parse(url).map_err(|_| "That cover address is not allowed.".to_string())?;
    for _ in 0..5 {
        if !cover_host_allowed(current.as_str()) {
            return Err("That cover address is not allowed.".into());
        }
        let response =
            tokio::time::timeout(Duration::from_secs(20), client.get(current.clone()).send())
                .await
                .map_err(|_| "The cover lookup timed out.".to_string())?
                .map_err(|err| err.to_string())?;
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "Cover not found.".to_string())?;
            current = current
                .join(location)
                .map_err(|_| "Cover not found.".to_string())?;
            continue;
        }
        if !status.is_success() {
            return Err("Cover not found.".into());
        }
        let bytes = response.bytes().await.map_err(|err| err.to_string())?;
        if bytes.len() > 15 * 1024 * 1024 {
            return Err("The cover is too large.".into());
        }
        if util::image_ext(&bytes).is_none() {
            return Err("The cover is not a supported image.".into());
        }
        return Ok(bytes.to_vec());
    }
    Err("The cover lookup timed out.".into())
}

fn write_cover(data_dir: &Path, bytes: &[u8]) -> Result<String, String> {
    let ext =
        util::image_ext(bytes).ok_or_else(|| "The cover is not a supported image.".to_string())?;
    let dir = data_dir.join("cover-drops");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && std::fs::read(&path).ok().as_deref() == Some(bytes) {
                return Ok(path.to_string_lossy().to_string());
            }
        }
    }
    let dest = dir.join(format!("{}.{ext}", uuid::Uuid::new_v4()));
    std::fs::write(&dest, bytes).map_err(|err| err.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

struct RecordingHit {
    title: String,
    artist: String,
    album: String,
    releases: Vec<MbRelease>,
}

struct LyricHit {
    track_name: String,
    artist_name: String,
    album_name: Option<String>,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
}

async fn musicbrainz(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
) -> Result<Vec<RecordingHit>, String> {
    let mut query = Vec::new();
    if !title.is_empty() {
        query.push(format!("recording:\"{}\"", lucene(title)));
    }
    if !artist.is_empty() {
        query.push(format!("artist:\"{}\"", lucene(artist)));
    }
    let query = query.join(" AND ");
    let response = send_retry(
        || {
            client
                .get("https://musicbrainz.org/ws/2/recording/")
                .query(&[("query", query.as_str()), ("fmt", "json"), ("limit", "5")])
        },
        true,
    )
    .await?;
    let body: MbResponse = response.json().await.map_err(|err| err.to_string())?;
    Ok(body
        .recordings
        .into_iter()
        .map(|recording| {
            let artist = recording
                .artist_credit
                .unwrap_or_default()
                .into_iter()
                .filter_map(|credit| {
                    credit
                        .name
                        .or_else(|| credit.artist.map(|artist| artist.name))
                })
                .collect::<Vec<_>>()
                .join(", ");
            let releases = recording.releases.unwrap_or_default();
            RecordingHit {
                title: recording.title,
                artist,
                album: best_album(&releases),
                releases,
            }
        })
        .collect())
}

async fn lrclib(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
) -> Result<Vec<LyricHit>, String> {
    let response = send_retry(
        || {
            client
                .get("https://lrclib.net/api/search")
                .query(&[("track_name", title), ("artist_name", artist)])
        },
        false,
    )
    .await?;
    let body: Vec<LrcItem> = response.json().await.map_err(|err| err.to_string())?;
    Ok(body
        .into_iter()
        .take(5)
        .map(|item| LyricHit {
            track_name: item.track_name,
            artist_name: item.artist_name,
            album_name: item.album_name,
            plain_lyrics: item.plain_lyrics,
            synced_lyrics: item.synced_lyrics,
        })
        .collect())
}

async fn send_retry(
    build: impl Fn() -> reqwest::RequestBuilder,
    pace: bool,
) -> Result<reqwest::Response, String> {
    let mut last = "the request failed".to_string();
    for attempt in 0..2 {
        if pace {
            wait_musicbrainz().await;
        } else if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(700)).await;
        }
        let response = match build().send().await {
            Ok(response) => response,
            Err(err) => {
                last = err.to_string();
                continue;
            }
        };
        let status = response.status();
        if status.as_u16() == 503 || status.as_u16() == 429 {
            last = format!("HTTP status server error ({status})");
            continue;
        }
        return response.error_for_status().map_err(|err| err.to_string());
    }
    Err(last)
}

async fn wait_musicbrainz() {
    loop {
        let delay = {
            let mut next = MB_NEXT.lock().unwrap_or_else(|poison| poison.into_inner());
            let now = Instant::now();
            match *next {
                Some(at) if at > now => Some(at.saturating_duration_since(now)),
                _ => {
                    *next = Some(now + Duration::from_millis(1100));
                    None
                }
            }
        };
        match delay {
            None => return,
            Some(wait) => tokio::time::sleep(wait).await,
        }
    }
}

fn lucene(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '+' | '-' | '!' | '(' | ')' | '{' | '}' | '[' | ']' | '^' | '"' | '~' | '*' | '?'
            | ':' | '\\' | '/' => ' ',
            _ => ch,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn eq_loose(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

pub fn strip_lrc(input: &str) -> String {
    input
        .lines()
        .map(|line| {
            let mut rest = line.trim();
            while rest.starts_with('[') {
                let Some(end) = rest.find(']') else { break };
                let tag = &rest[1..end];
                let timed = tag
                    .chars()
                    .next()
                    .map(|ch| ch.is_ascii_digit())
                    .unwrap_or(false);
                if !timed {
                    break;
                }
                rest = rest[end + 1..].trim_start();
            }
            rest
        })
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Deserialize)]
struct MbResponse {
    recordings: Vec<MbRecording>,
}

#[derive(Deserialize)]
struct MbRecording {
    title: String,
    #[serde(rename = "artist-credit", default)]
    artist_credit: Option<Vec<MbCredit>>,
    releases: Option<Vec<MbRelease>>,
}

#[derive(Deserialize)]
struct MbCredit {
    name: Option<String>,
    artist: Option<MbArtist>,
}

#[derive(Deserialize)]
struct MbArtist {
    name: String,
}

#[derive(Deserialize)]
struct MbRelease {
    id: String,
    title: Option<String>,
    status: Option<String>,
    #[serde(rename = "release-group")]
    release_group: Option<MbReleaseGroup>,
}

#[derive(Deserialize)]
struct MbReleaseGroup {
    id: String,
    #[serde(rename = "primary-type")]
    primary_type: Option<String>,
}

#[derive(Deserialize)]
struct ItunesResponse {
    #[serde(default)]
    results: Vec<ItunesTrack>,
}

#[derive(Deserialize)]
struct ItunesTrack {
    #[serde(rename = "artworkUrl100")]
    artwork_url_100: Option<String>,
}

#[derive(Deserialize)]
struct LrcItem {
    #[serde(rename = "trackName")]
    track_name: String,
    #[serde(rename = "artistName")]
    artist_name: String,
    #[serde(rename = "albumName")]
    album_name: Option<String>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{
        build_lookups, cover_host_allowed, cover_indexes, strip_lrc, MbRelease, MbReleaseGroup,
    };

    #[test]
    fn strips_timestamps_and_keeps_the_verse() {
        let text = strip_lrc("[00:12.00]Desci cantando\n[00:16.40]até a rachadura\n[ar:Orfeus]");
        assert_eq!(text, "Desci cantando\naté a rachadura\n[ar:Orfeus]");
    }

    #[test]
    fn a_server_error_is_not_an_empty_catalog() {
        let lookups = build_lookups(
            &[],
            Some("HTTP status server error (503 Service Unavailable) for url (https://musicbrainz.org)"),
            Some("HTTP status server error (503 Service Unavailable) for url (https://lrclib.net)"),
            false,
            &[],
        );
        assert!(lookups.iter().all(|item| item.outcome == "error"));
        assert!(lookups[0].detail.contains("503"));
        assert!(lookups[2].detail.contains("503"));
    }

    #[test]
    fn an_empty_catalog_is_missing_information() {
        let lookups = build_lookups(&[], None, None, false, &[]);
        assert!(lookups.iter().all(|item| item.outcome == "missing"));
    }

    #[test]
    fn prefers_the_official_album_cover() {
        let releases = vec![
            MbRelease {
                id: "boot".into(),
                title: Some("Ao vivo".into()),
                status: Some("Bootleg".into()),
                release_group: None,
            },
            MbRelease {
                id: "alb".into(),
                title: Some("Rachadura".into()),
                status: Some("Official".into()),
                release_group: Some(MbReleaseGroup {
                    id: "rg1".into(),
                    primary_type: Some("Album".into()),
                }),
            },
        ];
        let urls = cover_indexes(&releases);
        assert_eq!(urls[0], "https://coverartarchive.org/release-group/rg1");
    }

    #[test]
    fn cover_hosts_follow_the_archive_redirect() {
        assert!(cover_host_allowed(
            "https://coverartarchive.org/release/x/front-250"
        ));
        assert!(cover_host_allowed(
            "https://archive.org/download/mbid/front.jpg"
        ));
        assert!(cover_host_allowed(
            "https://ia800.us.archive.org/0/items/x/front.jpg"
        ));
        assert!(cover_host_allowed(
            "https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.jpg"
        ));
        assert!(!cover_host_allowed("https://example.com/cover.jpg"));
        assert!(!cover_host_allowed("http://archive.org/cover.jpg"));
    }
}
