use std::fs::File;
use std::path::Path;

use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{Picture, PictureType};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag};

#[derive(Debug, Default)]
pub struct RawTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub lyrics: Option<String>,
    pub duration_ms: i64,
    pub picture: Option<(Vec<u8>, String)>,
}

pub fn read_tags(path: &Path) -> RawTags {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| read_tags_inner(path))) {
        Ok(tags) => tags,
        Err(_) => RawTags::default(),
    }
}

fn read_tags_inner(path: &Path) -> RawTags {
    let mut raw = RawTags::default();
    let Ok(tagged) = (|| Probe::open(path)?.read())() else {
        return raw;
    };
    raw.duration_ms = i64::try_from(tagged.properties().duration().as_millis()).unwrap_or(0);
    if let Some(tag) = tagged.primary_tag() {
        raw.title = nonempty(tag.title());
        raw.artist = nonempty(tag.artist());
        raw.album = nonempty(tag.album());
        raw.lyrics = tag
            .get_string(&ItemKey::Lyrics)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
    }
    raw.picture = take_picture(&tagged);
    raw
}

fn take_picture(tagged: &lofty::file::TaggedFile) -> Option<(Vec<u8>, String)> {
    let mut fallback = None;
    for tag in tagged.tags() {
        for picture in tag.pictures() {
            let Some(ext) = crate::util::image_ext(picture.data()) else {
                continue;
            };
            let item = (picture.data().to_vec(), ext.to_string());
            if picture.pic_type() == PictureType::CoverFront {
                return Some(item);
            }
            if fallback.is_none() {
                fallback = Some(item);
            }
        }
    }
    fallback
}

pub fn write_tags(
    path: &Path,
    title: &str,
    artist: &str,
    album: &str,
    lyrics: &str,
    synced_lyrics: &str,
    cover_path: Option<&Path>,
) -> Result<(), String> {
    let mut tagged = Probe::open(path)
        .map_err(|err| err.to_string())?
        .read()
        .map_err(|err| err.to_string())?;
    if tagged.primary_tag().is_none() {
        let tag_type = tagged.primary_tag_type();
        tagged.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged
        .primary_tag_mut()
        .ok_or_else(|| "This format does not accept tags.".to_string())?;
    tag.set_title(title.to_string());
    tag.set_artist(artist.to_string());
    tag.set_album(album.to_string());
    tag.remove_key(&ItemKey::Lyrics);
    let stored = stored_lyrics(lyrics, synced_lyrics);
    if !stored.is_empty() {
        tag.insert_text(ItemKey::Lyrics, stored);
    }
    if let Some(cover) = cover_path {
        let mut file = File::open(cover).map_err(|err| err.to_string())?;
        let mut picture = Picture::from_reader(&mut file).map_err(|err| err.to_string())?;
        picture.set_pic_type(PictureType::CoverFront);
        let front: Vec<usize> = tag
            .pictures()
            .iter()
            .enumerate()
            .filter(|(_, picture)| picture.pic_type() == PictureType::CoverFront)
            .map(|(index, _)| index)
            .collect();
        for index in front.into_iter().rev() {
            tag.remove_picture(index);
        }
        tag.push_picture(picture);
    }
    tagged
        .save_to_path(path, WriteOptions::default())
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn stored_lyrics(plain: &str, synced: &str) -> String {
    let plain = plain.trim();
    let synced = synced.trim();
    if plain.is_empty() {
        synced.to_string()
    } else if synced.is_empty() || synced == plain {
        plain.to_string()
    } else {
        format!("{plain}\n\n{synced}")
    }
}

fn nonempty(value: Option<impl AsRef<str>>) -> Option<String> {
    value
        .map(|item| item.as_ref().trim().to_string())
        .filter(|item| !item.is_empty())
}
