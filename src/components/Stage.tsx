import { Library, Music, Pause, Play, Podcast, RotateCcw, RotateCw, SkipBack, SkipForward, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Cover } from "@/components/Cover"
import { quietBands, StageCanvas } from "@/components/Visualizer"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { artistLabel, formatClock } from "@/lib/format"
import { activeLine, parseLyrics, plainFromLrc, shiftLrc, stampLine } from "@/lib/lyrics"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"
import { usePlayer } from "@/stores/player"

const offsetKey = (id: string) => `orfeus-lyric-offset:${id}`
const layoutKey = "orfeus-stage-layout"

type StageLayout = { lyrics: boolean }

function readLayout(): StageLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(layoutKey) ?? "") as Partial<StageLayout>
    return { lyrics: raw.lyrics !== false }
  } catch {
    return { lyrics: true }
  }
}

export function Stage() {
  const open = usePlayer((state) => state.stageOpen)
  const close = usePlayer((state) => state.setStageOpen)
  const [layout, setLayout] = useState<StageLayout>(readLayout)

  function toggleLyrics() {
    setLayout((current) => {
      const next = { lyrics: !current.lyrics }
      localStorage.setItem(layoutKey, JSON.stringify(next))
      return next
    })
  }

  return (
    <div className={open ? "visible fixed inset-0 z-40 opacity-100" : "pointer-events-none invisible fixed inset-0 z-40 opacity-0"} aria-hidden={!open}>
      <div className="relative flex h-full flex-col bg-transparent">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_42%,rgba(0,0,0,0.62)_100%)]" />
        <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 p-3 sm:p-4">
          <SourceBadge />
          <div className="ml-auto flex items-center gap-2">
          <LayoutButton on={layout.lyrics} label="Lyrics" onClick={toggleLyrics} />
          <button type="button" className="flex size-11 cursor-pointer items-center justify-center rounded-md border border-[#3a3a3a] bg-[#1c1c1c] text-white" onClick={() => close(false)} aria-label="Close stage">
            <X className="size-6" />
          </button>
          </div>
        </div>
        <div className={`relative z-10 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-16 sm:px-6 sm:pb-20 lg:overflow-hidden ${layout.lyrics ? "lg:grid lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-8" : "items-center justify-center"}`}>
          <ArtworkPanel live={open} />
          {layout.lyrics ? <LyricsPanel /> : null}
        </div>
      </div>
    </div>
  )
}

function SourceBadge() {
  const playlistId = usePlayer((state) => state.playlistId)
  const trackId = usePlayer((state) => state.trackId)
  const playlist = useLibrary((state) => state.playlists.find((item) => item.id === playlistId))
  const track = useLibrary((state) => state.tracks.find((item) => item.id === trackId))
  const shelf = useLibrary((state) => state.shelves.find((item) => item.id === track?.shelfId))
  if (playlist) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-white/10 bg-black/40 px-2 py-1 backdrop-blur">
        <Cover path={playlist.coverPath} className="size-8 rounded" />
        <span className="truncate text-sm">{playlist.name}</span>
      </div>
    )
  }
  if (!shelf) return <span />
  const primary = shelf.createdAt === Math.min(...useLibrary.getState().shelves.map((item) => item.createdAt))
  const Icon = primary ? Library : shelf.kind === "podcast" ? Podcast : Music
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-white/10 bg-black/40 px-2 py-1 backdrop-blur">
      <Icon className="size-5 shrink-0" />
      <span className="truncate text-sm">{shelf.name}</span>
    </div>
  )
}

function LayoutButton({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`h-10 cursor-pointer rounded-md border bg-[#101010] px-3 text-sm text-white ${on ? "border-white/70" : "border-[#3a3a3a]"}`}
      onClick={onClick}
      aria-pressed={on}
    >
      {label}
    </button>
  )
}

function ArtworkPanel({ live }: { live: boolean }) {
  const coverPath = usePlayer((state) => state.coverPath)
  const title = usePlayer((state) => state.title)
  const artist = usePlayer((state) => state.artist)
  const bands = usePlayer((state) => (live ? state.bands : quietBands))
  const shown = bands.length ? bands : quietBands
  return (
    <div className="flex shrink-0 flex-col items-center">
      <div className="relative size-[min(22rem,78vw)] shrink-0 sm:size-112 lg:size-128">
        <StageCanvas bands={shown} />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Cover path={coverPath} className="size-[42%] rounded-full shadow-2xl ring-2 ring-white" />
        </div>
      </div>
      <div className="mt-4 w-full max-w-md px-2 text-center">
        <h2 className="serif text-2xl leading-tight text-balance text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)] sm:text-4xl">{title || "The stage is quiet"}</h2>
        <p className="mt-2 text-base font-medium text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] sm:text-lg">{artistLabel(artist)}</p>
      </div>
      <StageTransport />
    </div>
  )
}

