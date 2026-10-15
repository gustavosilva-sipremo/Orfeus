import { invoke, isTauri } from "@tauri-apps/api/core"

const covers = new Map<string, Promise<string>>()

export function mediaUrl(path: string | null | undefined) {
  if (!path) return null
  if (path.startsWith("https://") || path.startsWith("data:") || path.startsWith("blob:")) return path
  return null
}

export function loadCover(path: string): Promise<string | null> {
  const direct = mediaUrl(path)
  if (direct) return Promise.resolve(direct)
  if (!path || !isTauri()) return Promise.resolve(null)
  const cached = covers.get(path)
  if (cached) return cached
  const pending = invoke<ArrayBuffer>("read_image", { path })
    .then((buffer) => {
      const bytes = new Uint8Array(buffer)
      return URL.createObjectURL(new Blob([bytes], { type: mimeFrom(bytes) }))
    })
    .catch((error: unknown) => {
      covers.delete(path)
      throw error
    })
  covers.set(path, pending)
  return pending
}

function mimeFrom(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif"
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp"
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "image/avif"
  return "application/octet-stream"
}
