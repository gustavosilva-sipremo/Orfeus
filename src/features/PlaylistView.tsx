import { open, save } from "@tauri-apps/plugin-dialog"
import { ArrowDown, ArrowUp, Package, Play, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Cover } from "@/components/Cover"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { TrackBrowse } from "@/features/TrackBrowse"
import * as api from "@/lib/api"
import { artistLabel, formatDuration, loopLabel, nextLoop, sourceLabel, tally } from "@/lib/format"
import type { Track } from "@/lib/types"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"
import { usePlayer } from "@/stores/player"

export function PlaylistView({ id }: { id: string }) {
  const playlist = useLibrary((state) => state.playlists.find((item) => item.id === id))
  const tracks = useLibrary((state) => state.tracks)
  const savePlaylist = useLibrary((state) => state.savePlaylist)
  const deletePlaylist = useLibrary((state) => state.deletePlaylist)
  const removeFromPlaylist = useLibrary((state) => state.removeFromPlaylist)
  const movePlaylistTrack = useLibrary((state) => state.movePlaylistTrack)
  const addToPlaylist = useLibrary((state) => state.addToPlaylist)
  const exportPackage = useLibrary((state) => state.exportPackage)
  const playTracks = usePlayer((state) => state.playTracks)
  const currentId = usePlayer((state) => state.trackId)
  const [name, setName] = useState(playlist?.name ?? "")
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    setName(playlist?.name ?? "")
  }, [playlist?.id, playlist?.name])
  const [picked, setPicked] = useState<string[]>([])

  const ordered = useMemo(() => {
    if (!playlist) return []
    return playlist.trackIds
      .map((trackId) => tracks.find((track) => track.id === trackId))
      .filter((track): track is Track => track != null)
  }, [playlist, tracks])

  if (!playlist) {
    return <p className="p-6 text-muted-foreground">That playlist is no longer here.</p>
  }

  const shownName = name
  const current = playlist

  async function changeCover() {
    if (!api.desktop()) {
      useLibrary.setState({ notice: "The playlist cover is chosen in the desktop app." })
      return
    }
    const pickedCover = await open({
      title: "Playlist cover",
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"] }],
    })
    if (typeof pickedCover !== "string") return
    await savePlaylist({ id: current.id, coverSource: pickedCover })
  }

  async function exportPack() {
    if (!api.desktop()) {
      useLibrary.setState({ notice: "Package export opens in the desktop app." })
      return
    }
    const dest = await save({
      title: "Export package",
      defaultPath: `${current.name}.orfeus`,
      filters: [{ name: "Orfeus package", extensions: ["orfeus"] }],
    })
    if (!dest) return
    await exportPackage(current.id, dest)
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-end gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5">
        <button type="button" onClick={() => void changeCover().catch(showError)} className="shrink-0">
          <Cover path={playlist.coverPath} className="size-28 rounded-xl" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs tracking-[0.22em] text-gold uppercase">Playlist</p>
          <Input
            value={shownName}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const next = shownName.trim()
              if (next && next !== playlist.name) void savePlaylist({ id: playlist.id, name: next }).catch(showError)
            }}
            className="serif mt-1 h-auto border-transparent bg-transparent px-0 text-4xl focus-visible:ring-0"
          />
          <p className="text-base text-muted-foreground">{ordered.length} tracks · {tally(ordered)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void playTracks(ordered, 0, playlist.loopMode, playlist.id)} disabled={!ordered.length}>
            <Play className="size-5" />
            Play
          </Button>
          <Button variant="outline" onClick={() => void savePlaylist({ id: playlist.id, loopMode: nextLoop(playlist.loopMode) }).catch(showError)}>
            {loopLabel(playlist.loopMode)}
          </Button>
          <Button variant="outline" onClick={() => setAdding(true)}>Add</Button>
          <Button variant="outline" onClick={() => void exportPack().catch(showError)}>
            <Package className="size-5" />
            Package
          </Button>
          <Button variant="ghost" onClick={() => void deletePlaylist(playlist.id).catch(showError)} aria-label="Delete playlist">
            <Trash2 className="size-5" />
          </Button>
        </div>
      </header>
      <TrackBrowse
        tracks={ordered}
        currentId={currentId}
        manualSort
        onOpen={(visible, index) => void playTracks(visible, index, playlist.loopMode, playlist.id)}
        empty={
          <div>
            <h3 className="serif text-3xl">This playlist has no tracks yet</h3>
            <Button className="mt-4" onClick={() => setAdding(true)}>Add from the library</Button>
          </div>
        }
        actions={(track) => (
          <Button variant="ghost" size="icon" aria-label="Remove from playlist" onClick={() => void removeFromPlaylist(playlist.id, track.id)}>
            <Trash2 className="size-5" />
          </Button>
        )}
        reorder={(track) => (
          <>
            <Button variant="ghost" size="icon" aria-label="Move up" onClick={() => void movePlaylistTrack(playlist.id, track.id, -1)}>
              <ArrowUp className="size-5" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Move down" onClick={() => void movePlaylistTrack(playlist.id, track.id, 1)}>
              <ArrowDown className="size-5" />
            </Button>
          </>
        )}
      />
      <Dialog open={adding} onOpenChange={(open) => { setAdding(open); if (!open) setPicked([]) }}>
        <DialogContent className="flex h-[min(40rem,calc(100%-2rem))] w-[min(64rem,calc(100%-2rem))] flex-col">
          <DialogHeader>
            <DialogTitle>Add tracks</DialogTitle>
          </DialogHeader>
          <TrackPicker
            tracks={tracks}
            memberIds={playlist.trackIds}
            picked={picked}
            onPicked={setPicked}
            onAdd={() => {
              const ids = picked.filter((id) => !playlist.trackIds.includes(id))
              if (!ids.length) return
              void addToPlaylist(playlist.id, ids)
                .then(() => {
                  setPicked([])
                  setAdding(false)
                })
                .catch(showError)
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  )
}

