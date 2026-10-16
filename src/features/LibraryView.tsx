import { open } from "@tauri-apps/plugin-dialog"
import { Disc, Download, FolderOpen, FolderSync, ListPlus, MoreHorizontal, Music, Pencil, SlidersHorizontal, Trash2, Upload, Youtube } from "lucide-react"
import { lazy, Suspense, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Slider } from "@/components/ui/slider"
import { BrowseSkeleton } from "@/components/ui/skeleton"
import { BurnDialog } from "@/features/BurnDialog"
import { TrackBrowse } from "@/features/TrackBrowse"
import * as api from "@/lib/api"
import type { Track, WatchedFolder } from "@/lib/types"
import { tally } from "@/lib/format"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"
import { usePlayer } from "@/stores/player"

const YouTubeDialog = lazy(() => import("@/features/YouTubeDialog").then((mod) => ({ default: mod.YouTubeDialog })))

const exportKey = "orfeus-export-dir"
const playKey = "orfeus-play-mode"

const audioFilter = [{ name: "Audio", extensions: ["mp3", "flac", "ogg", "opus", "wav", "m4a", "aac", "mp4", "alac"] }]

export function LibraryView() {
  const allTracks = useLibrary((state) => state.tracks)
  const shelves = useLibrary((state) => state.shelves)
  const view = useLibrary((state) => state.view)
  const shelfId = view.kind === "library" ? view.id : ""
  const tracks = shelfId ? allTracks.filter((track) => track.shelfId === shelfId) : allTracks
  const shelfName = shelves.find((shelf) => shelf.id === shelfId)?.name ?? "Library"
  const ready = useLibrary((state) => state.ready)
  const playlists = useLibrary((state) => state.playlists)
  const importPaths = useLibrary((state) => state.importPaths)
  const deleteTrack = useLibrary((state) => state.deleteTrack)
  const addToPlaylist = useLibrary((state) => state.addToPlaylist)
  const exportTracks = useLibrary((state) => state.exportTracks)
  const setEditingId = useLibrary((state) => state.setEditingId)
  const playTracks = usePlayer((state) => state.playTracks)
  const currentId = usePlayer((state) => state.trackId)
  const [selected, setSelected] = useState<string[]>([])
  const [addId, setAddId] = useState<string | null>(null)
  const [folderOpen, setFolderOpen] = useState(false)
  const [recursive, setRecursive] = useState(true)
  const [watch, setWatch] = useState(true)
  const [watched, setWatched] = useState<WatchedFolder[]>([])
  const [volumeTrack, setVolumeTrack] = useState<Track | null>(null)
  const [exportDir, setExportDir] = useState(() => localStorage.getItem(exportKey) ?? "")
  const [youtubeOpen, setYoutubeOpen] = useState(false)
  const [burnOpen, setBurnOpen] = useState(false)
  const [playMode, setPlayMode] = useState<"one" | "sequence">(() => (localStorage.getItem(playKey) === "one" ? "one" : "sequence"))

  useEffect(() => {
    if (!api.desktop()) return
    void api.listWatched().then(setWatched).catch(() => undefined)
  }, [ready, tracks.length])

  async function chooseFiles() {
    if (!api.desktop()) {
      useLibrary.setState({ notice: "File import opens in the desktop app." })
      return
    }
    const picked = await open({ multiple: true, title: "Import music", filters: audioFilter })
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
    if (paths.length) await importPaths(paths)
  }

  async function chooseFolder() {
    setFolderOpen(true)
    if (!api.desktop()) return
    setWatched(await api.listWatched().catch(() => []))
  }

  async function confirmFolder() {
    if (!api.desktop()) {
      useLibrary.setState({ notice: "Folder import opens in the desktop app." })
      return
    }
    const picked = await open({ directory: true, title: "Music folder" })
    if (typeof picked !== "string") return
    setFolderOpen(false)
    await importPaths([picked], recursive, watch)
    setWatched(await api.listWatched().catch(() => []))
  }

  function rememberExport(path: string) {
    localStorage.setItem(exportKey, path)
    setExportDir(path)
  }

  async function chooseExportDir() {
    if (!api.desktop()) {
      useLibrary.setState({ notice: "The export folder is chosen in the desktop app." })
      return
    }
    const picked = await open({ directory: true, title: "Where to save exports" })
    if (typeof picked === "string") rememberExport(picked)
  }

  async function exportSelection(ids: string[]) {
    if (!api.desktop()) {
      useLibrary.setState({ notice: "Export opens in the desktop app." })
      return
    }
    let dest = exportDir
    if (!dest) {
      const picked = await open({ directory: true, title: "Export tracks" })
      if (typeof picked !== "string") return
      dest = picked
      rememberExport(dest)
    }
    await exportTracks(ids, dest)
  }

  async function saveGain(track: Track, gain: number) {
    await useLibrary.getState().updateTrack({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      lyrics: track.lyrics,
      syncedLyrics: track.syncedLyrics,
      gain,
    })
    setVolumeTrack((current) => (current?.id === track.id ? { ...current, gain } : current))
  }

  async function rescan() {
    if (!api.desktop()) {
      useLibrary.setState({ notice: "Folder rescan runs in the desktop app." })
      return
    }
    const found = await api.rescanFolders()
    await useLibrary.getState().refresh()
    useLibrary.setState({
      notice: found === 0 ? "No new tracks in the watched folders." : found === 1 ? "1 new track added from the watched folders." : `${found} new tracks added from the watched folders.`,
    })
  }

  function setMode(mode: "one" | "sequence") {
    localStorage.setItem(playKey, mode)
    setPlayMode(mode)
  }

  function playVisible(visible: Track[], index: number) {
    const track = visible[index]
    if (!track) return
    if (playMode === "one") void playTracks([track], 0)
    else void playTracks(visible, index)
  }

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6 sm:py-4">
        <div className="mr-auto min-w-0">
          <h2 className="serif truncate text-2xl sm:text-3xl">{shelfName}</h2>
          <p className="text-base text-muted-foreground">{ready ? `${tracks.length} tracks · ${tally(tracks)}` : "Opening the library…"}</p>
        </div>
        <div className="flex rounded-md border border-[#3a3a3a] bg-[#1c1c1c] p-1">
          <button type="button" className={`h-9 cursor-pointer rounded px-3 text-base ${playMode === "one" ? "bg-white text-black" : "text-white"}`} onClick={() => setMode("one")}>One track</button>
          <button type="button" className={`h-9 cursor-pointer rounded px-3 text-base ${playMode === "sequence" ? "bg-white text-black" : "text-white"}`} onClick={() => setMode("sequence")}>In order</button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Library</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setYoutubeOpen(true)}>
              <Youtube className="size-4" />
              YouTube
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void chooseFiles().catch(showError)}>
              <Upload className="size-4" />
              Files
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void chooseFolder().catch(showError)}>
              <FolderOpen className="size-4" />
              Folder
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void chooseExportDir().catch(showError)}>
              <FolderOpen className="size-4" />
              {exportDir ? "Change folder" : "Save location"}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!selected.length} onSelect={() => void exportSelection(selected).catch(showError)}>
              <Download className="size-4" />
              Export
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!selected.length} onSelect={() => setBurnOpen(true)}>
              <Disc className="size-4" />
              Burn disc
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <BurnDialog open={burnOpen} trackIds={selected} onOpenChange={setBurnOpen} />
        {youtubeOpen ? (
          <Suspense fallback={null}>
            <YouTubeDialog open={youtubeOpen} onOpenChange={setYoutubeOpen} />
          </Suspense>
        ) : null}
      </header>
      {exportDir ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-sm text-muted-foreground sm:px-6">
          <span className="min-w-0 truncate">Saving to {exportDir}</span>
          <Button variant="ghost" size="sm" onClick={() => void api.revealPath(exportDir).catch(showError)}>Open folder</Button>
        </div>
      ) : null}
      {watched.length ? (
        <div className="flex flex-wrap items-center gap-2 px-6 pb-3 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" onClick={() => void rescan().catch(showError)}>Rescan folders</Button>
          <FolderSync className="size-4" />
          {watched.map((folder) => (
            <button key={folder.path} type="button" className="cursor-pointer rounded-full border border-white/15 px-3 py-1 hover:bg-white/10" onClick={() => void api.unwatchFolder(folder.path).then(() => setWatched((current) => current.filter((item) => item.path !== folder.path))).catch(showError)}>
              {folder.path.split("/").pop()} · {folder.recursive ? "including subfolders" : "this folder only"} · stop
            </button>
          ))}
        </div>
      ) : null}
      {!ready ? (
        <BrowseSkeleton />
      ) : tracks.length === 0 ? (
        <EmptyLibrary filtered={false} onFiles={() => void chooseFiles().catch(showError)} onFolder={() => void chooseFolder().catch(showError)} />
      ) : (
        <TrackBrowse
          tracks={tracks}
          currentId={currentId}
          onOpen={playVisible}
          selectedIds={selected}
          onSelectVisible={(ids, on) => setSelected((current) => (on ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id))))}
          contextActions={(track) => [
            { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setEditingId(track.id) },
            { label: "Track volume", icon: <SlidersHorizontal className="size-4" />, onSelect: () => setVolumeTrack(track) },
            { label: "Add to playlist", icon: <ListPlus className="size-4" />, onSelect: () => setAddId(track.id) },
            { label: "Export", icon: <Download className="size-4" />, onSelect: () => void exportSelection([track.id]).catch(showError) },
            { label: "Move to Trash", icon: <Trash2 className="size-4" />, onSelect: () => void deleteTrack(track.id).catch(showError) },
          ]}
          actions={(track) => (
            <>
              <input
                type="checkbox"
                className="size-5 cursor-pointer"
                checked={selected.includes(track.id)}
                onClick={(event) => event.stopPropagation()}
                onChange={() => toggle(track.id)}
                aria-label={`Select ${track.title}`}
              />
              <TrackMenu track={track} onEdit={() => setEditingId(track.id)} onAdd={() => setAddId(track.id)} onVolume={() => setVolumeTrack(track)} onExport={() => void exportSelection([track.id]).catch(showError)} onDelete={() => void deleteTrack(track.id).catch(showError)} />
            </>
          )}
          empty={<EmptyLibrary filtered onFiles={() => void chooseFiles().catch(showError)} onFolder={() => void chooseFolder().catch(showError)} />}
        />
      )}
      <Dialog open={addId != null} onOpenChange={(open) => !open && setAddId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to playlist</DialogTitle>
          </DialogHeader>
          {playlists.length === 0 ? <p className="text-sm text-muted-foreground">Create a playlist first.</p> : null}
          <div className="space-y-1">
            {playlists.map((playlist) => (
              <Button
                key={playlist.id}
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  if (!addId) return
                  void addToPlaylist(playlist.id, [addId]).catch(showError)
                  setAddId(null)
                }}
              >
                {playlist.name}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Music folder</DialogTitle>
          </DialogHeader>
          <label className="flex cursor-pointer items-center gap-3 text-base">
            <input type="checkbox" className="size-5 cursor-pointer" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} />
            Include subfolders
          </label>
          <label className="mt-3 flex cursor-pointer items-center gap-3 text-base">
            <input type="checkbox" className="size-5 cursor-pointer" checked={watch} onChange={(event) => setWatch(event.target.checked)} />
            Update the list when new music arrives
          </label>
          <p className="mt-3 text-sm text-muted-foreground">Orfeus checks the folder from time to time and brings in new files without another import.</p>
          <Button className="mt-4" onClick={() => void confirmFolder().catch(showError)}>Choose folder</Button>
        </DialogContent>
      </Dialog>
      <Dialog open={volumeTrack != null} onOpenChange={(open) => !open && setVolumeTrack(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Volume for {volumeTrack?.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This level applies only to this track and multiplies the main volume.</p>
          <div className="mt-4 flex items-center gap-3">
            <Slider
              max={200}
              value={[Math.round((volumeTrack?.gain ?? 1) * 100)]}
              onValueChange={([value]) => {
                if (!volumeTrack) return
                setVolumeTrack({ ...volumeTrack, gain: (value ?? 100) / 100 })
              }}
              onValueCommit={([value]) => {
                if (!volumeTrack) return
                void saveGain(volumeTrack, (value ?? 100) / 100).catch(showError)
              }}
              aria-label="Track volume"
            />
            <span className="w-14 text-right tabular-nums">{Math.round((volumeTrack?.gain ?? 1) * 100)}%</span>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function TrackMenu({
  track,
  onEdit,
  onAdd,
  onVolume,
  onExport,
  onDelete,
}: {
  track: Track
  onEdit: () => void
  onAdd: () => void
  onVolume: () => void
  onExport: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${track.title}`}>
          <MoreHorizontal className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}><Pencil className="size-4" />Edit</DropdownMenuItem>
        <DropdownMenuItem onSelect={onVolume}><SlidersHorizontal className="size-4" />Track volume</DropdownMenuItem>
        <DropdownMenuItem onSelect={onAdd}><ListPlus className="size-4" />Add to playlist</DropdownMenuItem>
        <DropdownMenuItem onSelect={onExport}><Download className="size-4" />Export</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete}><Trash2 className="size-4" />Move to Trash</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EmptyLibrary({ filtered, onFiles, onFolder }: { filtered: boolean; onFiles: () => void; onFolder: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <Music className="mb-3 size-10 text-primary" />
      <h3 className="serif text-3xl">{filtered ? "Nothing matches that name" : "The library is empty"}</h3>
      <p className="mt-2 max-w-sm text-base text-muted-foreground">
        {filtered ? "Try another title, artist, or album." : "Import several files at once, or point at a whole folder."}
      </p>
      {filtered ? null : (
        <div className="mt-4 flex gap-2">
          <Button onClick={onFiles}>Import files</Button>
          <Button variant="outline" onClick={onFolder}>Choose a folder</Button>
        </div>
      )}
    </div>
  )
}

function showError(error: unknown) {
  useLibrary.setState({ error: message(error) })
}
