import { LayoutGrid, List } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type WheelEvent } from "react"
import { Cover } from "@/components/Cover"
import { RowSpectrum } from "@/components/Visualizer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { artistLabel, formatBytes, formatDuration, isRecent, sourceLabel } from "@/lib/format"
import type { Track } from "@/lib/types"

type Mode = "list" | "cards"
type Filter = "all" | "lyrics" | "cover" | "missing"
type Sort = "manual" | "title" | "artist" | "album" | "duration" | "added" | "size"

const legacyKey = "orfeus-listing"
const selectClass = "h-11 cursor-pointer rounded-md border border-white/10 bg-black px-3 text-base text-foreground [color-scheme:dark] [&>option]:bg-black [&>option]:text-foreground"
const newTag = "mr-2 text-xs font-semibold tracking-[0.14em] text-amber-200 uppercase drop-shadow-[0_0_8px_rgba(252,211,77,0.95)]"

function readChrome(listingKey: string): { mode: Mode; size: number; filter: Filter; sort: Sort } {
  try {
    const stored = localStorage.getItem(`orfeus-listing-${listingKey}`) ?? (listingKey === "library" ? localStorage.getItem(legacyKey) : null)
    const raw = JSON.parse(stored ?? "") as { mode?: string; size?: number; filter?: Filter; sort?: Sort }
    const filter = raw.filter === "lyrics" || raw.filter === "cover" || raw.filter === "missing" ? raw.filter : "all"
    const sort = raw.sort === "manual" || raw.sort === "artist" || raw.sort === "album" || raw.sort === "duration" || raw.sort === "added" || raw.sort === "size" ? raw.sort : "title"
    return {
      mode: raw.mode === "cards" ? "cards" : "list",
      size: typeof raw.size === "number" ? Math.min(100, Math.max(0, raw.size)) : 42,
      filter,
      sort,
    }
  } catch {
    return { mode: "list", size: 42, filter: "all", sort: "title" }
  }
}