function TrackPicker({
  tracks,
  memberIds,
  picked,
  onPicked,
  onAdd,
}: {
  tracks: Track[]
  memberIds: string[]
  picked: string[]
  onPicked: (ids: string[]) => void
  onAdd: () => void
}) {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const visible = tracks.filter((track) => !needle || `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(needle))
  const selectable = visible.filter((track) => !memberIds.includes(track.id))
  const allSelected = selectable.length > 0 && selectable.every((track) => picked.includes(track.id))

  function toggle(id: string) {
    if (memberIds.includes(id)) return
    onPicked(picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id])
  }

  function toggleVisible() {
    if (allSelected) onPicked(picked.filter((id) => !selectable.some((track) => track.id === id)))
    else onPicked([...new Set([...picked, ...selectable.map((track) => track.id)])])
  }

  return (
    <>
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, artist, or album" aria-label="Filter tracks" />
      <div className="min-h-0 flex-1 overflow-auto">
        {visible.length === 0 ? (
          <p className="px-2 py-6 text-sm text-muted-foreground">{tracks.length === 0 ? "The library is empty." : "No tracks match that search."}</p>
        ) : (
          <table className="w-full border-separate border-spacing-y-1 text-left">
            <thead className="sticky top-0 z-10 bg-black/80 text-xs tracking-[0.14em] text-muted-foreground uppercase">
              <tr>
                <th className="w-10 px-2 py-2">
                  <input type="checkbox" className="size-5 cursor-pointer" checked={allSelected} onChange={toggleVisible} aria-label="Select visible tracks" disabled={!selectable.length} />
                </th>
                <th className="px-2 py-2 font-medium">Cover</th>
                <th className="px-2 py-2 font-medium">Title</th>
                <th className="px-2 py-2 font-medium">Artist</th>
                <th className="px-2 py-2 font-medium">Album</th>
                <th className="px-2 py-2 font-medium">Source</th>
                <th className="px-2 py-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((track) => {
                const member = memberIds.includes(track.id)
                const selected = member || picked.includes(track.id)
                return (
                  <tr key={track.id} className={member ? "text-muted-foreground" : "cursor-pointer hover:bg-white/10"} onClick={() => toggle(track.id)}>
                    <td className="rounded-l-lg px-2 py-1.5">
                      <input
                        type="checkbox"
                        className="size-5 cursor-pointer disabled:cursor-not-allowed"
                        checked={selected}
                        disabled={member}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggle(track.id)}
                        aria-label={member ? `${track.title} is already in the playlist` : `Select ${track.title}`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Cover path={track.coverPath} className="size-10 rounded" />
                    </td>
                    <td className="max-w-56 px-2 py-1.5">
                      <span className="block truncate text-base text-foreground">{track.title}</span>
                      {member ? <span className="text-xs tracking-[0.14em] uppercase">In playlist</span> : null}
                      {track.missing ? <span className="text-xs text-pigment">Missing file</span> : null}
                    </td>
                    <td className="max-w-40 truncate px-2 py-1.5 text-sm">{artistLabel(track.artist)}</td>
                    <td className="max-w-40 truncate px-2 py-1.5 text-sm">{track.album || "—"}</td>
                    <td className="max-w-48 truncate px-2 py-1.5 text-sm" title={track.path}>{sourceLabel(track)}</td>
                    <td className="rounded-r-lg px-2 py-1.5 text-sm tabular-nums">{formatDuration(track.durationMs)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <Button disabled={!picked.length} onClick={onAdd}>
        Add {picked.length ? `${picked.length} ` : ""}{picked.length === 1 ? "track" : "tracks"}
      </Button>
    </>
  )
}

function showError(error: unknown) {
  useLibrary.setState({ error: message(error) })
}
