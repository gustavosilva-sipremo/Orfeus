import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function message(error: unknown) {
  const text = describe(error).trim()
  return text || "Something went wrong."
}

function describe(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) {
    const cause = error.cause == null ? "" : describe(error.cause).trim()
    if (!error.message) return cause
    if (!cause || error.message.includes(cause)) return error.message
    return `${error.message}\n\n${cause}`
  }
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error, null, 2)
    } catch {
      return String(error)
    }
  }
  return String(error ?? "")
}
