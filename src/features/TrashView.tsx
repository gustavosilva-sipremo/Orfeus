import { Trash2 } from "lucide-react"
import { useState } from "react"
import { Cover } from "@/components/Cover"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { artistLabel } from "@/lib/format"
import type { Track } from "@/lib/types"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"

export function TrashView() {
  const trash = useLibrary((state) => state.trash)
  const restoreTrack = useLibrary((state) => state.restoreTrack)
  const purgeTrack = useLibrary((state) => state.purgeTrack)
  const [pending, setPending] = useState<Track | null>(null)

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="serif text-2xl sm:text-3xl">Trash</h2>
        <p className="text-base text-muted-foreground">
          {trash.length === 1 ? "1 track can be restored or deleted." : `${trash.length} tracks can be restored or deleted.`}
        </p>
      </header>
      {trash.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <Trash2 className="mb-3 size-10 text-primary" />
          <h3 className="serif text-3xl">Trash is empty</h3>
          <p className="mt-2 max-w-sm text-base text-muted-foreground">Tracks you remove from a library stay here until you restore them or delete the file.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-auto px-3 pb-4 sm:px-5">
          {trash.map((track) => (
            <li key={track.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
              <Cover path={track.coverPath} className="size-12 rounded" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base">{track.title}</span>
                <span className="block truncate text-sm text-muted-foreground">{artistLabel(track.artist)}</span>
              </span>
              <Button variant="outline" size="sm" onClick={() => void restoreTrack(track.id).catch(showError)}>
                Restore
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPending(track)}>
                Delete file
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={pending != null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {pending?.title}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">The audio file is removed from the disk. This cannot be undone.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!pending) return
                const id = pending.id
                setPending(null)
                void purgeTrack(id).catch(showError)
              }}
            >
              Delete file
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function showError(error: unknown) {
  useLibrary.setState({ error: message(error) })
}
