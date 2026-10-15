import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export function TooltipContent({ className, ...props }: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={6}
        className={cn("bg-popover z-50 rounded-md border px-2 py-1 text-xs shadow", className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}
