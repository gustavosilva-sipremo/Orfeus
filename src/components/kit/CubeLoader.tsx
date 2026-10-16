import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"
import "./cube-loader.css"

export function CubeLoader({
  size = 70,
  color = "var(--gold)",
  label = "Loading",
  className,
}: {
  size?: number
  color?: string
  label?: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn("cube-loader", className)}
      style={{ "--size": `${size}px`, "--clr": color } as CSSProperties}
    >
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  )
}
