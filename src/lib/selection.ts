import { useSyncExternalStore } from "react"

let current: string[] = []
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function setSelection(next: string[]) {
  current = next
  emit()
}

export function useSelection() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
    () => current,
  )
}
