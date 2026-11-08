import { listen } from "@tauri-apps/api/event"
import { useEffect, useState } from "react"
import { CubeLoader } from "@/components/kit/CubeLoader"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import * as api from "@/lib/api"
import type { OpticalDrive } from "@/lib/types"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"

export function ReadDiscDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const refresh = useLibrary((state) => state.refresh)
  const setView = useLibrary((state) => state.setView)
  const [drives, setDrives] = useState<OpticalDrive[]>([])
  const [device, setDevice] = useState("")
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
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

  async function read() {
    setBusy(true)
    setError("")
    try {
      const playlistId = await api.readDisc(device)
      await refresh()
      setView({ kind: "playlist", id: playlistId })
      onOpenChange(false)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Read a CD or a DVD</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Tracks are copied into the library and collected in a new playlist. An audio CD is read track by track. A data disc contributes the music files stored on it.</p>
        <label className="mt-4 block text-sm">
          Drive
          <select className="mt-1 h-11 w-full cursor-pointer rounded-md border border-white/10 bg-black px-3 text-foreground scheme-dark" value={device} onChange={(event) => setDevice(event.target.value)}>
            {drives.length ? null : <option value="">No optical drive found</option>}
            {drives.map((drive) => (
              <option key={drive.device} value={drive.device}>{drive.label} · {drive.device}{drive.size ? ` · ${drive.size}` : ""}</option>
            ))}
          </select>
        </label>
        {progress ? <p className="mt-3 text-sm">{progress}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button disabled={busy || !device} onClick={() => void read()}>
            {busy ? <CubeLoader size={18} label={progress || "Reading the disc"} /> : null}
            Read disc
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
