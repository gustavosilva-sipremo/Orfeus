import { ChevronLeft, ChevronRight, Images, Trash2, X } from "lucide-react"
import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { CubeLoader } from "@/components/kit/CubeLoader"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import * as api from "@/lib/api"
import { loadCover, localCoverUrl } from "@/lib/media"
import type { SavedCover } from "@/lib/types"
import { cn, message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"

export function CoverGallery() {
  const refresh = useLibrary((state) => state.refresh)
  const [covers, setCovers] = useState<SavedCover[]>([])
  const [ready, setReady] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [pending, setPending] = useState<SavedCover | null>(null)
  const [removing, setRemoving] = useState(false)
  const [order, setOrder] = useState<"newest" | "oldest" | "used">("newest")
  const shown = useMemo(() => {
    const next = [...covers]
    if (order === "used") next.sort((left, right) => right.uses - left.uses || right.addedAt - left.addedAt)
    else next.sort((left, right) => (order === "newest" ? right.addedAt - left.addedAt : left.addedAt - right.addedAt))
    return next
  }, [covers, order])

  useEffect(() => {
    if (!api.desktop()) {
      setReady(true)
      return
    }
    let alive = true
    void api.listCovers().then(
      (next) => {
        if (!alive) return
        setCovers(next)
        setReady(true)
      },
      (error: unknown) => {
        if (!alive) return
        useLibrary.setState({ error: message(error) })
        setReady(true)
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const current = viewing == null ? null : shown[viewing]

  useEffect(() => {
    if (viewing == null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewing(null)
      if (event.key === "ArrowRight") setViewing((index) => (index == null ? index : (index + 1) % shown.length))
      if (event.key === "ArrowLeft") setViewing((index) => (index == null ? index : (index - 1 + shown.length) % shown.length))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [shown.length, viewing])

  async function removeCover() {
    if (!pending || removing) return
    setRemoving(true)
    try {
      await api.deleteCover(pending.path)
      const next = shown.filter((cover) => cover.path !== pending.path)
      setCovers(next)
      setViewing((index) => {
        if (index == null) return index
        if (next.length === 0) return null
        return Math.min(index, next.length - 1)
      })
      setPending(null)
      await refresh()
    } catch (error) {
      useLibrary.setState({ error: message(error) })
    } finally {
      setRemoving(false)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="serif text-2xl sm:text-3xl">Covers</h2>
            <p className="text-base text-muted-foreground">
              {ready ? (covers.length === 1 ? "1 saved image" : `${covers.length} saved images`) : "Opening the gallery…"}
            </p>
          </div>
          <select
            className="h-11 cursor-pointer rounded-md border border-white/10 bg-black px-3 text-base scheme-dark"
            value={order}
            aria-label="Sort covers"
            onChange={(event) => setOrder(event.target.value as "newest" | "oldest" | "used")}
          >
            <option value="newest">Newest added</option>
            <option value="oldest">Oldest added</option>
            <option value="used">Most used</option>
          </select>
        </div>
      </header>
      {!ready ? (
        <div className="flex flex-1 items-center justify-center">
          <CubeLoader label="Loading covers" />
        </div>
      ) : covers.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <Images className="mb-3 size-10 text-primary" />
          <h3 className="serif text-3xl">No covers yet</h3>
          <p className="mt-2 max-w-sm text-base text-muted-foreground">A cover shows up here after you save it on a track or a playlist.</p>
        </div>
      ) : (
        <ul className="grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] content-start gap-3 overflow-auto px-4 pb-6 sm:px-6">
          {shown.map((cover, index) => (
            <li key={cover.path} style={{ contentVisibility: "auto", containIntrinsicSize: "12rem" }}>
              <div className="relative">
                <button type="button" className="w-full cursor-pointer text-left" onClick={() => setViewing(index)}>
                  <LocalCover path={cover.path} className="aspect-square w-full rounded-xl" />
                  <span className="mt-2 block truncate text-sm">{cover.label}</span>
                  <span className="text-xs text-muted-foreground">{cover.uses === 1 ? "1 use" : `${cover.uses} uses`}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${cover.label}`}
                  className="absolute top-2 right-2 cursor-pointer rounded-md bg-black/70 p-1.5 text-white"
                  onClick={() => setPending(cover)}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {current && viewing != null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4" onClick={() => setViewing(null)}>
          <button type="button" className="absolute top-4 right-4 cursor-pointer rounded-md p-2 text-white" aria-label="Close" onClick={() => setViewing(null)}>
            <X className="size-6" />
          </button>
          {covers.length > 1 ? (
            <button
              type="button"
              className="absolute left-3 cursor-pointer rounded-full bg-black/50 p-3 text-white sm:left-6"
              aria-label="Previous cover"
              onClick={(event) => {
                event.stopPropagation()
                setViewing((index) => (index == null ? index : (index - 1 + covers.length) % covers.length))
              }}
            >
              <ChevronLeft className="size-6" />
            </button>
          ) : null}
          <figure key={current.path} className="cover-view flex max-h-full max-w-3xl flex-col items-center" onClick={(event) => event.stopPropagation()}>
            <div className="overflow-hidden rounded-2xl">
              <LocalCover path={current.path} className="cover-drift max-h-[72vh] w-auto max-w-[min(72vh,80vw)] object-contain" />
            </div>
            <figcaption className="mt-4 text-center">
              <p className="serif text-2xl">{current.label}</p>
              <p className="text-sm text-muted-foreground">{current.uses === 1 ? "Used once" : `Used ${current.uses} times`}</p>
              <Button variant="pigment" size="sm" className="mt-3" onClick={() => setPending(current)}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            </figcaption>
          </figure>
          {covers.length > 1 ? (
            <button
              type="button"
              className="absolute right-3 cursor-pointer rounded-full bg-black/50 p-3 text-white sm:right-6"
              aria-label="Next cover"
              onClick={(event) => {
                event.stopPropagation()
                setViewing((index) => (index == null ? index : (index + 1) % covers.length))
              }}
            >
              <ChevronRight className="size-6" />
            </button>
          ) : null}
        </div>
      ) : null}
      <Dialog open={pending != null} onOpenChange={(open) => !open && !removing && setPending(null)}>
        <DialogContent className="w-[min(28rem,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle>Delete this cover?</DialogTitle>
          </DialogHeader>
          {pending && pending.holders.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">This image is used by:</p>
              <ul className="max-h-52 space-y-2 overflow-auto pr-1">
                {pending.holders.map((holder) => (
                  <li key={`${holder.kind}-${holder.id}`} className="text-sm">
                    <span className="block truncate">{holder.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{holder.kind === "playlist" ? "Playlist" : holder.detail || "Track"}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">Deleting it removes the cover from every track and playlist in this list.</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing in the library is using this image.</p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" disabled={removing} onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="pigment" disabled={removing} onClick={() => void removeCover()}>{removing ? "Deleting…" : "Delete"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function LocalCover({ path, className, style }: { path: string; className?: string; style?: CSSProperties }) {
  const direct = localCoverUrl(path)
  const [src, setSrc] = useState<string | null>(direct)
  const [triedFile, setTriedFile] = useState(false)

  useEffect(() => {
    setSrc(localCoverUrl(path))
    setTriedFile(false)
  }, [path])

  if (!src) {
    return <div className={cn("bg-[#111111]", className)} style={style} />
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn("object-cover", className)}
      style={style}
      onError={() => {
        if (triedFile) {
          setSrc(null)
          return
        }
        setTriedFile(true)
        void loadCover(path).then(
          (url) => setSrc(url),
          () => setSrc(null),
        )
      }}
    />
  )
}