export function TrackBrowse({
  tracks,
  currentId,
  onOpen,
  actions,
  reorder,
  empty,
  manualSort = false,
  listingKey = "library",
  selectedIds,
  onSelectVisible,
  contextActions,
}: {
  tracks: Track[]
  currentId: string | null
  onOpen: (visible: Track[], index: number) => void
  actions?: (track: Track) => ReactNode
  reorder?: (track: Track) => ReactNode
  empty?: ReactNode
  manualSort?: boolean
  listingKey?: string
  selectedIds?: string[]
  onSelectVisible?: (ids: string[], selected: boolean) => void
  contextActions?: (track: Track) => Array<{ label: string; icon?: ReactNode; onSelect: () => void }>
}) {
  const chrome = readChrome(listingKey)
  const [mode, setMode] = useState<Mode>(chrome.mode)
  const [size, setSize] = useState(chrome.size)
  const [query, setQuery] = useState("")
  const [menu, setMenu] = useState<{ track: Track; x: number; y: number } | null>(null)
  const [filter, setFilter] = useState<Filter>(chrome.filter)
  const [sort, setSort] = useState<Sort>(chrome.sort === "manual" && !manualSort ? "title" : manualSort && chrome.sort === "title" && !localStorage.getItem(`orfeus-listing-${listingKey}`) ? "manual" : chrome.sort)

  useEffect(() => {
    localStorage.setItem(`orfeus-listing-${listingKey}`, JSON.stringify({ mode, size, filter, sort }))
  }, [filter, listingKey, mode, size, sort])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = tracks.filter((track) => {
      if (needle && !`${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(needle)) return false
      if (filter === "lyrics") return track.lyrics.trim().length > 0
      if (filter === "cover") return !track.coverPath
      if (filter === "missing") return track.missing
      return true
    })
    if (sort === "manual") return filtered
    return [...filtered].sort((left, right) => {
      if (sort === "duration") return left.durationMs - right.durationMs
      if (sort === "size") return (left.sizeBytes ?? 0) - (right.sizeBytes ?? 0)
      if (sort === "added") return right.addedAt - left.addedAt
      const a = sort === "artist" ? left.artist : sort === "album" ? left.album : left.title
      const b = sort === "artist" ? right.artist : sort === "album" ? right.album : right.title
      return a.localeCompare(b, "pt")
    })
  }, [filter, query, sort, tracks])

  const cover = Math.round(52 + size * 0.48)
  const card = Math.round(148 + size * 1.2)
  const currentRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" })
  }, [currentId])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener("click", close)
    window.addEventListener("keydown", close)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("keydown", close)
    }
  }, [menu])

  function openMenu(track: Track, event: MouseEvent) {
    if (!contextActions) return
    event.preventDefault()
    const x = Math.min(event.clientX, window.innerWidth - 200)
    const y = Math.min(event.clientY, window.innerHeight - 220)
    setMenu({ track, x, y })
  }

  function resizeFromWheel(event: WheelEvent) {
    if (!event.altKey) return
    event.preventDefault()
    setSize((current) => Math.min(100, Math.max(0, current + (event.deltaY > 0 ? -6 : 6))))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" onWheel={resizeFromWheel}>
      <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search tracks" maxLength={80} className="w-44" />
        <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} aria-label="Filter" className={selectClass}>
          <option value="all">All</option>
          <option value="lyrics">With lyrics</option>
          <option value="cover">Missing cover</option>
          <option value="missing">Missing file</option>
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sort" className={selectClass}>
          {manualSort ? <option value="manual">Playlist order</option> : null}
          <option value="title">Title</option>
          <option value="artist">Artist</option>
          <option value="album">Album</option>
          <option value="duration">Duration</option>
          <option value="size">File size</option>
          <option value="added">Recently added</option>
        </select>
        <label className="flex min-w-36 flex-1 items-center gap-2 text-sm text-muted-foreground">
          Size
          <Slider max={100} value={[size]} onValueChange={([value]) => setSize(value ?? 0)} aria-label="Listing size" />
        </label>
        <Button variant={mode === "list" ? "secondary" : "outline"} size="icon" aria-label="List" onClick={() => setMode("list")}>
          <List className="size-5" />
        </Button>
        <Button variant={mode === "cards" ? "secondary" : "outline"} size="icon" aria-label="Cards" onClick={() => setMode("cards")}>
          <LayoutGrid className="size-5" />
        </Button>
        {onSelectVisible ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5 cursor-pointer"
              checked={visible.length > 0 && visible.every((track) => selectedIds?.includes(track.id))}
              onChange={(event) => onSelectVisible(visible.map((track) => track.id), event.target.checked)}
              aria-label="Select all tracks"
            />
            All
          </label>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">{empty ?? <p className="text-base text-muted-foreground">No tracks match this filter.</p>}</div>
      ) : mode === "list" ? (
        <ul className="min-h-0 flex-1 space-y-1 overflow-auto px-4 pt-4 pb-4">
          {visible.map((track, index) => (
            <li key={track.id}>
              <div
                ref={currentId === track.id ? (node) => { currentRef.current = node } : undefined}
                className={`grid cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-white/10 ${currentId === track.id ? "glass ring-1 ring-white/50" : ""} ${isRecent(track.addedAt) && currentId !== track.id ? "ring-1 ring-gold/35" : ""}`}
                style={{ gridTemplateColumns: "auto minmax(0,1fr) auto auto auto" }}
                onClick={() => onOpen(visible, index)}
                onContextMenu={(event) => openMenu(track, event)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(visible, index)
                }}
                role="button"
                tabIndex={0}
              >
                <Cover path={track.coverPath} className={`rounded ${currentId === track.id ? "ring-2 ring-white" : ""}`} style={{ width: cover, height: cover }} />
                <span className="min-w-0">
                  <span className={`block truncate ${size > 60 ? "text-lg" : "text-base"}`}>{isRecent(track.addedAt) ? <span className={newTag}>New</span> : null}{track.title}</span>
                  {currentId === track.id ? <span className="text-xs tracking-[0.18em] text-white uppercase">Playing</span> : null}
                  {Math.abs(track.gain - 1) > 0.02 ? <span className="ml-2 text-xs text-muted-foreground">{Math.round(track.gain * 100)}%</span> : null}
                  <span className="block truncate text-sm text-muted-foreground">
                    {artistLabel(track.artist)}
                    {track.album ? ` · ${track.album}` : ""}
                    {track.missing ? " · missing file" : ""}
                  </span>
                  <span className="block truncate text-xs text-white/45" title={track.path}>{sourceLabel(track)}</span>
                </span>
                <RowSpectrum active={currentId === track.id} className="h-8 w-24" />
                <span className="text-right text-sm text-muted-foreground tabular-nums">
                  {formatDuration(track.durationMs)}
                  <span className="block">{formatBytes(track.sizeBytes)}</span>
                </span>
                {actions || (reorder && sort === "manual") ? (
                  <span className="flex items-center gap-1" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    {actions?.(track)}
                    {sort === "manual" ? reorder?.(track) : null}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto px-4 pt-4 pb-4" style={{ display: "grid", gap: 12, gridTemplateColumns: `repeat(auto-fill, minmax(${card}px, 1fr))`, alignContent: "start" }}>
          {visible.map((track, index) => (
            <li key={track.id}>
              <div
                className={`cursor-pointer rounded-2xl p-2 hover:bg-white/10 ${currentId === track.id ? "glass ring-1 ring-white/50" : ""} ${isRecent(track.addedAt) && currentId !== track.id ? "ring-1 ring-gold/35" : ""}`}
                onClick={() => onOpen(visible, index)}
                onContextMenu={(event) => openMenu(track, event)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(visible, index)
                }}
                role="button"
                tabIndex={0}
              >
                <div className="relative">
                  <Cover path={track.coverPath} className={`aspect-square w-full rounded-xl ${currentId === track.id ? "ring-2 ring-white" : ""}`} />
                  {actions || (reorder && sort === "manual") ? (
                    <span className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-background/80 py-1 pr-1 pl-3" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                      {actions?.(track)}
                      {sort === "manual" ? reorder?.(track) : null}
                    </span>
                  ) : null}
                </div>
                {currentId === track.id ? <span className="mt-2 block text-xs tracking-[0.18em] text-white uppercase">Playing</span> : null}
                <span className={`block truncate ${size > 60 ? "text-lg" : "text-base"} ${currentId === track.id ? "" : "mt-2"}`}>{isRecent(track.addedAt) ? <span className={newTag}>New</span> : null}{track.title}</span>
                <span className="block truncate text-sm text-muted-foreground">{artistLabel(track.artist)}</span>
                <span className="block truncate text-xs text-white/45" title={track.path}>{sourceLabel(track)}</span>
                <RowSpectrum active={currentId === track.id} className="mt-2 h-8 w-full" />
                <span className="text-sm text-muted-foreground tabular-nums">{formatDuration(track.durationMs)} · {formatBytes(track.sizeBytes)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {menu && contextActions ? (
        <div className="glass-strong fixed z-50 min-w-48 rounded-md p-1" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
          {contextActions(menu.track).map((action) => (
            <button key={action.label} type="button" className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-left text-base hover:bg-accent" onClick={() => { action.onSelect(); setMenu(null) }}>
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
