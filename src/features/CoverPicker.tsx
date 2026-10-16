import { useEffect, useState } from "react"
import { Cover } from "@/components/Cover"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import * as api from "@/lib/api"
import type { SavedCover } from "@/lib/types"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"

export function CoverPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (path: string) => void }) {
  const [covers, setCovers] = useState<SavedCover[]>([])

  useEffect(() => {
    if (!open || !api.desktop()) return
    let alive = true
    void api.listCovers().then(
      (next) => {
        if (alive) setCovers(next)
      },
      (error: unknown) => {
        if (alive) useLibrary.setState({ error: message(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(44rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>Saved covers</DialogTitle>
        </DialogHeader>
        {covers.length === 0 ? <p className="text-sm text-muted-foreground">No saved covers yet. Paste or drop an image, or choose a file.</p> : null}
        <div className="grid max-h-[min(28rem,60vh)] grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2 overflow-auto pr-1">
          {covers.map((cover) => (
            <button
              key={cover.path}
              type="button"
              className="cursor-pointer rounded-lg p-1 text-left hover:bg-white/10"
              title={cover.label}
              onClick={() => {
                onPick(cover.path)
                onOpenChange(false)
              }}
            >
              <Cover path={cover.path} className="aspect-square w-full rounded-md" />
              <span className="mt-1 block truncate text-xs text-muted-foreground">{cover.label}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
