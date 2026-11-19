import { useState } from "react"
import { Button } from "@/components/ui/button"

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.left = "-9999px"
    document.body.appendChild(area)
    area.select()
    document.execCommand("copy")
    area.remove()
  }
}

export function DiscError({ error }: { error: string }) {
  const [copied, setCopied] = useState(false)
  if (!error) return null
  return (
    <div className="mt-3 rounded-md border border-red-300/40 bg-black/70 p-3">
      <pre data-wheel-scroll="" className="max-h-72 overflow-auto font-sans text-sm leading-relaxed whitespace-pre-wrap wrap-break-word text-red-200">
        {error}
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => {
          void copyText(error).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          })
        }}
      >
        {copied ? "Copied" : "Copy error"}
      </Button>
    </div>
  )
}
