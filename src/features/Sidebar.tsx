import { FolderArchive, Library, Plus } from "lucide-react"
import { useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { Cover } from "@/components/Cover"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import * as api from "@/lib/api"
import { cn, message } from "@/lib/utils"
import { version } from "../../package.json"
import { useLibrary } from "@/stores/library"

function PaintingCredit() {
  const [openCredit, setOpenCredit] = useState(false)
  return (
    <>
      <button type="button" className="w-full cursor-pointer px-1 text-left text-xs leading-relaxed text-white/70" onClick={() => setOpenCredit(true)}>
        Background: Orpheus and Eurydice, Peter Paul Rubens, 1636–1638
      </button>
      <Dialog open={openCredit} onOpenChange={setOpenCredit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Orpheus and Eurydice</DialogTitle>
          </DialogHeader>
          <dl className="space-y-2 text-sm leading-relaxed">
            <div><dt className="text-muted-foreground">Artist</dt><dd>Peter Paul Rubens (1577–1640)</dd></div>
            <div><dt className="text-muted-foreground">Title</dt><dd>Orpheus and Eurydice</dd></div>
            <div><dt className="text-muted-foreground">Type</dt><dd>Mythological painting</dd></div>
            <div><dt className="text-muted-foreground">Subject</dt><dd>Orpheus and Eurydice</dd></div>
            <div><dt className="text-muted-foreground">Date</dt><dd>1636–1638</dd></div>
          </dl>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function Sidebar() {
  const view = useLibrary((state) => state.view)
  const playlists = useLibrary((state) => state.playlists)
  const setView = useLibrary((state) => state.setView)
  const createPlaylist = useLibrary((state) => state.createPlaylist)
  const importPackage = useLibrary((state) => state.importPackage)
  const [openNew, setOpenNew] = useState(false)
  const [name, setName] = useState("")

  async function onImportPackage() {
    if (!api.desktop()) {
      useLibrary.setState({ notice: "Package import opens in the desktop app." })
      return
    }
    const picked = await open({
      title: "Import package",
      filters: [{ name: "Orfeus package", extensions: ["orfeus"] }],
    })
    if (typeof picked !== "string") return
    await importPackage(picked)
  }

  return (
    <aside className="glass flex w-80 shrink-0 flex-col border-r">
      <div className="px-5 pt-6 pb-4">
        <p className="text-xs tracking-[0.32em] text-gold uppercase">local library</p>
        <div className="mt-1 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-12 rounded-xl" />
          <h1 className="serif text-4xl italic">Orfeus</h1>
        </div>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-1 px-3">
        <button
          type="button"
          className={cn("flex cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-left text-base", view.kind === "library" && "bg-accent")}
          onClick={() => setView({ kind: "library" })}
        >
          <Library className="size-5 text-primary" />
          Library
        </button>
        <div className="mt-4 flex items-center justify-between px-3">
          <span className="text-xs tracking-[0.22em] text-muted-foreground uppercase">Playlists</span>
          <Button variant="ghost" size="icon" onClick={() => setOpenNew(true)} aria-label="New playlist">
            <Plus className="size-5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto pb-3">
          {playlists.length === 0 ? <p className="px-3 py-2 text-sm text-muted-foreground">No playlists yet.</p> : null}
          {playlists.map((playlist) => {
            const active = view.kind === "playlist" && view.id === playlist.id
            return (
              <button
                key={playlist.id}
                type="button"
                className={cn("flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left", active && "bg-accent")}
                onClick={() => setView({ kind: "playlist", id: playlist.id })}
              >
                <Cover path={playlist.coverPath} className="size-10 rounded" />
                <span className="min-w-0">
                  <span className="block truncate text-base">{playlist.name}</span>
                  <span className="text-sm text-muted-foreground">{playlist.trackIds.length} tracks</span>
                </span>
              </button>
            )
          })}
        </div>
      </nav>
      <div className="space-y-2 border-t border-white/10 p-3">
        <Button variant="outline" className="w-full" onClick={() => void onImportPackage().catch((error: unknown) => useLibrary.setState({ error: message(error) }))}>
          <FolderArchive className="size-5" />
          Import package
        </Button>
        <PaintingCredit />
        <p className="px-1 text-[11px] tracking-wide text-white/40">v{version}</p>
      </div>
      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New playlist</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              const next = name.trim()
              if (!next) return
              void createPlaylist(next)
              setName("")
              setOpenNew(false)
            }}
          >
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Playlist name" autoFocus />
            <Button type="submit">Create</Button>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
