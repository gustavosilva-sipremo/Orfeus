import { useEffect, useState } from "react"

const key = "orfeus-export-dir"
const eventName = "orfeus-export-dir"

export function readExportDir() {
  return localStorage.getItem(key) ?? ""
}

export function writeExportDir(path: string) {
  localStorage.setItem(key, path)
  window.dispatchEvent(new Event(eventName))
}

export function useExportDir() {
  const [dir, setDir] = useState(readExportDir)
  useEffect(() => {
    const sync = () => setDir(readExportDir())
    window.addEventListener(eventName, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(eventName, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])
  return dir
}
