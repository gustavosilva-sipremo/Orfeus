import { create } from "zustand"
import * as api from "@/lib/api"
import { previewPlaylists, previewSearch, previewShelves, previewTracks } from "@/lib/preview"
import type { LoopMode, Playlist, SearchReport, Shelf, Track } from "@/lib/types"
import { message } from "@/lib/utils"
import { usePlayer } from "@/stores/player"

type View = { kind: "library"; id: string } | { kind: "playlist"; id: string } | { kind: "trash" }

function libraryView(shelves: Shelf[], current?: View): View {
  if (current?.kind === "playlist" || current?.kind === "trash") return current
  if (current?.kind === "library" && shelves.some((shelf) => shelf.id === current.id)) return current
  return { kind: "library", id: shelves[0]?.id ?? "" }
}

type LibraryState = {
  tracks: Track[]
  trash: Track[]
  shelves: Shelf[]
  playlists: Playlist[]
  ready: boolean
  busy: string | null
  notice: string | null
  error: string | null
  exportProgress: { done: number; total: number; current: string } | null
  lastExportDir: string | null
  editingId: string | null
  view: View
  init: () => Promise<void>
  refresh: () => Promise<void>
  setView: (view: View) => void
  setEditingId: (id: string | null) => void
  dismiss: () => void
  setBusy: (busy: string | null) => void
  setExportProgress: (progress: { done: number; total: number; current: string } | null) => void
  importPaths: (paths: string[], recursive?: boolean, watch?: boolean) => Promise<void>
  updateTrack: (input: Parameters<typeof api.updateTrack>[0]) => Promise<void>
  deleteTrack: (id: string) => Promise<void>
  restoreTrack: (id: string) => Promise<void>
  purgeTrack: (id: string) => Promise<void>
  reorderTracks: (ids: string[]) => Promise<void>
  createShelf: (name: string) => Promise<void>
  setShelfKind: (id: string, kind: Shelf["kind"]) => Promise<void>
  removeShelf: (id: string) => Promise<void>
  createPlaylist: (name: string) => Promise<void>
  savePlaylist: (input: Parameters<typeof api.savePlaylist>[0]) => Promise<void>
  deletePlaylist: (id: string) => Promise<void>
  addToPlaylist: (playlistId: string, trackIds: string[]) => Promise<void>
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>
  movePlaylistTrack: (playlistId: string, trackId: string, direction: number) => Promise<void>
  exportTracks: (trackIds: string[], destDir: string) => Promise<void>
  exportPackage: (playlistId: string, destPath: string) => Promise<void>
  importPackage: (path: string) => Promise<void>
  searchMetadata: (title: string, artist: string) => Promise<SearchReport>
  fetchCover: (url: string) => Promise<string | null>
}

function replacePlaylist(playlists: Playlist[], playlist: Playlist) {
  const exists = playlists.some((item) => item.id === playlist.id)
  if (!exists) return [playlist, ...playlists]
  return playlists.map((item) => (item.id === playlist.id ? playlist : item))
}

