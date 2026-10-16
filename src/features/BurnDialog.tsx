import { listen } from "@tauri-apps/api/event"
import { useEffect, useState } from "react"
import { CubeLoader } from "@/components/kit/CubeLoader"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import * as api from "@/lib/api"
import type { OpticalDrive } from "@/lib/types"
import { message } from "@/lib/utils"

export function BurnDialog({ open, trackIds, onOpenChange }: { open: boolean; trackIds: string[]; onOpenChange: (open: boolean) => void }) {
  const [drives, setDrives] = useState<OpticalDrive[]>([])
  const [device, setDevice] = useState("")
  const [kind, setKind] = useState<"audio" | "data">("audio")
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setConfirm(false)
    setError("")
    setProgress("")
    void api.listDrives().then((found) => {
      setDrives(found)
      setDevice(found[0]?.device ?? "")
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
      setProgress("The disc is ready.")
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
          <DialogTitle>Burn a disc</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{trackIds.length} tracks. An audio CD holds about 80 minutes. A data disc keeps the files as they are.</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className={`h-10 flex-1 cursor-pointer rounded-md border ${kind === "audio" ? "border-white bg-white text-black" : "border-white/15"}`} onClick={() => setKind("audio")}>Audio CD</button>
          <button type="button" className={`h-10 flex-1 cursor-pointer rounded-md border ${kind === "data" ? "border-white bg-white text-black" : "border-white/15"}`} onClick={() => setKind("data")}>Data disc</button>
        </div>
        <label className="mt-4 block text-sm">
          Drive
          <select className="mt-1 h-11 w-full rounded-md border border-white/15 bg-[#0c0c0c] px-3 scheme-dark" value={device} onChange={(event) => setDevice(event.target.value)}>
            {drives.length ? null : <option value="">No optical drive found</option>}
            {drives.map((drive) => (
              <option key={drive.device} value={drive.device}>{drive.label} · {drive.device}{drive.size ? ` · ${drive.size}` : ""}</option>
            ))}
          </select>
        </label>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
          A rewritable disc in this drive will be overwritten.
        </label>
        {progress ? <p className="mt-3 text-sm">{progress}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          {busy ? <CubeLoader size={28} label="Writing the disc" /> : null}
          <Button disabled={busy || !confirm || !device || !trackIds.length} onClick={() => void burn()}>Burn</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
