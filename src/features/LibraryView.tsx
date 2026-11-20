import { Download, FolderSync, ListPlus, MoreHorizontal, Music, Pencil, SlidersHorizontal, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Slider } from "@/components/ui/slider"
import { LibraryMenu, requestExport, requestFileImport, requestFolderImport } from "@/features/LibraryMenu"
import { TrackBrowse } from "@/features/TrackBrowse"
import * as api from "@/lib/api"
import { useExportDir } from "@/lib/export-dir"
import type { Track, WatchedFolder } from "@/lib/types"
import { tally } from "@/lib/format"
import { useSectionReady } from "@/lib/section"
import { setSelection, useSelection } from "@/lib/selection"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"
import { usePlayer } from "@/stores/player"

export function LibraryView() {
  const allTracks = useLibrary((state) => state.tracks)
  const shelves = useLibrary((state) => state.shelves)
  const view = useLibrary((state) => state.view)
  const shelfId = view.kind === "library" ? view.id : ""
  const tracks = useMemo(() => (shelfId ? allTracks.filter((track) => track.shelfId === shelfId) : allTracks), [allTracks, shelfId])
  const shelfName = shelves.find((shelf) => shelf.id === shelfId)?.name ?? "Library"
  const ready = useLibrary((state) => state.ready)
  useSectionReady(ready)
  const playlists = useLibrary((state) => state.playlists)
  const deleteTrack = useLibrary((state) => state.deleteTrack)
  const addToPlaylist = useLibrary((state) => state.addToPlaylist)
  const setEditingId = useLibrary((state) => state.setEditingId)
  const playTracks = usePlayer((state) => state.playTracks)
  const currentId = usePlayer((state) => state.trackId)
  const selected = useSelection()
  const exportDir = useExportDir()
  const [addId, setAddId] = useState<string | null>(null)
  const [watched, setWatched] = useState<WatchedFolder[]>([])
  const [volumeTrack, setVolumeTrack] = useState<Track | null>(null)
  useEffect(() => {
    setSelection([])
  }, [shelfId])

  useEffect(() => {
    if (!api.desktop()) return
    void api.listWatched().then(setWatched).catch(() => undefined)
  }, [ready, tracks.length])

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

  function playVisible(visible: Track[], index: number) {
    if (!visible[index]) return
    void playTracks(visible, index, "off", null)
  }

  function toggle(id: string) {
    setSelection(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6 sm:py-4">
        <div className="mr-auto min-w-0">
          <h2 className="serif truncate text-2xl sm:text-3xl">{shelfName}</h2>
          <p className="text-base text-muted-foreground">{ready ? `${tracks.length} tracks · ${tally(tracks)}` : "Opening the library…"}</p>
        </div>
        <LibraryMenu />
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
      {!ready ? null : tracks.length === 0 ? (
        <EmptyLibrary filtered={false} onFiles={() => requestFileImport()} onFolder={() => requestFolderImport()} />
      ) : (
        <TrackBrowse
          tracks={tracks}
          currentId={currentId}
          onOpen={playVisible}
          selectedIds={selected}
          onSelectVisible={(ids, on) => setSelection(on ? [...new Set([...selected, ...ids])] : selected.filter((id) => !ids.includes(id)))}
          contextActions={(track) => [
            { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setEditingId(track.id) },
            { label: "Track volume", icon: <SlidersHorizontal className="size-4" />, onSelect: () => setVolumeTrack(track) },
            { label: "Add to playlist", icon: <ListPlus className="size-4" />, onSelect: () => setAddId(track.id) },
            { label: "Export", icon: <Download className="size-4" />, onSelect: () => requestExport([track.id]) },
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
              <TrackMenu track={track} onEdit={() => setEditingId(track.id)} onAdd={() => setAddId(track.id)} onVolume={() => setVolumeTrack(track)} onExport={() => requestExport([track.id])} onDelete={() => void deleteTrack(track.id).catch(showError)} />
            </>
          )}
          empty={<EmptyLibrary filtered onFiles={() => requestFileImport()} onFolder={() => requestFolderImport()} />}
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