export const useLibrary = create<LibraryState>((set, get) => ({
  tracks: [],
  trash: [],
  shelves: [],
  playlists: [],
  ready: false,
  busy: null,
  notice: null,
  error: null,
  exportProgress: null,
  lastExportDir: null,
  editingId: null,
  view: { kind: "library", id: "preview-shelf" },
  init: async () => {
    if (!api.desktop()) {
      set({
        tracks: previewTracks,
        shelves: previewShelves,
        playlists: previewPlaylists,
        view: { kind: "library", id: previewShelves[0].id },
        ready: true,
        notice: "Interface preview. Audio and files open in the desktop app.",
      })
      return
    }
    await get().refresh()
  },
  refresh: async () => {
    if (!api.desktop()) return
    try {
      const [tracks, playlists, shelves, trash] = await Promise.all([api.listTracks(), api.listPlaylists(), api.listShelves(), api.listTrash()])
      set({ tracks, playlists, shelves, trash, view: libraryView(shelves, get().view), ready: true, error: null })
    } catch (error) {
      set({ ready: true, error: message(error) })
    }
  },
  setView: (view) => set({ view }),
  setEditingId: (editingId) => set({ editingId }),
  dismiss: () => set({ notice: null, error: null }),
  setBusy: (busy) => set({ busy }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
  importPaths: async (paths, recursive = true, watch = false) => {
    if (!api.desktop()) {
      set({ notice: "File import opens in the desktop app." })
      return
    }
    set({ busy: "Importing…", error: null })
    try {
      const view = get().view
      const shelfId = view.kind === "library" ? view.id : get().shelves[0]?.id
      const report = await api.importPaths(paths, recursive, watch, shelfId)
      await get().refresh()
      set({
        notice:
          report.imported === 0
            ? "No new tracks. The ones already in the library were kept."
            : `${report.imported} imported${report.skipped ? `, ${report.skipped} already in the library` : ""}${watch ? ". The folder stays watched." : "."}`,
      })
    } catch (error) {
      set({ error: message(error) })
    } finally {
      set({ busy: null })
    }
  },
  updateTrack: async (input) => {
    if (!api.desktop()) {
      set({
        tracks: get().tracks.map((track) =>
          track.id === input.id
            ? {
                ...track,
                title: input.title,
                artist: input.artist,
                album: input.album,
                lyrics: input.lyrics,
                syncedLyrics: input.syncedLyrics ?? track.syncedLyrics,
                gain: input.gain ?? track.gain,
                coverPath: input.clearCover ? null : (input.coverSource ?? track.coverPath),
              }
            : track,
        ),
        notice: "Edit saved in this preview.",
      })
      usePlayer.getState().syncTrack(input.id)
      return
    }
    const track = await api.updateTrack(input)
    set({ tracks: get().tracks.map((item) => (item.id === track.id ? track : item)) })
    usePlayer.getState().syncTrack(track.id)
    if (usePlayer.getState().trackId === track.id) void api.setTrackGain(track.gain)
  },
  deleteTrack: async (id) => {
    if (!api.desktop()) {
      const track = get().tracks.find((item) => item.id === id)
      set({
        tracks: get().tracks.filter((item) => item.id !== id),
        trash: track ? [track, ...get().trash.filter((item) => item.id !== id)] : get().trash,
        notice: "Moved to Trash.",
      })
      return
    }
    await api.deleteTrack(id)
    await get().refresh()
    set({ notice: "Moved to Trash." })
  },
  restoreTrack: async (id) => {
    if (!api.desktop()) {
      const track = get().trash.find((item) => item.id === id)
      set({
        trash: get().trash.filter((item) => item.id !== id),
        tracks: track ? [track, ...get().tracks.filter((item) => item.id !== id)] : get().tracks,
        notice: "Restored to the library.",
      })
      return
    }
    await api.restoreTrack(id)
    await get().refresh()
    set({ notice: "Restored to the library." })
  },
  purgeTrack: async (id) => {
    if (!api.desktop()) {
      set({ trash: get().trash.filter((item) => item.id !== id) })
      return
    }
    await api.purgeTrack(id)
    if (usePlayer.getState().trackId === id) await api.stop().catch(() => undefined)
    await get().refresh()
  },
  reorderTracks: async (ids) => {
    const current = get().tracks
    const byId = new Map(current.map((track) => [track.id, track]))
    const next = ids.flatMap((id) => {
      const track = byId.get(id)
      return track ? [track] : []
    })
    for (const track of current) if (!ids.includes(track.id)) next.push(track)
    set({ tracks: next })
    if (!api.desktop()) return
    try {
      await api.reorderTracks(ids)
    } catch (error) {
      set({ tracks: current, error: message(error) })
    }
  },
  createShelf: async (name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (!api.desktop()) {
      const shelf: Shelf = { id: `preview-${Date.now()}`, name: trimmed, kind: "music" }
      set({ shelves: [...get().shelves, shelf], view: { kind: "library", id: shelf.id } })
      return
    }
    const shelf = await api.createShelf(trimmed, "music")
    set({ shelves: [...get().shelves, shelf], view: { kind: "library", id: shelf.id }, error: null })
  },
  setShelfKind: async (id, kind) => {
    if (!api.desktop()) {
      set({ shelves: get().shelves.map((shelf) => (shelf.id === id ? { ...shelf, kind } : shelf)) })
      return
    }
    const shelf = await api.updateShelf(id, kind)
    set({ shelves: get().shelves.map((item) => (item.id === shelf.id ? shelf : item)) })
  },
  removeShelf: async (id) => {
    if (get().shelves.length <= 1) {
      set({ error: "Keep at least one library." })
      return
    }
    if (!api.desktop()) {
      const shelves = get().shelves.filter((shelf) => shelf.id !== id)
      set({ shelves, view: libraryView(shelves, get().view) })
      return
    }
    await api.deleteShelf(id)
    await get().refresh()
  },
  createPlaylist: async (name) => {
    if (!api.desktop()) {
      const playlist: Playlist = {
        id: `preview-${Date.now()}`,
        name,
        coverPath: null,
        loopMode: "off",
        createdAt: Date.now(),
        trackIds: [],
      }
      set({ playlists: [playlist, ...get().playlists], view: { kind: "playlist", id: playlist.id } })
      return
    }
    const playlist = await api.createPlaylist(name)
    set({
      playlists: [playlist, ...get().playlists],
      view: { kind: "playlist", id: playlist.id },
    })
  },
  savePlaylist: async (input) => {
    if (!api.desktop()) {
      set({
        playlists: get().playlists.map((playlist) => {
          if (playlist.id !== input.id) return playlist
          return {
            ...playlist,
            name: input.name ?? playlist.name,
            loopMode: input.loopMode ?? playlist.loopMode,
            coverPath: input.clearCover ? null : playlist.coverPath,
            trackIds: input.trackIds ?? playlist.trackIds,
          }
        }),
      })
      return
    }
    const playlist = await api.savePlaylist(input)
    set({ playlists: replacePlaylist(get().playlists, playlist) })
  },
  deletePlaylist: async (id) => {
    if (!api.desktop()) {
      set({
        playlists: get().playlists.filter((playlist) => playlist.id !== id),
        view: libraryView(get().shelves),
      })
      return
    }
    await api.deletePlaylist(id)
    set({ view: libraryView(get().shelves) })
    await get().refresh()
  },
  addToPlaylist: async (playlistId, trackIds) => {
    if (!api.desktop()) {
      set({
        playlists: get().playlists.map((playlist) => {
          if (playlist.id !== playlistId) return playlist
          const next = [...playlist.trackIds]
          for (const id of trackIds) if (!next.includes(id)) next.push(id)
          return { ...playlist, trackIds: next }
        }),
        notice: "Tracks added to the playlist.",
      })
      return
    }
    const playlist = await api.addToPlaylist(playlistId, trackIds)
    set({ playlists: replacePlaylist(get().playlists, playlist), notice: "Tracks added to the playlist." })
  },
  removeFromPlaylist: async (playlistId, trackId) => {
    if (!api.desktop()) {
      set({
        playlists: get().playlists.map((playlist) =>
          playlist.id === playlistId
            ? { ...playlist, trackIds: playlist.trackIds.filter((id) => id !== trackId) }
            : playlist,
        ),
      })
      return
    }
    const playlist = await api.removeFromPlaylist(playlistId, trackId)
    set({ playlists: replacePlaylist(get().playlists, playlist) })
  },
  movePlaylistTrack: async (playlistId, trackId, direction) => {
    if (!api.desktop()) {
      set({
        playlists: get().playlists.map((playlist) => {
          if (playlist.id !== playlistId) return playlist
          const ids = [...playlist.trackIds]
          const index = ids.indexOf(trackId)
          const target = index + direction
          if (index < 0 || target < 0 || target >= ids.length) return playlist
          const [item] = ids.splice(index, 1)
          if (item) ids.splice(target, 0, item)
          return { ...playlist, trackIds: ids }
        }),
      })
      return
    }
    const playlist = await api.movePlaylistTrack(playlistId, trackId, direction)
    set({ playlists: replacePlaylist(get().playlists, playlist) })
  },
  exportTracks: async (trackIds, destDir) => {
    set({ busy: "Exporting…", error: null, exportProgress: { done: 0, total: trackIds.length, current: "" }, lastExportDir: destDir })
    try {
      const report = await api.exportTracks(trackIds, destDir)
      const extra = report.errors.length ? ` ${report.errors[0]}` : ""
      set({
        notice: `${report.exported} ${report.exported === 1 ? "track" : "tracks"} exported.${extra}`,
        lastExportDir: report.destDir || destDir,
      })
    } catch (error) {
      set({ error: message(error) })
    } finally {
      set({ busy: null, exportProgress: null })
    }
  },
  exportPackage: async (playlistId, destPath) => {
    set({ busy: "Packing…", error: null })
    try {
      await api.exportPackage(playlistId, destPath)
      set({ notice: "Orfeus package exported." })
    } catch (error) {
      set({ error: message(error) })
    } finally {
      set({ busy: null })
    }
  },
  importPackage: async (path) => {
    set({ busy: "Importing package…", error: null })
    try {
      await api.importPackage(path)
      await get().refresh()
      set({ notice: "Package imported." })
    } catch (error) {
      set({ error: message(error) })
    } finally {
      set({ busy: null })
    }
  },
  searchMetadata: async (title, artist) => {
    if (!api.desktop()) return previewSearch(title, artist)
    return api.searchMetadata(title, artist)
  },
  fetchCover: async (url) => {
    if (!api.desktop()) return null
    return api.fetchCover(url)
  },
}))

export type { LoopMode }
