import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Cover } from "@/components/Cover"
import { CubeLoader } from "@/components/kit/CubeLoader"
import { Button } from "@/components/ui/button"
import * as api from "@/lib/api"
import { artistLabel, formatListened } from "@/lib/format"
import type { Listen } from "@/lib/types"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"

type Scope = "day" | "month" | "year"

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function StatusView() {
  const [scope, setScope] = useState<Scope>("day")
  const [anchor, setAnchor] = useState(() => new Date())
  const [rows, setRows] = useState<Listen[]>([])
  const [ready, setReady] = useState(false)
  const [reload, setReload] = useState(0)
  const range = useMemo(() => bounds(scope, anchor), [scope, anchor])

  useEffect(() => {
    let alive = true
    setReady(false)
    void api.listListens(range.from, range.to).then(
      (next) => {
        if (!alive) return
        setRows(next)
        setReady(true)
      },
      (error: unknown) => {
        if (!alive) return
        useLibrary.setState({ error: message(error) })
        setReady(true)
      },
    )
    return () => {
      alive = false
    }
  }, [range.from, range.to, reload])

  const buckets = useMemo(() => chartBuckets(scope, anchor, rows), [anchor, rows, scope])
  const top = useMemo(() => rank(rows).slice(0, 5), [rows])
  const total = rows.reduce((sum, row) => sum + row.seconds, 0)
  const nextLocked = range.to > Date.now() / 1000

  function shift(dir: number) {
    const next = new Date(anchor)
    if (scope === "day") next.setDate(next.getDate() + dir)
    if (scope === "month") next.setMonth(next.getMonth() + dir)
    if (scope === "year") next.setFullYear(next.getFullYear() + dir)
    setAnchor(next)
  }

  async function clearHistory(all: boolean) {
    const question = all ? "Clear every listening record?" : `Clear the history for ${periodLabel(scope, anchor)}?`
    if (!window.confirm(question)) return
    try {
      if (all) await api.clearAllListens()
      else await api.clearListens(range.from, range.to)
      setReload((value) => value + 1)
    } catch (error) {
      useLibrary.setState({ error: message(error) })
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-auto">
      <header className="px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="serif text-2xl sm:text-3xl">Status</h2>
        <p className="text-base text-muted-foreground">{ready ? `${formatListened(total)} listened` : "Opening the listening history…"}</p>
      </header>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-6">
        {(["day", "month", "year"] as const).map((item) => (
          <Button key={item} variant={scope === item ? "secondary" : "outline"} size="sm" onClick={() => setScope(item)}>
            {item === "day" ? "Day" : item === "month" ? "Month" : "Year"}
          </Button>
        ))}
        <Button variant="outline" size="sm" disabled={!ready || !rows.length} onClick={() => void clearHistory(false)}>Clear this period</Button>
        <Button variant="outline" size="sm" disabled={!ready} onClick={() => void clearHistory(true)}>Clear all history</Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Previous period" onClick={() => shift(-1)}>
            <ChevronLeft className="size-5" />
          </Button>
          <p className="min-w-36 text-center text-sm">{periodLabel(scope, anchor)}</p>
          <Button variant="ghost" size="icon" aria-label="Next period" disabled={nextLocked} onClick={() => shift(1)}>
            <ChevronRight className="size-5" />
          </Button>
        </div>
      </div>
      {!ready ? (
        <div className="flex flex-1 items-center justify-center">
          <CubeLoader label="Loading status" />
        </div>
      ) : (
        <div className="space-y-8 px-4 pb-8 sm:px-6">
          <section>
            <h3 className="mb-3 text-xs tracking-[0.16em] text-gold uppercase">Minutes</h3>
            <MinutesChart buckets={buckets} scope={scope} />
          </section>
          <section>
            <h3 className="mb-3 text-xs tracking-[0.16em] text-gold uppercase">Top 5</h3>
            {top.length === 0 ? <p className="text-sm text-muted-foreground">Nothing played in this period.</p> : null}
            <ol className="space-y-2">
              {top.map((item, index) => (
                <li key={item.trackId} className="flex items-center gap-3 rounded-xl border border-border bg-card/70 px-3 py-2">
                  <span className="serif w-6 text-center text-2xl">{index + 1}</span>
                  <Cover path={item.coverPath} className="size-12 rounded-md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{item.title}</p>
                    <p className="truncate text-sm text-muted-foreground">{artistLabel(item.artist)}</p>
                  </div>
                  <span className="text-sm text-muted-foreground tabular-nums">{formatListened(item.seconds)}</span>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h3 className="mb-3 text-xs tracking-[0.16em] text-gold uppercase">History</h3>
            {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing played in this period.</p> : null}
            <ul className="space-y-1">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-1 py-2">
                  <Cover path={row.coverPath} className="size-10 rounded-md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{row.title}</p>
                    <p className="truncate text-sm text-muted-foreground">{artistLabel(row.artist)}</p>
                  </div>
                  <div className="text-right text-sm text-muted-foreground tabular-nums">
                    <p>{formatListened(row.seconds)}</p>
                    <p>{when(scope, row.playedAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </section>
  )
}

function when(scope: Scope, playedAt: number) {
  const date = new Date(playedAt * 1000)
  const time = date.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })
  if (scope === "day") return time
  return `${date.toLocaleDateString("en", { month: "short", day: "numeric" })} · ${time}`
}

function bounds(scope: Scope, anchor: Date) {
  const start = new Date(anchor)
  start.setHours(0, 0, 0, 0)
  if (scope === "month" || scope === "year") start.setDate(1)
  if (scope === "year") start.setMonth(0)
  const end = new Date(start)
  if (scope === "day") end.setDate(end.getDate() + 1)
  if (scope === "month") end.setMonth(end.getMonth() + 1)
  if (scope === "year") end.setFullYear(end.getFullYear() + 1)
  return { from: Math.floor(start.getTime() / 1000), to: Math.floor(end.getTime() / 1000) }
}

function periodLabel(scope: Scope, anchor: Date) {
  if (scope === "day") return anchor.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })
  if (scope === "month") return anchor.toLocaleDateString("en", { month: "long", year: "numeric" })
  return String(anchor.getFullYear())
}

function chartBuckets(scope: Scope, anchor: Date, rows: Listen[]) {
  if (scope === "day") {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({ label: String(hour).padStart(2, "0"), seconds: 0 }))
    for (const row of rows) buckets[new Date(row.playedAt * 1000).getHours()]!.seconds += row.seconds
    return buckets
  }
  if (scope === "month") {
    const days = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()
    const buckets = Array.from({ length: days }, (_, index) => ({ label: String(index + 1), seconds: 0 }))
    for (const row of rows) {
      const day = new Date(row.playedAt * 1000).getDate()
      const bucket = buckets[day - 1]
      if (bucket) bucket.seconds += row.seconds
    }
    return buckets
  }
  const buckets = monthNames.map((label) => ({ label, seconds: 0 }))
  for (const row of rows) buckets[new Date(row.playedAt * 1000).getMonth()]!.seconds += row.seconds
  return buckets
}

function rank(rows: Listen[]) {
  const grouped = new Map<string, { trackId: string; title: string; artist: string; coverPath: string | null; seconds: number }>()
  for (const row of rows) {
    const current = grouped.get(row.trackId)
    if (current) {
      current.seconds += row.seconds
      if (row.coverPath) current.coverPath = row.coverPath
    } else {
      grouped.set(row.trackId, {
        trackId: row.trackId,
        title: row.title,
        artist: row.artist,
        coverPath: row.coverPath,
        seconds: row.seconds,
      })
    }
  }
  return [...grouped.values()].sort((left, right) => right.seconds - left.seconds || left.title.localeCompare(right.title, "pt"))
}

function MinutesChart({ buckets, scope }: { buckets: { label: string; seconds: number }[]; scope: Scope }) {
  const max = Math.max(...buckets.map((bucket) => bucket.seconds), 1)
  const legend = scope === "day" ? "Each bar is one hour, from 00 to 23." : scope === "month" ? "Each bar is one day of the month." : "Each bar is one month."
  return (
    <div className="rounded-xl border border-border bg-card/50 px-3 pt-3 pb-2">
      <p className="mb-2 text-xs text-muted-foreground">{legend} The number on a bar is the time listened.</p>
      <div className="flex h-52 items-end gap-1">
        {buckets.map((bucket, index) => (
          <div key={`${bucket.label}-${index}`} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1" title={`${bucket.label}: ${formatListened(bucket.seconds)}`}>
            <span className="truncate text-center text-[9px] leading-none text-foreground/80">{bucket.seconds > 0 ? formatListened(bucket.seconds) : ""}</span>
            <div className="flex min-h-0 flex-1 items-end">
              <div className="w-full rounded-sm bg-foreground/85" style={{ height: `${Math.max(bucket.seconds > 0 ? 4 : 0, (bucket.seconds / max) * 100)}%` }} />
            </div>
            <span className="h-4 truncate text-center text-[10px] text-muted-foreground">{bucket.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
