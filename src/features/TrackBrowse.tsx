import { LayoutGrid, List, Table2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Cover } from "@/components/Cover"
import { RowSpectrum } from "@/components/Visualizer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { artistLabel, formatDuration, sourceLabel } from "@/lib/format"
import type { Track } from "@/lib/types"

type Mode = "list" | "cards" | "table"
type Filter = "all" | "lyrics" | "cover" | "missing"
type Sort = "manual" | "title" | "artist" | "album" | "duration" | "added"

const storageKey = "orfeus-listing"

function readChrome(): { mode: Mode; size: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) ?? "") as { mode?: Mode; size?: number }
    return {
      mode: raw.mode === "cards" ? "cards" : raw.mode === "table" ? "table" : "list",
      size: typeof raw.size === "number" ? Math.min(100, Math.max(0, raw.size)) : 42,
    }
  } catch {
    return { mode: "list", size: 42 }
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
}: {
  tracks: Track[]
  currentId: string | null
  onOpen: (visible: Track[], index: number) => void
  actions?: (track: Track) => ReactNode
  reorder?: (track: Track) => ReactNode
  empty?: ReactNode
  manualSort?: boolean
}) {
  const chrome = readChrome()
  const [mode, setMode] = useState<Mode>(chrome.mode)
  const [size, setSize] = useState(chrome.size)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [sort, setSort] = useState<Sort>(manualSort ? "manual" : "title")

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ mode, size }))
  }, [mode, size])

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search tracks" className="h-10 w-44" />
        <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} aria-label="Filter" className="h-10 cursor-pointer rounded-md border border-input bg-background/40 px-2 text-base">
          <option value="all">All</option>
          <option value="lyrics">With lyrics</option>
          <option value="cover">Missing cover</option>
          <option value="missing">Missing file</option>
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sort" className="h-10 cursor-pointer rounded-md border border-input bg-background/40 px-2 text-base">
          {manualSort ? <option value="manual">Playlist order</option> : null}
          <option value="title">Title</option>
          <option value="artist">Artist</option>
          <option value="album">Album</option>
          <option value="duration">Duration</option>
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
        <Button variant={mode === "table" ? "secondary" : "outline"} size="icon" aria-label="Table" onClick={() => setMode("table")}>
          <Table2 className="size-5" />
        </Button>
      </div>
      {visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">{empty ?? <p className="text-base text-muted-foreground">No tracks match this filter.</p>}</div>
      ) : mode === "table" ? (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <table className="w-full border-separate border-spacing-y-1 text-left">
            <thead className="sticky top-0 z-10 bg-black/70 text-xs tracking-[0.16em] text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Cover</th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Artist</th>
                <th className="px-3 py-2 font-medium">Album</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {visible.map((track, index) => (
                <tr
                  key={track.id}
                  ref={currentId === track.id ? (node) => { currentRef.current = node } : undefined}
                  className={`cursor-pointer ${currentId === track.id ? "glass" : "hover:bg-white/10"}`}
                  onClick={() => onOpen(visible, index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onOpen(visible, index)
                  }}
                  tabIndex={0}
                >
                  <td className="rounded-l-xl px-3 py-2">
                    <Cover path={track.coverPath} className={`size-12 rounded ${currentId === track.id ? "ring-2 ring-white" : ""}`} />
                  </td>
                  <td className="max-w-64 px-3 py-2">
                    <span className="block truncate text-base">{track.title}</span>
                    {currentId === track.id ? <span className="text-xs tracking-[0.18em] text-white uppercase">Playing</span> : null}
                  </td>
                  <td className="max-w-48 truncate px-3 py-2 text-sm text-muted-foreground">{artistLabel(track.artist)}</td>
                  <td className="max-w-48 truncate px-3 py-2 text-sm text-muted-foreground">{track.album || "—"}</td>
                  <td className="max-w-56 truncate px-3 py-2 text-sm text-muted-foreground" title={track.path}>{sourceLabel(track)}</td>
                  <td className="px-3 py-2 text-sm text-muted-foreground tabular-nums">{formatDuration(track.durationMs)}</td>
                  <td className="rounded-r-xl px-3 py-2" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    <span className="flex items-center justify-end gap-1">
                      {actions?.(track)}
                      {sort === "manual" ? reorder?.(track) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : mode === "list" ? (
        <ul className="min-h-0 flex-1 space-y-1 overflow-auto px-4 pb-4">
          {visible.map((track, index) => (
            <li key={track.id}>
              <div
                ref={currentId === track.id ? (node) => { currentRef.current = node } : undefined}
                className={`grid cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-white/10 ${currentId === track.id ? "glass ring-1 ring-white/50" : ""}`}
                style={{ gridTemplateColumns: "auto minmax(0,1fr) auto auto auto" }}
                onClick={() => onOpen(visible, index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(visible, index)
                }}
                role="button"
                tabIndex={0}
              >
                <Cover path={track.coverPath} className={`rounded ${currentId === track.id ? "ring-2 ring-white" : ""}`} style={{ width: cover, height: cover }} />
                <span className="min-w-0">
                  <span className={`block truncate ${size > 60 ? "text-lg" : "text-base"}`}>{track.title}</span>
                  {currentId === track.id ? <span className="text-xs tracking-[0.18em] text-white uppercase">Playing</span> : null}
                  {track.gain < 0.98 ? <span className="ml-2 text-xs text-muted-foreground">{Math.round(track.gain * 100)}%</span> : null}
                  <span className="block truncate text-sm text-muted-foreground">
                    {artistLabel(track.artist)}
                    {track.album ? ` · ${track.album}` : ""}
                    {track.missing ? " · missing file" : ""}
                  </span>
                  <span className="block truncate text-xs text-white/45" title={track.path}>{sourceLabel(track)}</span>
                </span>
                <RowSpectrum active={currentId === track.id} className="h-8 w-24" />
                <span className="text-sm text-muted-foreground tabular-nums">{formatDuration(track.durationMs)}</span>
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
        <ul className="min-h-0 flex-1 overflow-auto px-4 pb-4" style={{ display: "grid", gap: 12, gridTemplateColumns: `repeat(auto-fill, minmax(${card}px, 1fr))`, alignContent: "start" }}>
          {visible.map((track, index) => (
            <li key={track.id}>
              <div
                className={`cursor-pointer rounded-2xl p-2 hover:bg-white/10 ${currentId === track.id ? "glass ring-1 ring-white/50" : ""}`}
                onClick={() => onOpen(visible, index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(visible, index)
                }}
                role="button"
                tabIndex={0}
              >
                <div className="relative">
                  <Cover path={track.coverPath} className={`aspect-square w-full rounded-xl ${currentId === track.id ? "ring-2 ring-white" : ""}`} />
                  {actions || (reorder && sort === "manual") ? (
                    <span className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-background/80 p-1" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                      {actions?.(track)}
                      {sort === "manual" ? reorder?.(track) : null}
                    </span>
                  ) : null}
                </div>
                {currentId === track.id ? <span className="mt-2 block text-xs tracking-[0.18em] text-white uppercase">Playing</span> : null}
                <span className={`block truncate ${size > 60 ? "text-lg" : "text-base"} ${currentId === track.id ? "" : "mt-2"}`}>{track.title}</span>
                <span className="block truncate text-sm text-muted-foreground">{artistLabel(track.artist)}</span>
                <span className="block truncate text-xs text-white/45" title={track.path}>{sourceLabel(track)}</span>
                <RowSpectrum active={currentId === track.id} className="mt-2 h-8 w-full" />
                <span className="text-sm text-muted-foreground tabular-nums">{formatDuration(track.durationMs)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
