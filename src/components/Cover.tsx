import { useEffect, useState, type CSSProperties } from "react"
import { loadCover, mediaUrl } from "@/lib/media"
import { cn } from "@/lib/utils"

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

  if (!src) {
    return (
      <div className={cn("relative overflow-hidden bg-[#111111]", className)} style={style}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,#2a2a2a_0%,transparent_52%),radial-gradient(circle_at_78%_82%,#3a3a3a_0%,transparent_46%)]" />
      </div>
    )
  }
  return <img src={src} alt="" className={cn("object-cover", className)} style={style} onError={() => setSrc(null)} />
}
