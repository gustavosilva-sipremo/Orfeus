import type { LoopMode, Track } from "@/lib/types"

export function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const remain = total % 60
  return `${minutes}:${remain.toString().padStart(2, "0")}`
}

export function formatDuration(ms: number) {
  return formatClock(ms / 1000)
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB"
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`
  const mb = bytes / 1024 ** 2
  if (mb >= 10) return `${Math.round(mb)} MB`
  if (mb >= 0.1) return `${mb.toFixed(1)} MB`
  return "0.1 MB"
}

export function formatListened(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total} s`
  return formatMinutes(total * 1000)
}

export function formatMinutes(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

export function tally(tracks: { sizeBytes?: number; durationMs: number }[]) {
  const bytes = tracks.reduce((sum, track) => sum + (track.sizeBytes ?? 0), 0)
  const ms = tracks.reduce((sum, track) => sum + track.durationMs, 0)
  return `${formatBytes(bytes)} · ${formatMinutes(ms)}`
}

export function nextCrossfade(seconds: number) {
  if (seconds < 1) return 1.5
  if (seconds < 2) return 3
  if (seconds < 4) return 5
  return 0
}

export function crossfadeLabel(seconds: number) {
  if (seconds < 1) return "Off"
  return `${seconds}s`
}

export function rateLabel(rate: number) {
  if (rate < 0.75) return "½×"
  if (rate > 1.5) return "2×"
  return "1×"
}

export function nextRate(rate: number) {
  if (rate < 0.75) return 1
  if (rate > 1.5) return 0.5
  return 2
}

export function loopLabel(mode: LoopMode) {
  if (mode === "track") return "Track"
  if (mode === "playlist") return "Playlist"
  return "Off"
}

export function nextLoop(mode: LoopMode): LoopMode {
  if (mode === "off") return "track"
  if (mode === "track") return "playlist"
  return "off"
}

export function isRecent(addedAt: number) {
  return addedAt > 1_000_000_000 && Date.now() / 1000 - addedAt < 7 * 24 * 60 * 60
}

export function artistLabel(artist: string) {
  return artist.trim() || "Unknown artist"
}

export function sourceKind(track: Pick<Track, "storage">) {
  return track.storage === "owned" ? "Package copy" : "File on disk"
}

export function sourceLabel(track: Pick<Track, "storage" | "path">) {
  if (track.storage === "owned") return "Package copy, stored inside Orfeus"
  const parts = track.path.split("/").filter(Boolean)
  if (parts.length < 2) return track.path
  return parts.slice(-3, -1).join("/")
}
