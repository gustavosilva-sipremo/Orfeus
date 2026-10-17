import { listen } from "@tauri-apps/api/event"
import { useEffect, useMemo, useState } from "react"
import { CubeLoader } from "@/components/kit/CubeLoader"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import * as api from "@/lib/api"
import { formatBytes, formatMinutes } from "@/lib/format"
import type { OpticalDrive } from "@/lib/types"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"

type DiscKind = "audio" | "cd" | "dvd"

const modes: { id: DiscKind; title: string; detail: string; blank: string }[] = [
  {
    id: "audio",
    title: "Audio CD",
    detail: "A music CD for a CD player. This is not a DVD. About 80 minutes, up to 99 tracks.",
    blank: "Blank CD",
  },
  {
    id: "cd",
    title: "Data CD",
    detail: "The original files on a CD, named 01. Track name. A computer can open them. About 700 MB.",
    blank: "Blank CD",
  },
  {
    id: "dvd",
    title: "Data DVD",
    detail: "The original files on a DVD, named 01. Track name. A computer can open them. About 4.7 GB.",
    blank: "Blank DVD",
  },
]

const cdBytes = 680 * 1_000_000
const dvdBytes = 4_500 * 1_000_000

export function BurnDialog({ open, trackIds, onOpenChange }: { open: boolean; trackIds: string[]; onOpenChange: (open: boolean) => void }) {
  const library = useLibrary((state) => state.tracks)
  const [drives, setDrives] = useState<OpticalDrive[]>([])
  const [device, setDevice] = useState("")
  const [kind, setKind] = useState<DiscKind>("audio")
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")

  const chosen = useMemo(
    () => trackIds.flatMap((id) => library.filter((track) => track.id === id)),
    [library, trackIds],
  )
  const minutes = chosen.reduce((sum, track) => sum + Math.max(0, track.durationMs), 0)
  const bytes = chosen.reduce((sum, track) => sum + track.sizeBytes, 0)
  const mode = modes.find((item) => item.id === kind) ?? modes[0]
  const tooBig = kind === "audio"
    ? minutes > 80 * 60 * 1000 || trackIds.length > 99
    : bytes > (kind === "dvd" ? dvdBytes : cdBytes)
  const summary = `${trackIds.length} ${trackIds.length === 1 ? "track" : "tracks"} · ${formatMinutes(minutes)} · ${formatBytes(bytes)}`

  useEffect(() => {
    if (!open) return
    setConfirm(false)
    setError("")
    setProgress("")
    void api.listDrives().then((found) => {
      setDrives(found)
      setDevice((current) => found.some((drive) => drive.device === current) ? current : (found[0]?.device ?? ""))
    }).catch((err: unknown) => setError(message(err)))
    let stop = () => {}
    void listen<string>("disc://progress", (event) => setProgress(event.payload)).then((unlisten) => {
      stop = unlisten
    })
    return () => stop()
  }, [open])

  async function burn() {
    setBusy(true)
    setError("")
    try {
      await api.burnDisc(kind, device, trackIds)
      setProgress("The disc is ready. Eject it from the drive.")
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const limit = kind === "audio"
    ? "Too long for an audio CD."
    : kind === "dvd"
      ? "Too large for a data DVD."
      : "Too large for a data CD."

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Burn a CD or a DVD</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{summary}. Put a blank disc in the drive before you start. Burning replaces what is already on a rewritable disc.</p>
        <div className="mt-4 space-y-2">
          {modes.map((item) => {
            const selected = kind === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left ${selected ? "border-white bg-[#1c1c1c] text-white" : "border-white/10 text-white/55"}`}
                onClick={() => setKind(item.id)}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-base text-white">{item.title}</span>
                  <span className="text-xs tracking-[0.14em] uppercase">{item.blank}</span>
                </span>
                <span className="mt-1 block text-sm">{item.detail}</span>
              </button>
            )
          })}
        </div>
        <label className="mt-4 block text-sm">
          Drive
          <select className="mt-1 h-11 w-full cursor-pointer rounded-md border border-white/10 bg-black px-3 text-foreground [color-scheme:dark]" value={device} onChange={(event) => setDevice(event.target.value)}>
            {drives.length ? null : <option value="">No optical drive found</option>}
            {drives.map((drive) => (
              <option key={drive.device} value={drive.device}>{drive.label} · {drive.device}{drive.size ? ` · ${drive.size}` : ""}</option>
            ))}
          </select>
        </label>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 size-4 cursor-pointer" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
          The {mode.blank.toLowerCase()} in this drive can be overwritten.
        </label>
        {tooBig ? <p className="mt-3 text-sm text-red-300">{limit}</p> : null}
        {progress ? <p className="mt-3 text-sm">{progress}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button disabled={busy || !confirm || !device || !trackIds.length || tooBig} onClick={() => void burn()}>
            {busy ? <CubeLoader size={18} label={progress || "Writing the disc"} /> : null}
            {kind === "audio" ? "Burn audio CD" : kind === "cd" ? "Burn data CD" : "Burn data DVD"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
