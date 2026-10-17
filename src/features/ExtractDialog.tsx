import { listen } from "@tauri-apps/api/event"
import { open } from "@tauri-apps/plugin-dialog"
import { useEffect, useState } from "react"
import { CubeLoader } from "@/components/kit/CubeLoader"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import * as api from "@/lib/api"
import type { ExportProgress } from "@/lib/types"
import { message } from "@/lib/utils"

const folderKey = "orfeus-extract-folder"

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
  const [folder, setFolder] = useState(() => localStorage.getItem(folderKey) ?? "")

  useEffect(() => {
    if (!shown) return
    setError("")
    setProgress(null)
    setFolder(localStorage.getItem(folderKey) ?? "")
    let stop = () => {}
    void listen<ExportProgress>("export://progress", (event) => setProgress(event.payload)).then((unlisten) => {
      stop = unlisten
    })
    return () => stop()
  }, [shown])

  async function choose() {
    const picked = await open({ directory: true, title })
    if (typeof picked !== "string") return
    localStorage.setItem(folderKey, picked)
    setFolder(picked)
    setError("")
    setProgress(null)
  }

  async function extract() {
    if (!folder || busy) return
    setBusy(true)
    setError("")
    setProgress(null)
    try {
      await onStart(folder)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const label = progress && progress.total ? `${progress.done} of ${progress.total}${progress.current ? ` · ${progress.current}` : ""}` : "Extracting"

  return (
    <Dialog open={shown} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{hint}</p>
        <p className="mt-3 truncate text-sm">{folder || "No folder chosen yet."}</p>
        {progress ? <p className="mt-3 text-sm tabular-nums">{label}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          {folder && !busy ? <Button variant="outline" onClick={() => void api.revealPath(folder).catch((err: unknown) => setError(message(err)))}>Open folder</Button> : null}
          <Button variant="outline" disabled={busy} onClick={() => void choose()}>{folder ? "Choose another folder" : "Choose folder"}</Button>
          <Button disabled={busy || !folder} onClick={() => void extract()}>
            {busy ? <CubeLoader size={18} label={label} /> : null}
            Extract
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
