import { invoke, isTauri } from "@tauri-apps/api/core"
import type {
  ExportReport,
  ImportReport,
  YoutubeDefaults,
  YoutubeDone,
  YoutubeProbe,
  Listen,
  SavedCover,
  WatchedFolder,
  LoopMode,
  OpticalDrive,
  PlaybackState,
  Playlist,
  QueueTrack,
  SearchReport,
  Shelf,
  Track,
} from "@/lib/types"

async function call<T>(command: string, args?: Record<string, unknown>) {
  return invoke<T>(command, args)
}

export function desktop() {
  return isTauri()
}

export function listTracks() {
  return call<Track[]>("list_tracks")
}

export function listPlaylists() {
  return call<Playlist[]>("list_playlists")
}

export function importPaths(paths: string[], recursive = true, watch = false, shelfId?: string) {
  return call<ImportReport>("import_paths", { paths, recursive, watch, shelfId })
}

export function listShelves() {
  return call<Shelf[]>("list_shelves")
}

export function createShelf(name: string, kind: Shelf["kind"]) {
  return call<Shelf>("create_shelf", { name, kind })
}

export function updateShelf(id: string, kind: Shelf["kind"]) {
  return call<Shelf>("update_shelf", { id, kind })
}

export function deleteShelf(id: string) {
  return call<void>("delete_shelf", { id })
}

export function listWatched() {
  return call<WatchedFolder[]>("list_watched")
}

export function unwatchFolder(path: string) {
  return call<void>("unwatch_folder", { path })
}

export function rescanFolders() {
  return call<number>("rescan_folders")
}

export function updateTrack(input: {
  id: string
  title: string
  artist: string
  album: string
  lyrics: string
  syncedLyrics?: string
  gain?: number
  coverSource?: string | null
  clearCover?: boolean
}) {
  return call<Track>("update_track", { input })
}

export function deleteTrack(id: string) {
  return call<void>("delete_track", { id })
}

export function listTrash() {
  return call<Track[]>("list_trash")
}

export function restoreTrack(id: string) {
  return call<void>("restore_track", { id })
}

export function purgeTrack(id: string) {
  return call<void>("purge_track", { id })
}

export function ensureFolder(path: string) {
  return call<string>("ensure_folder", { path })
}

export function listCovers() {
  return call<SavedCover[]>("list_covers")
}

export function deleteCover(path: string) {
  return call<void>("delete_cover", { path })
}

const previewListensKey = "orfeus-preview-listens"

