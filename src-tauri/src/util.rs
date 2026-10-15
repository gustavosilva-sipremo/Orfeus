use std::path::{Component, Path};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

pub fn is_audio_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if name.starts_with('.') {
        return false;
    }
    let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "mp3" | "flac" | "ogg" | "opus" | "wav" | "m4a" | "aac" | "mp4" | "alac"
    )
}

pub fn normalize_loop(mode: &str) -> &'static str {
    match mode {
        "track" => "track",
        "playlist" => "playlist",
        _ => "off",
    }
}

pub fn sanitize_name(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_alphanumeric() || ch == ' ' || ch == '-' || ch == '_' {
            out.push(ch);
        }
    }
    let trimmed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = trimmed.trim();
    if trimmed.is_empty() {
        "track".into()
    } else {
        trimmed.chars().take(80).collect()
    }
}

pub fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if is_avif(bytes) {
        Some("avif")
    } else {
        None
    }
}

pub fn sniff_ext(bytes: &[u8]) -> &'static str {
    image_ext(bytes).unwrap_or("jpg")
}

fn is_avif(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && &bytes[4..8] == b"ftyp" && matches!(&bytes[8..12], b"avif" | b"avis" | b"mif1")
}

pub fn safe_zip_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 240 || name.contains('\\') || name.starts_with('/') {
        return false;
    }
    Path::new(name)
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
}

pub fn remove_inside(root: &Path, target: &str) {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let path = Path::new(target);
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if canonical.starts_with(&root) || path.starts_with(&root) {
        let _ = std::fs::remove_file(&canonical);
        if canonical != path {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_common_audio_and_skips_the_rest() {
        assert!(is_audio_path(Path::new("/musica/disco/faixa.mp3")));
        assert!(is_audio_path(Path::new("Album/Song.FLAC")));
        assert!(is_audio_path(Path::new("voz.m4a")));
        assert!(!is_audio_path(Path::new("notas.txt")));
        assert!(!is_audio_path(Path::new(".escondida.mp3")));
        assert!(!is_audio_path(Path::new("sem-extensao")));
    }

    #[test]
    fn rejects_zip_slip() {
        assert!(safe_zip_name("tracks/01.flac"));
        assert!(safe_zip_name("cover.jpg"));
        assert!(!safe_zip_name("../segredo.mp3"));
        assert!(!safe_zip_name("/etc/passwd"));
        assert!(!safe_zip_name("tracks/../../x.mp3"));
        assert!(!safe_zip_name(""));
    }

    #[test]
    fn loop_mode_falls_back_to_off() {
        assert_eq!(normalize_loop("track"), "track");
        assert_eq!(normalize_loop("playlist"), "playlist");
        assert_eq!(normalize_loop("reverse"), "off");
    }
}
