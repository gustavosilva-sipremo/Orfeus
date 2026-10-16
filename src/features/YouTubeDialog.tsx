import { listen } from "@tauri-apps/api/event"
import { open as chooseDirectory } from "@tauri-apps/plugin-dialog"
import { FolderOpen, Search, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { CubeLoader } from "@/components/kit/CubeLoader"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import * as api from "@/lib/api"
import { formatClock } from "@/lib/format"
import type { YoutubeEntry, YoutubeProbe, YoutubeProgress } from "@/lib/types"
import { cn, message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"

const audioKey = "orfeus-youtube-audio-dir"
const videoKey = "orfeus-youtube-video-dir"

type QueueRow = YoutubeEntry & { included: boolean; status: string }

export function YouTubeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [url, setUrl] = useState("")
  const [keep, setKeep] = useState(false)
  const [resolution, setResolution] = useState<number | null>(null)
  const [details, setDetails] = useState<YoutubeProbe | null>(null)
  const [probedUrl, setProbedUrl] = useState("")
  const [audioDir, setAudioDir] = useState(() => localStorage.getItem(audioKey) ?? "")
  const [videoDir, setVideoDir] = useState(() => localStorage.getItem(videoKey) ?? "")
  const [progress, setProgress] = useState<YoutubeProgress | null>(null)
  const progressRef = useRef<YoutubeProgress | null>(null)
  const [busy, setBusy] = useState<"lookup" | "download" | null>(null)
  const [error, setError] = useState("")
  const [rows, setRows] = useState<QueueRow[]>([])
  const includedRef = useRef<Set<number>>(new Set())
  const activeRef = useRef<number | null>(null)

  useEffect(() => {
    includedRef.current = new Set(rows.filter((row) => row.included).map((row) => row.index))
  }, [rows])

  useEffect(() => {
    if (!open || !api.desktop()) return
    if (audioDir && videoDir) return
    let cancelled = false
    void api.youtubeDefaults().then((defaults) => {
      if (cancelled) return
      if (!audioDir) remember(audioKey, defaults.audioDir, setAudioDir)
      if (!videoDir) remember(videoKey, defaults.videoDir, setVideoDir)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, audioDir, videoDir])

  useEffect(() => {
    if (!open || !api.desktop()) return
    let unlisten: (() => void) | undefined
    let disposed = false
    void listen<YoutubeProgress>("youtube://progress", (event) => {
      const next = event.payload
      const active = activeRef.current
      if (active != null) {
        const label = next.phase === "download" ? `Downloading ${Math.round(next.percent)}%` : next.label
        setRows((current) => current.map((row) => (row.index === active ? { ...row, status: label } : row)))
      }
      const previous = progressRef.current
      const phaseChanged = !previous || previous.phase !== next.phase || previous.label !== next.label
      const jumped = !previous || Math.abs(next.percent - previous.percent) >= 1
      if (!phaseChanged && !jumped) return
      progressRef.current = next
      setProgress(next)
    })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [open])

  async function chooseDir(title: string, current: string, key: string, setDir: (path: string) => void) {
    const ready = current && api.desktop() ? await api.ensureFolder(current).catch(() => "") : current
    const picked = await chooseDirectory({ directory: true, title, defaultPath: ready || undefined })
    if (typeof picked !== "string") return
    remember(key, picked, setDir)
  }

  async function lookUp() {
    setError("")
    setDetails(null)
    setResolution(null)
    setBusy("lookup")
    try {
      const next = await api.youtubeProbe(url)
      setDetails(next)
      setProbedUrl(url.trim())
      setResolution(next.kind === "playlist" ? 360 : next.resolutions[0]?.height ?? null)
      setRows(next.kind === "playlist" ? next.entries.map((entry) => ({ ...entry, included: true, status: "Queued" })) : [])
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(null)
    }
  }

  function markRow(index: number, status: string) {
    setRows((current) => current.map((row) => (row.index === index ? { ...row, status } : row)))
  }

  async function saveOne(target: string, title: string) {
    const saved = await api.youtubeDownload({
      url: target,
      audioDir,
      videoDir,
      keepVideo: keep,
      resolution: keep ? resolution : null,
    })
    setProgress({ phase: "library", percent: 100, label: "Adding to the library" })
    await api.importPaths([saved.audioPath], false, false)
    return saved.title.trim() || title
  }

  async function download() {
    if (keep && resolution == null) {
      setError("Choose a resolution for the video you want to keep.")
      return
    }
    const playlist = details?.kind === "playlist" && rows.length > 0
    if (playlist && !rows.some((row) => row.included)) {
      setError("Choose at least one video.")
      return
    }
    setError("")
    setProgress({ phase: "prepare", percent: 0, label: "Preparing the downloader" })
    setBusy("download")
    const savedNames: string[] = []
    try {
      const queue = playlist ? rows : [{ index: 0, title: details?.title ?? "Track", author: "", url, length: 0, included: true, status: "Queued" }]
      for (const row of queue) {
        if (playlist && !includedRef.current.has(row.index)) {
          markRow(row.index, "Skipped")
          continue
        }
        activeRef.current = row.index
        markRow(row.index, "Downloading")
        try {
          const name = await saveOne(row.url, row.title)
          savedNames.push(name)
          markRow(row.index, "Done")
        } catch (reason) {
          const text = message(reason)
          if (text === "Skipped.") {
            markRow(row.index, "Skipped")
            continue
          }
          markRow(row.index, "Failed")
          setError(text)
        } finally {
          activeRef.current = null
        }
      }
      if (savedNames.length) {
        await useLibrary.getState().refresh()
        useLibrary.setState({
          notice: savedNames.length === 1 ? `${savedNames[0]} is in the library.` : `${savedNames.length} tracks are in the library.`,
        })
      }
      progressRef.current = null
      setProgress(null)
      if (!playlist && savedNames.length) onOpenChange(false)
    } catch (reason) {
      setError(message(reason))
    } finally {
      activeRef.current = null
      setBusy(null)
    }
  }

  const running = busy != null
  const sameVideo = details != null && probedUrl === url.trim()
  const percent = !progress ? 0 : progress.phase === "download" ? Math.max(0, Math.min(100, progress.percent)) : progress.phase === "prepare" ? 12 : 100

  const playlist = sameVideo && details.kind === "playlist"

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
        <DialogContent
          className="panel-solid w-[min(42rem,calc(100%-2rem))] outline-none focus:outline-none"
          onPointerDownOutside={(event) => running && event.preventDefault()}
          onEscapeKeyDown={(event) => running && event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>From YouTube</DialogTitle>
          </DialogHeader>
          <div className="max-h-[min(36rem,calc(100vh-8rem))] space-y-4 overflow-auto pr-1">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (!running) void lookUp()
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="Paste a video or playlist link"
                  disabled={running}
                  maxLength={400}
                  aria-label="YouTube link"
                  className="border-[#3a3a3a] bg-[#1c1c1c] pr-11 shadow-none ring-0 outline-none focus-visible:border-white focus-visible:ring-0"
                />
                {url && !running ? (
                  <Button type="button" variant="ghost" size="icon" className="absolute top-0 right-0" aria-label="Clear link" onClick={() => setUrl("")}>
                    <X className="size-4" />
                  </Button>
                ) : null}
              </div>
              <Button type="submit" variant="outline" disabled={running || !url.trim()}>
                {busy === "lookup" ? <CubeLoader size={22} label="Looking up" /> : <Search className="size-4" />}
                {busy === "lookup" ? "Looking up…" : "Look up"}
              </Button>
            </form>
            {sameVideo ? (
              <div>
                <p className="truncate text-base">{details.title}</p>
                <p className="text-sm text-muted-foreground">
                  {playlist
                    ? `${rows.length} videos`
                    : [details.author, details.length > 0 ? formatClock(details.length) : ""].filter(Boolean).join(" · ")}
                </p>
              </div>
            ) : null}
            {playlist ? (
              <div className="overflow-hidden rounded-lg border border-[#3a3a3a]">
                <div className="flex items-center justify-between border-b border-[#3a3a3a] px-3 py-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer"
                      checked={rows.every((row) => row.included)}
                      disabled={running}
                      onChange={(event) => setRows((current) => current.map((row) => ({ ...row, included: event.target.checked, status: event.target.checked && row.status === "Skipped" ? "Queued" : row.status })))}
                    />
                    All
                  </label>
                  <Button variant="ghost" size="sm" disabled={!running} onClick={() => void api.youtubeSkip()}>
                    Skip current
                  </Button>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
                    <tr>
                      <th className="px-3 py-2 font-medium">Keep</th>
                      <th className="px-3 py-2 font-medium">Title</th>
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.url} className="border-t border-[#2a2a2a]">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="size-4 cursor-pointer"
                            checked={row.included}
                            disabled={running && row.status !== "Queued"}
                            aria-label={`Include ${row.title}`}
                            onChange={(event) => setRows((current) => current.map((item) => (item.index === row.index ? { ...item, included: event.target.checked } : item)))}
                          />
                        </td>
                        <td className="max-w-56 truncate px-3 py-2">{row.title}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.length > 0 ? formatClock(row.length) : "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.included ? row.status : "Skipped"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <label className="flex cursor-pointer items-center gap-3 text-base">
              <input
                type="checkbox"
                className="size-5 cursor-pointer"
                checked={keep}
                disabled={running}
                onChange={(event) => setKeep(event.target.checked)}
              />
              Keep the video
            </label>
            {keep ? (
              sameVideo ? (
                <div className="flex flex-wrap gap-2">
                  {(playlist ? [{ height: 360, label: "360p" }, { height: 720, label: "720p" }, { height: 1080, label: "1080p" }] : details.resolutions).map((item) => (
                    <button
                      key={item.height}
                      type="button"
                      disabled={running}
                      className={cn(
                        "cursor-pointer rounded-full border border-white/15 px-3 py-1 text-sm hover:bg-white/10",
                        resolution === item.height && "bg-white text-black hover:bg-white",
                      )}
                      onClick={() => setResolution(item.height)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Look up the video to choose a resolution.</p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">Only the audio is saved, taken from the best available track.</p>
            )}
            <FolderRow
              label="Audio"
              path={audioDir}
              disabled={running}
              onChoose={() => void chooseDir("Audio folder", audioDir, audioKey, setAudioDir).catch((reason: unknown) => setError(message(reason)))}
              onOpen={() => void api.youtubeReveal(audioDir).catch((reason: unknown) => setError(message(reason)))}
            />
            <FolderRow
              label="Videos"
              path={videoDir}
              disabled={running}
              onChoose={() => void chooseDir("Video folder", videoDir, videoKey, setVideoDir).catch((reason: unknown) => setError(message(reason)))}
              onOpen={() => void api.youtubeReveal(videoDir).catch((reason: unknown) => setError(message(reason)))}
            />
            {progress ? (
              <div>
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-white/15">
                  <div className="h-full bg-white transition-[width] duration-150" style={{ width: `${percent}%` }} />
                </div>
                <p className="text-sm text-foreground">
                  {progress.label}
                  {progress.phase === "download" ? ` · ${Math.round(percent)}%` : ""}
                </p>
              </div>
            ) : null}
            {error ? <p className="text-sm text-pigment">{error}</p> : null}
            <Button
              disabled={running || !url.trim() || !audioDir || (keep && (!sameVideo || resolution == null)) || (playlist && !rows.some((row) => row.included))}
              onClick={() => void download()}
            >
              {busy === "download" ? <CubeLoader size={22} label="Downloading" /> : null}
              {busy === "download" ? "Working…" : "Download"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function remember(key: string, path: string, setDir: (path: string) => void) {
  localStorage.setItem(key, path)
  setDir(path)
}

function FolderRow({
  label,
  path,
  disabled,
  onChoose,
  onOpen,
}: {
  label: string
  path: string
  disabled: boolean
  onChoose: () => void
  onOpen: () => void
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">{label}</p>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm">{path || "No folder yet"}</p>
        <Button variant="outline" size="sm" disabled={disabled} onClick={onChoose}>
          Choose
        </Button>
        <Button variant="ghost" size="sm" disabled={!path} onClick={onOpen}>
          <FolderOpen className="size-4" />
          Open
        </Button>
      </div>
    </div>
  )
}
