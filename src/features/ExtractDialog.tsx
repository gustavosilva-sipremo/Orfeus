import { listen } from "@tauri-apps/api/event"
import { open } from "@tauri-apps/plugin-dialog"
import { useEffect, useState } from "react"
import { CubeLoader } from "@/components/kit/CubeLoader"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import * as api from "@/lib/api"
import type { ExportProgress } from "@/lib/types"
import { message } from "@/lib/utils"

export function ExtractDialog({
  open: shown,
  title,
  hint,
  onOpenChange,
  onStart,
}: {
  open: boolean
  title: string
  hint: string
  onOpenChange: (open: boolean) => void
  onStart: (dir: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [error, setError] = useState("")
  const [folder, setFolder] = useState("")

  useEffect(() => {
    if (!shown) return
    setError("")
    setProgress(null)
    setFolder("")
    let stop = () => {}
    void listen<ExportProgress>("export://progress", (event) => setProgress(event.payload)).then((unlisten) => {
      stop = unlisten
    })
    return () => stop()
  }, [shown])

  async function choose() {
    const picked = await open({ directory: true, title })
    if (typeof picked !== "string") return
    setFolder(picked)
    setBusy(true)
    setError("")
    try {
      await onStart(picked)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const label = progress && progress.total ? `${progress.done} of ${progress.total}${progress.current ? ` · ${progress.current}` : ""}` : "Preparing"

  return (
    <Dialog open={shown} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{hint}</p>
        {folder ? <p className="mt-3 truncate text-sm">{folder}</p> : null}
        {progress ? <p className="mt-3 text-sm tabular-nums">{label}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          {busy ? <CubeLoader size={28} label={label} /> : null}
          {folder && !busy ? <Button variant="outline" onClick={() => void api.revealPath(folder).catch((err: unknown) => setError(message(err)))}>Open folder</Button> : null}
          <Button disabled={busy} onClick={() => void choose()}>{folder ? "Choose another folder" : "Choose folder"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
