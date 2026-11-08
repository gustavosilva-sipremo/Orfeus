import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"
import "./light-menu.css"

export type LightMenuOption = {
  value: string
  label: ReactNode
}

export function LightMenu({
  options,
  value,
  onValueChange,
  accent = "var(--gold)",
  label = "Menu",
  className,
  disabled = false,
}: {
  options: LightMenuOption[]
  value: string
  onValueChange: (value: string) => void
  accent?: string
  label?: string
  className?: string
  disabled?: boolean
}) {
  const index = options.findIndex((option) => option.value === value)

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-busy={disabled}
      className={cn("light-menu", disabled && "cursor-wait", className)}
      style={{ "--menu-accent": accent, "--menu-index": Math.max(index, 0) } as CSSProperties}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn(
              "relative flex h-14 w-full cursor-pointer items-center overflow-hidden rounded-md px-3 text-left text-base",
              selected ? "text-(--menu-accent)" : "text-muted-foreground",
            )}
            onClick={() => {
              if (disabled) return
              onValueChange(option.value)
            }}
          >
            {option.label}
          </button>
        )
      })}
      <div className="light-menu-rail" aria-hidden>
        <div className="light-menu-glider" style={{ opacity: index >= 0 ? 1 : 0 }} />
      </div>
    </div>
  )
}
