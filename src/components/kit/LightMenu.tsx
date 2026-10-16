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
}: {
  options: LightMenuOption[]
  value: string
  onValueChange: (value: string) => void
  accent?: string
  label?: string
  className?: string
}) {
  const index = options.findIndex((option) => option.value === value)
  const count = Math.max(options.length, 1)

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("light-menu", className)}
      style={{ "--menu-accent": accent, "--count": count } as CSSProperties}
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
              "relative flex h-14 w-full cursor-pointer items-center overflow-hidden rounded-md px-3 text-left text-base transition duration-300",
              selected ? "text-(--menu-accent)" : "text-muted-foreground",
            )}
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
      <div className="light-menu-rail" aria-hidden>
        {index >= 0 ? <div className="light-menu-glider" style={{ transform: `translateY(${index * 100}%)` }} /> : null}
      </div>
    </div>
  )
}
