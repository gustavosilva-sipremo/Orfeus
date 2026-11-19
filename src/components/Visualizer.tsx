import { useEffect, useRef } from "react"

export const quietBands = Array.from({ length: 64 }, () => 0.06)

export function StageCanvas({ bands }: { bands: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const context = canvas.getContext("2d")
    if (!context) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const ratio = window.devicePixelRatio || 1
    const nextWidth = Math.max(1, Math.floor(width * ratio))
    const nextHeight = Math.max(1, Math.floor(height * ratio))
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth
      canvas.height = nextHeight
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    const cx = width * 0.5
    const cy = height * 0.5
    const reach = Math.min(width, height) * 0.28
    const energy = bands.reduce((sum, band) => sum + band, 0) / Math.max(bands.length, 1)
    const glow = context.createRadialGradient(cx, cy, reach * 0.12, cx, cy, reach * (1.35 + energy * 0.55))
    glow.addColorStop(0, `rgba(255, 244, 230, ${0.28 + energy * 0.4})`)
    glow.addColorStop(0.4, `rgba(255, 255, 255, ${0.12 + energy * 0.2})`)
    glow.addColorStop(1, "rgba(255, 255, 255, 0)")
    context.fillStyle = glow
    context.beginPath()
    context.arc(cx, cy, reach * 1.6, 0, Math.PI * 2)
    context.fill()
    bands.forEach((band, index) => {
      const angle = (index / bands.length) * Math.PI * 2 - Math.PI / 2
      const lifted = Math.pow(Math.max(band, 0), 0.72)
      const inner = reach * 0.84
      const outer = inner + 10 + lifted * reach * 1.45
      const mirror = angle + Math.PI
      for (const theta of [angle, mirror]) {
        const gradient = context.createLinearGradient(cx + Math.cos(theta) * inner, cy + Math.sin(theta) * inner, cx + Math.cos(theta) * outer, cy + Math.sin(theta) * outer)
        gradient.addColorStop(0, "rgba(255,255,255,0.2)")
        gradient.addColorStop(0.4, `rgba(255, 248, 236, ${0.55 + band * 0.45})`)
        gradient.addColorStop(1, "rgba(255,255,255,0.02)")
        context.strokeStyle = gradient
        context.lineWidth = 2.5 + lifted * 9
        context.lineCap = "round"
        context.beginPath()
        context.moveTo(cx + Math.cos(theta) * inner, cy + Math.sin(theta) * inner)
        context.lineTo(cx + Math.cos(theta) * outer, cy + Math.sin(theta) * outer)
        context.stroke()
      }
    })
    context.beginPath()
    context.strokeStyle = `rgba(255,255,255,${0.45 + energy * 0.5})`
    context.lineWidth = 2.5
    context.arc(cx, cy, reach * (0.7 + energy * 0.08), 0, Math.PI * 2)
    context.stroke()
  }, [bands])
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />
}
