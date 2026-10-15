import * as SliderPrimitive from "@radix-ui/react-slider"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export function Slider({ className, ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root className={cn("relative flex w-full cursor-pointer touch-none items-center select-none", className)} {...props}>
      <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-secondary">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-4 cursor-pointer rounded-full border border-gold bg-primary shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" />
    </SliderPrimitive.Root>
  )
}
