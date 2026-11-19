import { open } from "@tauri-apps/plugin-dialog"
import { Disc, Download, FolderOpen, Keyboard, Menu, Upload, Youtube } from "lucide-react"
import { lazy, memo, Suspense, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { BurnDialog } from "@/features/BurnDialog"
import { ExtractDialog } from "@/features/ExtractDialog"
import { ReadDiscDialog } from "@/features/ReadDiscDialog"
import * as api from "@/lib/api"
import { readExportDir, writeExportDir, useExportDir } from "@/lib/export-dir"
import { useSelection } from "@/lib/selection"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"

const YouTubeDialog = lazy(() => import("@/features/YouTubeDialog").then((mod) => ({ default: mod.YouTubeDialog })))

const audioFilter = [{ name: "Audio", extensions: ["mp3", "flac", "ogg", "opus", "wav", "m4a", "aac", "mp4", "alac"] }]

let openFiles: () => void = () => {}
let openFolder: () => void = () => {}
let openExport: (ids: string[]) => void = () => {}

export function requestFileImport() {
  openFiles()
}

export function requestFolderImport() {
  openFolder()
}

export function requestExport(ids: string[]) {
  openExport(ids)
}

function showError(error: unknown) {
  useLibrary.setState({ error: message(error) })
}

export const LibraryMenu = memo(function LibraryMenu() {
  const selected = useSelection()
  const exportDir = useExportDir()
  const importPaths = useLibrary((state) => state.importPaths)
  const exportTracks = useLibrary((state) => state.exportTracks)
  const [folderOpen, setFolderOpen] = useState(false)
  const [recursive, setRecursive] = useState(true)
  const [watch, setWatch] = useState(true)
  const [youtubeOpen, setYoutubeOpen] = useState(false)
  const [burnOpen, setBurnOpen] = useState(false)
  const [readOpen, setReadOpen] = useState(false)
  const [extractIds, setExtractIds] = useState<string[]>([])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  openFiles = () => {
    void chooseFiles()
  }
  openFolder = () => {
    void chooseFolder()
  }
  openExport = (ids) => {
    if (ids.length) setExtractIds(ids)
  }

  useEffect(() => () => {
    openFiles = () => {}
    openFolder = () => {}
    openExport = () => {}
  }, [])

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
  }

  async function chooseExportDir() {
    if (!api.desktop()) {
      useLibrary.setState({ notice: "The export folder is chosen in the desktop app." })
      return
    }
    const picked = await open({ directory: true, title: "Where to save exports" })
    if (typeof picked === "string") writeExportDir(picked)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="shrink-0 border-white/10 bg-black/35 backdrop-blur-md hover:bg-black/55" aria-label="Menu">
            <Menu className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top">
          <DropdownMenuItem onSelect={() => setYoutubeOpen(true)}>
            <Youtube className="size-4" />
            YouTube
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void chooseFiles().catch(showError)}>
            <Upload className="size-4" />
            Import audio files
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void chooseFolder().catch(showError)}>
            <FolderOpen className="size-4" />
            Import a music folder
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void chooseExportDir().catch(showError)}>
            <FolderOpen className="size-4" />
            {exportDir || readExportDir() ? "Change export folder" : "Choose export folder"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!selected.length} onSelect={() => setExtractIds(selected)}>
            <Download className="size-4" />
            Export
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setReadOpen(true)}>
            <Disc className="size-4" />
            Read CD or DVD
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!selected.length} onSelect={() => setBurnOpen(true)}>
            <Disc className="size-4" />
            Burn CD or DVD
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
            <Keyboard className="size-4" />
            Shortcuts
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <BurnDialog open={burnOpen} trackIds={selected} onOpenChange={setBurnOpen} />
      <ReadDiscDialog open={readOpen} onOpenChange={setReadOpen} />
      <ExtractDialog
        open={extractIds.length > 0}
        title="Export tracks"
        hint="The tracks are saved as one zip, named 01. Track name, in the folder you choose."
        onOpenChange={(next) => {
          if (!next) setExtractIds([])
        }}
        onStart={(dir) => exportTracks(extractIds, dir)}
      />
      {youtubeOpen ? (
        <Suspense fallback={null}>
          <YouTubeDialog open={youtubeOpen} onOpenChange={setYoutubeOpen} />
        </Suspense>
      ) : null}
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
    </>
  )
})
