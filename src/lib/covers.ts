import * as api from "@/lib/api"

const imageExt = /\.(png|jpe?g|webp|gif|avif)$/i

const handlers: Array<(path: string) => void> = []

export function isImagePath(path: string) {
  return imageExt.test(path)
}

export function watchCoverDrop(handler: (path: string) => void) {
  handlers.push(handler)
  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index >= 0) handlers.splice(index, 1)
  }
}

export function offerCoverDrop(path: string) {
  const handler = handlers.at(-1)
  if (!handler) return false
  handler(path)
  return true
}

export async function stageImageFile(file: File) {
  if (!file.type.startsWith("image/") && !imageExt.test(file.name)) {
    throw new Error("Use an image file.")
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength > 20 * 1024 * 1024) {
    throw new Error("The image is larger than 20 MB.")
  }
  if (!api.desktop()) {
    throw new Error("Cover art is saved in the desktop app.")
  }
  return api.stageCover(bytes)
}

export function imageFileFromList(files: FileList | File[] | null | undefined) {
  return [...(files ?? [])].find((file) => file.type.startsWith("image/") || imageExt.test(file.name)) ?? null
}

export function imageFromClipboard(data: DataTransfer | null) {
  const item = [...(data?.items ?? [])].find((entry) => entry.type.startsWith("image/"))
  return item?.getAsFile() ?? null
}
