import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { lazy, Suspense, useEffect, useState } from "react"
import { CubeLoader } from "@/components/kit/CubeLoader"
import { PlayerBar } from "@/components/PlayerBar"
import { Stage } from "@/components/Stage"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LibraryView } from "@/features/LibraryView"
import { PlaylistView } from "@/features/PlaylistView"
import { TrashView } from "@/features/TrashView"
import { isImagePath, offerCoverDrop } from "@/lib/covers"
import { Sidebar } from "@/features/Sidebar"
import * as api from "@/lib/api"
import { message as errorText } from "@/lib/utils"
import { useLibrary } from "@/stores/library"
import { usePlayer } from "@/stores/player"

const CoverGallery = lazy(() => import("@/features/CoverGallery").then((mod) => ({ default: mod.CoverGallery })))
const StatusView = lazy(() => import("@/features/StatusView").then((mod) => ({ default: mod.StatusView })))
const EditorSheet = lazy(() => import("@/features/EditorSheet").then((mod) => ({ default: mod.EditorSheet })))

export function App() {
  const initLibrary = useLibrary((state) => state.init)
  const initPlayer = usePlayer((state) => state.init)
  const view = useLibrary((state) => state.view)
  const notice = useLibrary((state) => state.notice)
  const error = useLibrary((state) => state.error)
  const busy = useLibrary((state) => state.busy)
  const exportProgress = useLibrary((state) => state.exportProgress)
  const lastExportDir = useLibrary((state) => state.lastExportDir)
  const dismiss = useLibrary((state) => state.dismiss)
  const playerError = usePlayer((state) => state.error)
  const libraryReady = useLibrary((state) => state.ready)
  const playerReady = usePlayer((state) => state.ready)
  const [dropping, setDropping] = useState(false)
  const [nav, setNav] = useState(false)

  useEffect(() => {
    void initLibrary()
    void initPlayer()
  }, [initLibrary, initPlayer])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || target?.isContentEditable) return
      const player = usePlayer.getState()
      if (event.code === "Space" || event.code === "MediaPlayPause") {
        event.preventDefault()
        void player.toggle()
        return
      }
      if (event.altKey && (event.key === "ArrowLeft" || event.code === "MediaTrackPrevious")) {
        event.preventDefault()
        void player.previous()
        return
      }
      if (event.altKey && (event.key === "ArrowRight" || event.code === "MediaTrackNext")) {
        event.preventDefault()
        void player.next()
        return
      }
      if (event.code === "MediaTrackPrevious") {
        event.preventDefault()
        void player.previous()
        return
      }
      if (event.code === "MediaTrackNext") {
        event.preventDefault()
        void player.next()
        return
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        void player.seek(Math.max(0, player.position - 5))
      }
      if (event.key === "ArrowRight") {
        event.preventDefault()
        void player.seek(player.position + 5)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (!api.desktop()) return
    let unlisten: (() => void) | undefined
    let disposed = false
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") setDropping(true)
        if (event.payload.type === "leave") setDropping(false)
        if (event.payload.type === "drop") {
          setDropping(false)
          const images = event.payload.paths.filter((path) => isImagePath(path))
          const audio = event.payload.paths.filter((path) => !isImagePath(path))
          if (images[0] && !offerCoverDrop(images[0]) && audio.length === 0) {
            useLibrary.setState({ notice: "Open a track or a playlist to use that image as a cover." })
          }
          if (audio.length) void useLibrary.getState().importPaths(audio)
        }
      })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    if (!api.desktop()) return
    let unlisten: (() => void) | undefined
    let disposed = false
    void listen<{ done: number; total: number }>("library://progress", (event) => {
      const { done, total } = event.payload
      useLibrary.getState().setBusy(total > 0 && done < total ? `Importing ${done} of ${total}` : null)
    })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    if (!api.desktop()) return
    let unlistenExport: (() => void) | undefined
    let unlistenRefresh: (() => void) | undefined
    let disposed = false
    void listen<{ done: number; total: number; current: string }>("export://progress", (event) => {
      const { done, total, current } = event.payload
      useLibrary.getState().setExportProgress(total > 0 && done < total ? { done, total, current } : null)
    })
      .then((stop) => {
        if (disposed) stop()
        else unlistenExport = stop
      })
      .catch(() => undefined)
    void listen<number>("library://refresh", (event) => {
      void useLibrary.getState().refresh()
      if (event.payload > 0) {
        useLibrary.setState({ notice: event.payload === 1 ? "1 new track showed up in a watched folder." : `${event.payload} new tracks showed up in a watched folder.` })
      }
    })
      .then((stop) => {
        if (disposed) stop()
        else unlistenRefresh = stop
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      unlistenExport?.()
      unlistenRefresh?.()
    }
  }, [])

  const message = error || playerError || notice
  const fraction = exportProgress && exportProgress.total > 0 ? Math.min(100, (exportProgress.done / exportProgress.total) * 100) : 0

  if (!libraryReady || !playerReady) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-black text-foreground">
        <CubeLoader size={72} label="Opening the library" />
        <p className="text-base text-muted-foreground">Opening the library</p>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="relative z-0 flex h-screen flex-col overflow-hidden text-foreground">
        <div className="pointer-events-none fixed inset-0 -z-10">
          <img src="/images/Orpheus_and_Eurydice_by_Peter_Paul_Rubens.jpg" alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-linear-to-b from-black/30 via-black/45 to-black/75" />
        </div>
        <div className="flex min-h-0 flex-1">
          {nav ? <button type="button" className="fixed inset-0 z-20 bg-black/55 md:hidden" aria-label="Close menu" onClick={() => setNav(false)} /> : null}
          <div className={nav ? "fixed inset-y-0 left-0 z-30 flex md:static" : "hidden md:flex"}>
            <Sidebar onNavigate={() => setNav(false)} />
          </div>
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-3 border-b border-white/10 px-3 py-2 md:hidden">
              <button type="button" className="cursor-pointer rounded-md border border-[#3a3a3a] bg-[#1c1c1c] px-3 py-1.5 text-sm text-white" onClick={() => setNav(true)}>
                Menu
              </button>
              <span className="serif text-xl italic">Orfeus</span>
            </div>
            <div className="min-h-0 flex-1">
              <Suspense fallback={null}>
                {view.kind === "library" ? <LibraryView /> : view.kind === "trash" ? <TrashView /> : view.kind === "covers" ? <CoverGallery /> : view.kind === "status" ? <StatusView /> : <PlaylistView id={view.id} />}
              </Suspense>
            </div>
          </main>
        </div>
        {exportProgress ? (
          <div className="border-t border-white/10 px-4 py-3">
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-white/15">
              <div className="h-full bg-white transition-all" style={{ width: `${fraction}%` }} />
            </div>
            <p className="text-sm text-foreground">
              Exporting {exportProgress.done} of {exportProgress.total}
              {exportProgress.current ? ` · ${exportProgress.current}` : ""}
            </p>
          </div>
        ) : null}
        {message ? (
          <div className="flex items-center gap-3 border-t border-white/10 px-4 py-2">
            <button type="button" className="min-w-0 flex-1 cursor-pointer text-left text-sm text-gold" onClick={dismiss}>
              {busy ? `${busy} · ` : ""}
              {message}
            </button>
            {lastExportDir && !error ? (
              <button type="button" className="cursor-pointer text-sm text-white underline" onClick={() => void api.revealPath(lastExportDir).catch((reason: unknown) => useLibrary.setState({ error: errorText(reason) }))}>
                Open folder
              </button>
            ) : null}
          </div>
        ) : busy ? (
          <p className="flex items-center gap-3 border-t border-white/10 px-4 py-2 text-sm text-muted-foreground">
            <CubeLoader size={22} label={busy} />
            {busy}
          </p>
        ) : null}
        <PlayerBar />
        <Stage />
        <Suspense fallback={null}>
          <EditorSheet />
        </Suspense>
        {dropping ? (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/55">
            <p className="serif text-3xl">Drop the music</p>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  )
}