function StageTransport() {
  const trackId = usePlayer((state) => state.trackId)
  const playing = usePlayer((state) => state.playing)
  const position = usePlayer((state) => state.position)
  const duration = usePlayer((state) => state.duration)
  const toggle = usePlayer((state) => state.toggle)
  const previous = usePlayer((state) => state.previous)
  const next = usePlayer((state) => state.next)
  const seek = usePlayer((state) => state.seek)
  const [scrub, setScrub] = useState<number | null>(null)
  const shown = scrub ?? (duration ? position / duration : 0)
  const disabled = !trackId

  return (
    <div className="mt-4 mb-8 w-full max-w-md rounded-2xl border border-white/10 bg-[#0c0c0c] p-3">
      <div className="flex items-center justify-center gap-2">
        <Button variant="ghost" size="icon" className="bg-[#161616] text-white hover:bg-[#222]" onClick={() => void previous()} disabled={disabled} aria-label="Previous">
          <SkipBack className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" className="bg-[#161616] text-white hover:bg-[#222]" onClick={() => void seek(Math.max(0, position - 5))} disabled={disabled} aria-label="Back 5 seconds">
          <RotateCcw className="size-5" />
        </Button>
        <Button size="icon" className="size-12 bg-[#161616] text-white hover:bg-[#222]" onClick={() => void toggle()} disabled={disabled} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="size-6" /> : <Play className="size-6" />}
        </Button>
        <Button variant="ghost" size="icon" className="bg-[#161616] text-white hover:bg-[#222]" onClick={() => void seek(position + 5)} disabled={disabled} aria-label="Forward 5 seconds">
          <RotateCw className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" className="bg-[#161616] text-white hover:bg-[#222]" onClick={() => void next()} disabled={disabled} aria-label="Next">
          <SkipForward className="size-5" />
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm text-white">
        <span className="w-12 tabular-nums drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)]">{formatClock(scrub == null ? position : scrub * duration)}</span>
        <Slider
          max={1000}
          value={[Math.round(shown * 1000)]}
          disabled={disabled || !duration}
          aria-label="Position"
          onValueChange={([value]) => setScrub((value ?? 0) / 1000)}
          onValueCommit={([value]) => {
            setScrub(null)
            void seek(((value ?? 0) / 1000) * duration)
          }}
        />
        <span className="w-12 text-right tabular-nums drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)]">{formatClock(duration)}</span>
      </div>
    </div>
  )
}

function LyricsPanel() {
  const title = usePlayer((state) => state.title)
  const artist = usePlayer((state) => state.artist)
  const trackId = usePlayer((state) => state.trackId)
  return (
    <div className="glass-strong flex min-h-72 w-full flex-1 flex-col overflow-hidden rounded-3xl p-4 sm:p-6 md:p-8 lg:h-full lg:max-h-full lg:min-h-0">
      <p className="text-xs tracking-[0.28em] text-gold uppercase">Orfeus</p>
      <h2 className="serif mt-4 hidden text-3xl leading-tight sm:text-5xl lg:block">{title || "The stage is quiet"}</h2>
      <p className="mt-3 hidden text-base text-muted-foreground sm:text-lg lg:block">{trackId ? artistLabel(artist) : "Pick a track to open the stage."}</p>
      {trackId ? <LyricStage trackId={trackId} /> : null}
    </div>
  )
}

function LyricStage({ trackId }: { trackId: string }) {
  const track = useLibrary((state) => state.tracks.find((item) => item.id === trackId))
  const position = usePlayer((state) => state.position)
  const updateTrack = useLibrary((state) => state.updateTrack)
  const searchMetadata = useLibrary((state) => state.searchMetadata)
  const [synced, setSynced] = useState(false)
  const [offset, setOffset] = useState(0)
  const [draft, setDraft] = useState("")
  const [note, setNote] = useState<string | null>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDraft(track?.syncedLyrics ?? "")
    setSynced(Boolean(track?.syncedLyrics.trim()))
    const stored = Number(localStorage.getItem(offsetKey(trackId)))
    setOffset(Number.isFinite(stored) ? stored : 0)
    setNote(null)
  }, [track?.syncedLyrics, trackId])

  const lines = parseLyrics(draft, track?.lyrics ?? "")
  const current = synced ? activeLine(lines, position, offset) : -1

  useEffect(() => {
    const scroller = scrollerRef.current
    const line = activeRef.current
    if (!scroller || !line) return
    const delta = line.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTop += delta - scroller.clientHeight / 2 + line.clientHeight / 2
  }, [current])

  async function saveLyrics(nextSynced: string, nextPlain?: string) {
    if (!track) return
    setDraft(nextSynced)
    await updateTrack({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      lyrics: nextPlain ?? (plainFromLrc(nextSynced) || track.lyrics),
      syncedLyrics: nextSynced,
      gain: track.gain,
    })
  }

  async function mark(index: number) {
    if (!track) return
    const next = stampLine(lines, index, Math.max(0, position + offset))
    try {
      await saveLyrics(next)
      setNote("Timestamp saved on this line.")
    } catch (error) {
      setNote(message(error))
    }
  }

  async function bakeOffset() {
    if (!draft.trim()) return
    const next = shiftLrc(draft, offset)
    localStorage.setItem(offsetKey(trackId), "0")
    setOffset(0)
    try {
      await saveLyrics(next)
      setNote("The offset is now part of the timed lyrics.")
    } catch (error) {
      setNote(message(error))
    }
  }

  async function fetchSynced() {
    if (!track) return
    setNote("Searching for timed lyrics…")
    try {
      const report = await searchMetadata(track.title, track.artist)
      const hit = report.hits.find((item) => item.syncedLyrics) ?? report.hits[0]
      if (!hit) {
        const failed = report.lookups.filter((item) => item.outcome === "error")
        const missing = report.lookups.find((item) => item.field === "lyrics")
        setNote(failed.length ? failed.map((item) => item.detail).join(" ") : (missing?.detail ?? "No lyrics are published for this track. You can stamp the lines by hand."))
        return
      }
      const nextSynced = hit.syncedLyrics ?? ""
      await saveLyrics(nextSynced, hit.lyrics ?? track.lyrics)
      setSynced(Boolean(nextSynced))
      setNote(nextSynced ? "Timed lyrics found." : "Lyrics found, still without timestamps. Tap a line while it plays.")
    } catch (error) {
      setNote(message(error))
    }
  }

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className={`bg-[#101010] text-white hover:bg-[#1c1c1c] ${synced ? "border-[#3a3a3a]" : "border-white/70"}`} onClick={() => setSynced(false)}>Reading</Button>
        <Button variant="outline" size="sm" className={`bg-[#101010] text-white hover:bg-[#1c1c1c] ${synced ? "border-white/70" : "border-[#3a3a3a]"}`} onClick={() => setSynced(true)}>Synced</Button>
        <Button size="sm" className="bg-[#1c1c1c] text-white hover:bg-[#2a2a2a]" onClick={() => void fetchSynced()}>Find synced lyrics</Button>
      </div>
      {synced ? (
        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            Offset {offset > 0 ? "+" : ""}{offset.toFixed(1)}s
            <Slider min={-8} max={8} step={0.1} value={[offset]} onValueChange={([value]) => {
              const next = value ?? 0
              setOffset(next)
              localStorage.setItem(offsetKey(trackId), String(next))
            }} aria-label="Lyric sync offset" />
          </label>
          <p className="text-sm text-muted-foreground">Click the line being sung to stamp the current time. The active line stays highlighted.</p>
          {draft.includes("[") ? (
            <Button size="sm" className="bg-[#1c1c1c] text-white hover:bg-[#2a2a2a]" onClick={() => void bakeOffset()}>Bake offset into timestamps</Button>
          ) : null}
        </div>
      ) : null}
      {note ? <p className="mt-3 text-sm text-gold">{note}</p> : null}
      <div ref={scrollerRef} className="mt-4 min-h-0 flex-1 space-y-3 overflow-auto pr-2">
        {lines.length === 0 ? <p className="text-2xl text-white/70">No lyrics for this track.</p> : null}
        {lines.map((line, index) => {
          const active = index === current
          return (
            <button
              key={`${line.text}-${index}`}
              ref={active ? activeRef : undefined}
              type="button"
              className={`block w-full cursor-pointer rounded-xl px-3 py-2 text-left transition ${active ? "bg-[#161616] text-4xl leading-tight font-semibold text-white md:text-5xl" : "text-2xl leading-snug text-white/55 hover:bg-[#101010] hover:text-white/80"}`}
              onClick={() => {
                if (synced) void mark(index)
              }}
            >
              {line.text}
            </button>
          )
        })}
      </div>
    </div>
  )
}
