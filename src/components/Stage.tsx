import { X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Cover } from "@/components/Cover"
import { Craquelure } from "@/components/Craquelure"
import { quietBands, StageCanvas } from "@/components/Visualizer"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { artistLabel } from "@/lib/format"
import { activeLine, parseLyrics, plainFromLrc, shiftLrc, stampLine } from "@/lib/lyrics"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"
import { usePlayer } from "@/stores/player"

const offsetKey = (id: string) => `orfeus-lyric-offset:${id}`
const layoutKey = "orfeus-stage-layout"

type StageLayout = { cover: boolean; visualizer: boolean; lyrics: boolean }

function readLayout(): StageLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(layoutKey) ?? "") as Partial<StageLayout>
    const next = {
      cover: raw.cover !== false,
      visualizer: raw.visualizer !== false,
      lyrics: raw.lyrics !== false,
    }
    if (!next.cover && !next.visualizer && !next.lyrics) return { cover: true, visualizer: true, lyrics: true }
    return next
  } catch {
    return { cover: true, visualizer: true, lyrics: true }
  }
}

export function Stage() {
  const open = usePlayer((state) => state.stageOpen)
  const close = usePlayer((state) => state.setStageOpen)
  const [layout, setLayout] = useState<StageLayout>(readLayout)

  function toggle(key: keyof StageLayout) {
    setLayout((current) => {
      const next = { ...current, [key]: !current[key] }
      if (!next.cover && !next.visualizer && !next.lyrics) return current
      localStorage.setItem(layoutKey, JSON.stringify(next))
      return next
    })
  }

  const count = Number(layout.cover) + Number(layout.visualizer) + Number(layout.lyrics)

  return (
    <div className={open ? "visible fixed inset-0 z-40 opacity-100" : "pointer-events-none invisible fixed inset-0 z-40 opacity-0"} aria-hidden={!open}>
      <div className="flex h-full flex-col bg-black/25">
        <div className="flex flex-wrap items-center justify-end gap-2 p-4">
          <LayoutButton on={layout.cover} label="Cover" onClick={() => toggle("cover")} />
          <LayoutButton on={layout.visualizer} label="Visualizer" onClick={() => toggle("visualizer")} />
          <LayoutButton on={layout.lyrics} label="Lyrics" onClick={() => toggle("lyrics")} />
          <Button variant="ghost" size="icon" className="glass" onClick={() => close(false)} aria-label="Close stage">
            <X className="size-6" />
          </Button>
        </div>
        <div className={`grid min-h-0 flex-1 gap-6 px-6 pb-28 ${count >= 3 ? "md:grid-cols-3" : count === 2 ? "md:grid-cols-2" : "grid-cols-1"}`}>
          {layout.cover ? <CoverPanel solo={count === 1} /> : null}
          {layout.visualizer ? <VisualizerPanel solo={count === 1} live={open} /> : null}
          {layout.lyrics ? <LyricsPanel solo={count === 1} /> : null}
        </div>
      </div>
    </div>
  )
}

function LayoutButton({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <Button variant={on ? "default" : "outline"} size="sm" onClick={onClick} aria-pressed={on}>
      {label}
    </Button>
  )
}

function CoverPanel({ solo }: { solo: boolean }) {
  const coverPath = usePlayer((state) => state.coverPath)
  const title = usePlayer((state) => state.title)
  const artist = usePlayer((state) => state.artist)
  return (
    <div className="flex min-h-0 flex-col items-center justify-center">
      <Cover path={coverPath} className={`${solo ? "size-[min(68vh,34rem)]" : "size-[min(42vh,22rem)]"} rounded-3xl shadow-2xl ring-1 ring-white/40`} />
      {solo ? (
        <div className="mt-6 text-center">
          <h2 className="serif text-5xl">{title || "The stage is quiet"}</h2>
          <p className="mt-2 text-lg text-white/75">{artistLabel(artist)}</p>
        </div>
      ) : null}
    </div>
  )
}

function VisualizerPanel({ solo, live }: { solo: boolean; live: boolean }) {
  if (!live) return <VisualizerFrame solo={solo} bands={quietBands} />
  return <LiveVisualizer solo={solo} />
}

function LiveVisualizer({ solo }: { solo: boolean }) {
  const bands = usePlayer((state) => state.bands)
  return <VisualizerFrame solo={solo} bands={bands} />
}

function VisualizerFrame({ solo, bands }: { solo: boolean; bands: number[] }) {
  return (
    <div className={`relative min-h-64 overflow-hidden rounded-3xl ring-1 ring-white/25 ${solo ? "h-full" : "h-full min-h-88"}`}>
      <StageCanvas bands={bands} />
      <div className="pointer-events-none absolute inset-0 opacity-25">
        <Craquelure bands={bands} />
      </div>
    </div>
  )
}

function LyricsPanel({ solo }: { solo: boolean }) {
  const title = usePlayer((state) => state.title)
  const artist = usePlayer((state) => state.artist)
  const trackId = usePlayer((state) => state.trackId)
  return (
    <div className={`glass-strong flex min-h-0 flex-col overflow-hidden rounded-3xl p-6 md:p-8 ${solo ? "mx-auto h-full w-full max-w-3xl" : "h-full"}`}>
      <p className="text-xs tracking-[0.28em] text-gold uppercase">Orfeus</p>
      <h2 className="serif mt-2 text-4xl md:text-5xl">{title || "The stage is quiet"}</h2>
      <p className="mt-2 text-lg text-muted-foreground">{trackId ? artistLabel(artist) : "Pick a track to open the stage."}</p>
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
        <Button variant={synced ? "secondary" : "outline"} size="sm" onClick={() => setSynced(false)}>Reading</Button>
        <Button variant={synced ? "default" : "outline"} size="sm" onClick={() => setSynced(true)}>Synced</Button>
        <Button variant="ghost" size="sm" onClick={() => void fetchSynced()}>Find synced lyrics</Button>
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
            <Button variant="outline" size="sm" onClick={() => void bakeOffset()}>Bake offset into timestamps</Button>
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
              className={`block w-full cursor-pointer rounded-xl px-3 py-2 text-left transition ${active ? "bg-white/15 text-4xl leading-tight font-semibold text-white md:text-5xl" : "text-2xl leading-snug text-white/55 hover:text-white/80"}`}
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
