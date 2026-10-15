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
