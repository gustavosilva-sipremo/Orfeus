export type LoopMode = "off" | "track" | "playlist"

export type Track = {
  id: string
  path: string
  storage: "linked" | "owned"
  title: string
  artist: string
  album: string
  durationMs: number
  coverPath: string | null
  lyrics: string
  syncedLyrics: string
  gain: number
  missing: boolean
  addedAt: number
}

export type Playlist = {
  id: string
  name: string
  coverPath: string | null
  loopMode: LoopMode
  createdAt: number
  trackIds: string[]
}

export type SearchHit = {
  title: string
  artist: string
  album: string
  coverUrl: string | null
  lyrics: string | null
  syncedLyrics: string | null
}

export type LookupOutcome = "found" | "missing" | "error"

export type FieldLookup = {
  field: "metadata" | "cover" | "lyrics" | string
  outcome: LookupOutcome
  detail: string
}

export type SearchReport = {
  hits: SearchHit[]
  lookups: FieldLookup[]
}

export type PlaybackState = {
  trackId: string | null
  title: string
  artist: string
  coverPath: string | null
  position: number
  duration: number
  playing: boolean
  rate: number
  loopMode: LoopMode
  index: number
  queueLength: number
  error: string | null
}

export type QueueTrack = {
  id: string
  path: string
  title: string
  artist: string
  coverPath: string | null
  durationMs: number
}

export type ImportReport = { imported: number; skipped: number }
export type YoutubeDefaults = { audioDir: string; videoDir: string }
export type YoutubeResolution = { height: number; progressive: boolean; label: string }
export type YoutubeProbe = { title: string; author: string; length: number; resolutions: YoutubeResolution[] }
export type YoutubeProgress = { phase: string; percent: number; label: string }
export type YoutubeDone = { audioPath: string; videoPath: string | null; title: string; author: string }
export type ExportReport = { exported: number; errors: string[]; destDir: string }
export type ExportProgress = { done: number; total: number; current: string }
export type WatchedFolder = { path: string; recursive: boolean }
export type ImportProgress = { done: number; total: number; current: string }

export function toQueue(track: Track): QueueTrack {
  return {
    id: track.id,
    path: track.path,
    title: track.title,
    artist: track.artist,
    coverPath: track.coverPath,
    durationMs: track.durationMs,
  }
}