function readPreviewListens(): Listen[] {
  try {
    const raw = JSON.parse(localStorage.getItem(previewListensKey) ?? "[]") as Listen[]
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export function recordListen(input: { trackId: string; title: string; artist: string; coverPath: string | null; seconds: number; playId: number | null }) {
  if (!desktop()) {
    const rows = readPreviewListens()
    if (input.playId != null) {
      const row = rows.find((item) => item.id === input.playId && item.trackId === input.trackId)
      if (row) {
        row.seconds += Math.round(input.seconds)
        localStorage.setItem(previewListensKey, JSON.stringify(rows))
        return Promise.resolve(row.id)
      }
    }
    const id = Date.now()
    rows.unshift({
      id,
      trackId: input.trackId,
      title: input.title,
      artist: input.artist,
      coverPath: input.coverPath,
      playedAt: Math.floor(Date.now() / 1000),
      seconds: Math.round(input.seconds),
    })
    localStorage.setItem(previewListensKey, JSON.stringify(rows))
    return Promise.resolve(id)
  }
  return call<number>("record_listen", { input })
}

export function listListens(from: number, to: number) {
  if (!desktop()) {
    return Promise.resolve(readPreviewListens().filter((item) => item.playedAt >= from && item.playedAt < to))
  }
  return call<Listen[]>("list_listens", { from, to })
}

export function clearListens(from: number, to: number) {
  return call<void>("clear_listens", { from, to })
}

export function clearAllListens() {
  return call<void>("clear_all_listens")
}

export function stageCover(bytes: Uint8Array) {
  return call<string>("stage_cover", { bytes: Array.from(bytes) })
}

export function createPlaylist(name: string) {
  return call<Playlist>("create_playlist", { name })
}

export function savePlaylist(input: {
  id: string
  name?: string
  loopMode?: LoopMode
  coverSource?: string | null
  clearCover?: boolean
  trackIds?: string[]
  favorite?: boolean
}) {
  return call<Playlist>("save_playlist", { input })
}

export function reorderTracks(ids: string[]) {
  return call<void>("reorder_tracks", { ids })
}

export function deletePlaylist(id: string) {
  return call<void>("delete_playlist", { id })
}

export function addToPlaylist(playlistId: string, trackIds: string[]) {
  return call<Playlist>("add_to_playlist", { playlistId, trackIds })
}

export function removeFromPlaylist(playlistId: string, trackId: string) {
  return call<Playlist>("remove_from_playlist", { playlistId, trackId })
}

export function movePlaylistTrack(playlistId: string, trackId: string, direction: number) {
  return call<Playlist>("move_playlist_track", { playlistId, trackId, direction })
}

export function searchMetadata(title: string, artist: string) {
  return call<SearchReport>("search_metadata", { title, artist })
}

export function fetchCover(url: string) {
  return call<string>("fetch_cover", { url })
}

export function exportTracks(trackIds: string[], destDir: string) {
  return call<ExportReport>("export_tracks", { trackIds, destDir })
}

export function extractPlaylist(playlistId: string, destDir: string) {
  return call<ExportReport>("extract_playlist", { playlistId, destDir })
}

export function revealPath(path: string) {
  return call<void>("reveal_path", { path })
}

export function exportPackage(playlistId: string, destPath: string) {
  return call<void>("export_package", { playlistId, destPath })
}

export function importPackage(path: string) {
  return call<string>("import_package", { path })
}

export function youtubeDefaults() {
  return call<YoutubeDefaults>("youtube_defaults")
}

export function youtubeProbe(url: string) {
  return call<YoutubeProbe>("youtube_probe", { url })
}

export function youtubeSkip() {
  return call<void>("youtube_skip")
}

export function youtubeDownload(request: {
  url: string
  audioDir: string
  videoDir: string
  keepVideo: boolean
  resolution?: number | null
}) {
  return call<YoutubeDone>("youtube_download", { request })
}

export function youtubeReveal(path: string) {
  return call<void>("youtube_reveal", { path })
}

export function retarget(tracks: QueueTrack[], index: number) {
  return call<void>("retarget", { tracks, index })
}

export function play(tracks: QueueTrack[], startIndex: number, loopMode: LoopMode) {
  return call<void>("play", {
    request: { tracks, startIndex, loopMode },
  })
}

export function toggle() {
  return call<void>("toggle")
}

export function seek(seconds: number) {
  return call<void>("seek", { seconds })
}

export function setRate(rate: number) {
  return call<void>("set_rate", { rate })
}

export function setLoop(mode: LoopMode) {
  return call<void>("set_loop", { mode })
}

export function setCrossfade(seconds: number) {
  return call<void>("set_crossfade", { seconds })
}

export function setVolume(volume: number) {
  return call<void>("set_volume", { volume })
}

export function setTrackGain(gain: number) {
  return call<void>("set_track_gain", { gain })
}

export function stop() {
  return call<void>("stop")
}

export function next() {
  return call<void>("next")
}

export function previous() {
  return call<void>("previous")
}

export function listDrives() {
  return call<OpticalDrive[]>("list_drives")
}

export function burnDisc(kind: "audio" | "cd" | "dvd", device: string, trackIds: string[]) {
  return call<void>("burn_disc", { kind, device, trackIds })
}

export function playbackState() {
  return call<PlaybackState>("playback_state")
}
