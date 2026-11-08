import { Disc3 } from "lucide-react"
import { useEffect, useState, type CSSProperties, type SyntheticEvent } from "react"
import { loadCover, mediaUrl } from "@/lib/media"
import { cn } from "@/lib/utils"

const fitted = new Map<string, string>()

export function Cover({ path, className, style }: { path: string | null; className?: string; style?: CSSProperties }) {
  const direct = mediaUrl(path)
  const [src, setSrc] = useState<string | null>(direct)

  useEffect(() => {
    if (!path || direct) {
      setSrc(direct)
      return
    }
    let alive = true
    setSrc(null)
    void loadCover(path).then(
      (url) => {
        if (alive) setSrc(url)
      },
      () => {
        if (alive) setSrc(null)
      },
    )
    return () => {
      alive = false
    }
  }, [path, direct])

  if (!src) return <EmptyCover className={className} style={style} />
  return <FittedImage src={src} className={className} style={style} onError={() => setSrc(null)} />
}

export function FittedImage({
  src,
  className,
  style,
  onError,
}: {
  src: string
  className?: string
  style?: CSSProperties
  onError?: () => void
}) {
  const [shown, setShown] = useState(src)

  useEffect(() => {
    setShown(src)
  }, [src])

  function onLoad(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget
    if (shown !== src) return
    const edge = deviceEdge(image)
    if (!edge) return
    const key = `${edge}:${src}`
    const cached = fitted.get(key)
    if (cached) {
      setShown(cached)
      return
    }
    const next = drawFit(image, edge)
    if (!next) return
    fitted.set(key, next)
    setShown(next)
  }

  return (
    <img
      src={shown}
      alt=""
      decoding="async"
      className={cn("object-cover", className)}
      style={style}
      onLoad={onLoad}
      onError={() => {
        if (shown === src) onError?.()
      }}
    />
  )
}

function EmptyCover({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("flex items-center justify-center bg-[#111111] text-white/75", className)} style={style}>
      <Disc3 className="size-[52%]" strokeWidth={1.25} aria-hidden />
    </div>
  )
}

function deviceEdge(image: HTMLImageElement) {
  const css = Math.max(image.clientWidth, image.clientHeight)
  if (css < 8) return 0
  const pixels = Math.round(css * Math.min(window.devicePixelRatio || 1, 2))
  return Math.min(1600, Math.ceil(pixels / 16) * 16)
}

function drawFit(image: HTMLImageElement, maxEdge: number) {
  let width = image.naturalWidth
  let height = image.naturalHeight
  if (!width || !height || Math.max(width, height) <= maxEdge * 2) return null
  let source: CanvasImageSource = image
  const first = document.createElement("canvas")
  const second = document.createElement("canvas")
  let target = first
  while (Math.max(width, height) / 2 > maxEdge) {
    width = Math.max(1, Math.round(width / 2))
    height = Math.max(1, Math.round(height / 2))
    const ctx = paint(target, source, width, height)
    if (!ctx) return null
    source = target
    target = target === first ? second : first
  }
  const scale = maxEdge / Math.max(width, height)
  const ctx = paint(target, source, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
  if (!ctx) return null
  try {
    return target.toDataURL("image/jpeg", 0.92)
  } catch {
    return null
  }
}

function paint(canvas: HTMLCanvasElement, source: CanvasImageSource, width: number, height: number) {
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source, 0, 0, width, height)
  return ctx
}
