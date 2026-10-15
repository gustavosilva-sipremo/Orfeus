import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function message(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string") return error
  return "Something went wrong."
}
