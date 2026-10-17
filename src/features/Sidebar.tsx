import { BarChart3, FolderArchive, Images, Keyboard, Library, Music, Plus, Podcast, Star, Trash2, X } from "lucide-react"
import { useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { Cover } from "@/components/Cover"
import { LightMenu } from "@/components/kit/LightMenu"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import * as api from "@/lib/api"
import { tally } from "@/lib/format"
import { message } from "@/lib/utils"
import { version } from "../../package.json"
import { useLibrary } from "@/stores/library"

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const view = useLibrary((state) => state.view)
  const shelves = useLibrary((state) => state.shelves)
  const playlists = useLibrary((state) => state.playlists)
  const tracks = useLibrary((state) => state.tracks)
  const setView = useLibrary((state) => state.setView)
  const createPlaylist = useLibrary((state) => state.createPlaylist)
  const createShelf = useLibrary((state) => state.createShelf)
  const setShelfKind = useLibrary((state) => state.setShelfKind)
  const removeShelf = useLibrary((state) => state.removeShelf)
  const importPackage = useLibrary((state) => state.importPackage)
  const savePlaylist = useLibrary((state) => state.savePlaylist)
  const [openNew, setOpenNew] = useState(false)
  const [openShelf, setOpenShelf] = useState(false)
  const [name, setName] = useState("")
  const [shelfName, setShelfName] = useState("")
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  async function onImportPackage() {
    if (!api.desktop()) {
      useLibrary.setState({ notice: "Package import opens in the desktop app." })
      return
    }
    const picked = await open({
      title: "Import playlist",
      filters: [{ name: "Orfeus package", extensions: ["orfeus"] }],
    })
    if (typeof picked !== "string") return
    await importPackage(picked)
  }

  return (
    <aside className="glass flex h-full w-72 max-w-[86vw] shrink-0 flex-col border-r md:w-80">
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-12 rounded-xl" />
          <h1 className="serif text-4xl italic">Orfeus</h1>
        </div>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-y-contain px-3 [scrollbar-color:rgba(255,255,255,0.28)_transparent] scrollbar-thin">
        <div className="flex items-center justify-between px-3">
          <span className="text-xs tracking-[0.22em] text-muted-foreground uppercase">Libraries</span>
          <Button variant="ghost" size="icon" onClick={() => setOpenShelf(true)} aria-label="New library">
            <Plus className="size-5" />
          </Button>
        </div>
        <LightMenu
          label="Libraries"
          value={view.kind === "library" ? view.id : view.kind}
          onValueChange={(next) => {
            if (next === "covers" || next === "status" || next === "trash") setView({ kind: next })
            else setView({ kind: "library", id: next })
            onNavigate?.()
          }}
          options={[
            ...shelves.map((shelf) => {
              const primary = shelf.createdAt === Math.min(...shelves.map((item) => item.createdAt))
              const podcast = shelf.kind === "podcast"
              return {
                value: shelf.id,
                label: (
                  <span className="flex h-full w-full items-center gap-3">
                    <span
                      role="presentation"
                      className={`flex size-8 shrink-0 items-center justify-center rounded-md ${primary ? "" : "hover:bg-white/10"}`}
                      aria-label={primary ? "Main library" : podcast ? "Use the music icon" : "Use the podcast icon"}
                      onClick={(event) => {
                        if (primary) return
                        event.stopPropagation()
                        void setShelfKind(shelf.id, podcast ? "music" : "podcast").catch((reason: unknown) => useLibrary.setState({ error: message(reason) }))
                      }}
                    >
                      {primary ? <Library className="size-5" /> : podcast ? <Podcast className="size-5" /> : <Music className="size-5" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{shelf.name}</span>
                    {shelves.length > 1 ? (
                      <span
                        role="presentation"
                        className="flex size-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
                        aria-label={`Remove ${shelf.name}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          void removeShelf(shelf.id).catch((reason: unknown) => useLibrary.setState({ error: message(reason) }))
                        }}
                      >
                        <X className="size-4" />
                      </span>
                    ) : null}
                  </span>
                ),
              }
            }),
            {
              value: "covers",
              label: (
                <span className="flex h-full w-full items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center">
                    <Images className="size-5" />
                  </span>
                  <span>Covers</span>
                </span>
              ),
            },
            {
              value: "status",
              label: (
                <span className="flex h-full w-full items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center">
                    <BarChart3 className="size-5" />
                  </span>
                  <span>Status</span>
                </span>
              ),
            },
            {
              value: "trash",
              label: (
                <span className="flex h-full w-full items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center">
                    <Trash2 className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">Trash</span>
                </span>
              ),
            },
          ]}
        />
        <div className="mt-4 flex items-center justify-between px-3">
          <span className="text-xs tracking-[0.22em] text-muted-foreground uppercase">Playlists</span>
          <Button variant="ghost" size="icon" onClick={() => setOpenNew(true)} aria-label="New playlist">
            <Plus className="size-5" />
          </Button>
        </div>
        <div className="pb-3">
          {playlists.length === 0 ? <p className="px-3 py-2 text-sm text-muted-foreground">No playlists yet.</p> : (
            <LightMenu
              label="Playlists"
              value={view.kind === "playlist" ? view.id : ""}
              onValueChange={(id) => {
                setView({ kind: "playlist", id })
                onNavigate?.()
              }}
              options={playlists.map((playlist) => {
                const members = playlist.trackIds.flatMap((id) => {
                  const track = tracks.find((item) => item.id === id)
                  return track ? [track] : []
                })
                const summary = `${members.length} tracks · ${tally(members)}`
                return {
                  value: playlist.id,
                  label: (
                    <span className="flex h-full w-full items-center gap-3">
                      <Cover path={playlist.coverPath} className="size-8 shrink-0 rounded" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate leading-tight">{playlist.name}</span>
                        <span className="block truncate text-xs leading-tight text-muted-foreground" title={summary}>{summary}</span>
                      </span>
                      <span
                        role="presentation"
                        className="flex size-8 items-center justify-center rounded-md hover:bg-white/10"
                        aria-label={playlist.favorite ? "Remove from favorites" : "Pin as favorite"}
                        onClick={(event) => {
                          event.stopPropagation()
                          void savePlaylist({ id: playlist.id, favorite: !playlist.favorite }).catch((reason: unknown) => useLibrary.setState({ error: message(reason) }))
                        }}
                      >
                        <Star className={`size-4 ${playlist.favorite ? "fill-amber-200 text-amber-200" : "text-white/40"}`} />
                      </span>
                    </span>
                  ),
                }
              })}
            />
          )}
        </div>
      </nav>
      <div className="space-y-2 border-t border-white/10 p-3">
        <Button variant="outline" className="w-full" onClick={() => void onImportPackage().catch((error: unknown) => useLibrary.setState({ error: message(error) }))}>
          <FolderArchive className="size-5" />
          Import playlist
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => setShortcutsOpen(true)}>
          <Keyboard className="size-5" />
          Shortcuts
        </Button>
        <p className="px-1 text-[11px] tracking-wide text-white/40">v{version}</p>
      </div>
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Shortcuts</DialogTitle>
          </DialogHeader>
          <ul className="space-y-2 text-base">
            <li className="flex justify-between gap-4"><span>Play or pause</span><span className="text-muted-foreground">Space</span></li>
            <li className="flex justify-between gap-4"><span>Back 5 seconds</span><span className="text-muted-foreground">Left</span></li>
            <li className="flex justify-between gap-4"><span>Forward 5 seconds</span><span className="text-muted-foreground">Right</span></li>
            <li className="flex justify-between gap-4"><span>Previous track</span><span className="text-muted-foreground">Alt + Left</span></li>
            <li className="flex justify-between gap-4"><span>Next track</span><span className="text-muted-foreground">Alt + Right</span></li>
            <li className="flex justify-between gap-4"><span>Listing size</span><span className="text-muted-foreground">Alt + scroll</span></li>
            <li className="flex justify-between gap-4"><span>Track actions</span><span className="text-muted-foreground">Right click</span></li>
          </ul>
        </DialogContent>
      </Dialog>
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
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Playlist name" maxLength={80} autoFocus />
            <Button type="submit">Create</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={openShelf} onOpenChange={setOpenShelf}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New library</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              const next = shelfName.trim()
              if (!next) return
              void createShelf(next).catch((error: unknown) => useLibrary.setState({ error: message(error) }))
              setShelfName("")
              setOpenShelf(false)
              onNavigate?.()
            }}
          >
            <Input value={shelfName} onChange={(event) => setShelfName(event.target.value)} placeholder="Library name" maxLength={80} autoFocus />
            <p className="text-sm text-muted-foreground">Tap the icon beside a library to switch between music and podcast.</p>
            <Button type="submit">Create</Button>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
