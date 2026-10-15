import { X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Cover } from "@/components/Cover"
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
      <div className="flex h-full flex-col bg-black/25">
        <div className="flex flex-wrap items-center justify-end gap-2 p-3 sm:p-4">
          <LayoutButton on={layout.lyrics} label="Lyrics" onClick={toggleLyrics} />
          <button type="button" className="flex size-11 cursor-pointer items-center justify-center rounded-md border border-[#3a3a3a] bg-[#1c1c1c] text-white" onClick={() => close(false)} aria-label="Close stage">
            <X className="size-6" />
          </button>
        </div>
        <div className={`grid min-h-0 flex-1 gap-4 overflow-auto px-4 pb-24 sm:gap-6 sm:px-6 sm:pb-28 ${layout.lyrics ? "lg:grid-cols-2" : "grid-cols-1"}`}>
          <ArtworkPanel live={open} />
          {layout.lyrics ? <LyricsPanel solo={false} /> : null}
        </div>
      </div>
    </div>
  )
}

function LayoutButton({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`h-10 cursor-pointer rounded-md border px-3 text-sm ${on ? "border-white bg-white text-black" : "border-[#3a3a3a] bg-[#1c1c1c] text-white"}`}
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
  const energy = shown.reduce((sum, band) => sum + band, 0) / shown.length
  return (
    <div className="flex min-h-0 flex-col items-center justify-center py-2">
      <div className="relative size-[min(78vw,48vh,34rem)] sm:size-[min(68vh,36rem)]">
        <StageCanvas bands={shown} />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="size-[46%]" style={{ transform: `scale(${(1 + energy * 0.08).toFixed(3)})` }}>
            <Cover path={coverPath} className="size-full rounded-full shadow-2xl ring-2 ring-white" />
          </div>
        </div>
      </div>
      <div className="mt-8 w-full max-w-3xl px-2 text-center sm:mt-10">
        <h2 className="serif text-3xl leading-tight tracking-tight sm:text-5xl sm:leading-[1.08]">{title || "The stage is quiet"}</h2>
        <p className="mt-3 text-base text-white/75 sm:mt-4 sm:text-xl">{artistLabel(artist)}</p>
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
      <h2 className="serif mt-4 text-3xl leading-tight sm:text-5xl">{title || "The stage is quiet"}</h2>
      <p className="mt-3 text-base text-muted-foreground sm:text-lg">{trackId ? artistLabel(artist) : "Pick a track to open the stage."}</p>
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
        <Button variant={synced ? "secondary" : "outline"} size="sm" className="bg-[#1c1c1c] text-white hover:bg-[#2a2a2a]" onClick={() => setSynced(false)}>Reading</Button>
        <Button variant={synced ? "default" : "outline"} size="sm" className={synced ? undefined : "bg-[#1c1c1c] text-white hover:bg-[#2a2a2a]"} onClick={() => setSynced(true)}>Synced</Button>
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
