let armed = false

function pixels(event: WheelEvent, node: HTMLElement) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 40
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * node.clientHeight
  return event.deltaY
}

function onWheel(event: WheelEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
  const target = event.target
  if (!(target instanceof Element) || target.closest("textarea, select")) return
  let node = target.closest<HTMLElement>("[data-wheel-scroll]")
  while (node) {
    const delta = pixels(event, node)
    if (!delta) return
    const max = node.scrollHeight - node.clientHeight
    if (max > 1) {
      const next = Math.min(max, Math.max(0, node.scrollTop + delta))
      if (next !== node.scrollTop) {
        node.scrollTop = next
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }
    node = node.parentElement?.closest<HTMLElement>("[data-wheel-scroll]") ?? null
  }
}

export function armWheelScroll() {
  if (armed || typeof document === "undefined") return
  armed = true
  document.addEventListener("wheel", onWheel, { capture: true, passive: false })
}
