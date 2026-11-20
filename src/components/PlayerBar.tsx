import { Blend, ListMusic, ListStart, Pause, Play, Repeat, Repeat1, RotateCcw, RotateCw, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Cover } from "@/components/Cover"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { artistLabel, crossfadeLabel, formatClock, loopHint, loopLabel, rateLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { LoopMode } from "@/lib/types"
import { version } from "../../package.json"
import { usePlayer, type PlayScope } from "@/stores/player"

export function PlayerBar() {
  const title = usePlayer((state) => state.title)
  const artist = usePlayer((state) => state.artist)
  const coverPath = usePlayer((state) => state.coverPath)
  const trackId = usePlayer((state) => state.trackId)
  const playing = usePlayer((state) => state.playing)
  const position = usePlayer((state) => state.position)
  const duration = usePlayer((state) => state.duration)
  const loopMode = usePlayer((state) => state.loopMode)
  const rate = usePlayer((state) => state.rate)
  const toggle = usePlayer((state) => state.toggle)
  const previous = usePlayer((state) => state.previous)
  const next = usePlayer((state) => state.next)
  const seek = usePlayer((state) => state.seek)
  const cycleLoop = usePlayer((state) => state.cycleLoop)
  const cycleRate = usePlayer((state) => state.cycleRate)
  const crossfade = usePlayer((state) => state.crossfade)
  const cycleCrossfade = usePlayer((state) => state.cycleCrossfade)
  const playScope = usePlayer((state) => state.playScope)
  const setPlayScope = usePlayer((state) => state.setPlayScope)
  const setStageOpen = usePlayer((state) => state.setStageOpen)
  const stageOpen = usePlayer((state) => state.stageOpen)
  const [scrub, setScrub] = useState<number | null>(null)
  const shown = scrub ?? (duration ? position / duration : 0)
  const disabled = !trackId

  return (
    <footer className={cn("glass relative z-30 border-t px-3 py-2 sm:px-4 sm:py-3", stageOpen && "invisible")} aria-hidden={stageOpen}>
      <p className="pointer-events-none absolute bottom-1.5 left-3 text-[11px] tracking-wide text-white/40">v{version}</p>
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2">
        <div className="flex w-full flex-nowrap items-center justify-center gap-x-2 overflow-x-auto">
          <button type="button" className="flex min-w-0 max-w-xs cursor-pointer items-center gap-3 text-left disabled:cursor-not-allowed" onClick={() => setStageOpen(true)} disabled={disabled}>
            <Cover path={coverPath} className="size-12 shrink-0 rounded-md sm:size-14" />
            <span className="min-w-0">
              <span className="serif block truncate text-base sm:text-lg">{title || "Nothing playing"}</span>
              <span className="block truncate text-sm text-muted-foreground">{trackId ? artistLabel(artist) : "Pick a track"}</span>
            </span>
          </button>
          <div className="flex items-center justify-center gap-1">
            <Hint label="Previous track" detail="Goes back to the start, then to the track before this one.">
              <Button variant="ghost" size="icon" onClick={() => void previous()} disabled={disabled} aria-label="Previous track">
                <SkipBack className="size-5" />
              </Button>
            </Hint>
            <Hint label="Back 5 seconds">
              <Button variant="ghost" size="icon" onClick={() => void seek(Math.max(0, position - 5))} disabled={disabled} aria-label="Back 5 seconds">
                <RotateCcw className="size-5" />
              </Button>
            </Hint>
            <Hint label={playing ? "Pause" : "Play"}>
              <Button size="icon" className="size-12" onClick={() => void toggle()} disabled={disabled} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <Pause className="size-6" /> : <Play className="size-6" />}
              </Button>
            </Hint>
            <Hint label="Forward 5 seconds">
              <Button variant="ghost" size="icon" onClick={() => void seek(position + 5)} disabled={disabled} aria-label="Forward 5 seconds">
                <RotateCw className="size-5" />
              </Button>
            </Hint>
            <Hint label="Next track" detail="Skips to the next track in the queue.">
              <Button variant="ghost" size="icon" onClick={() => void next()} disabled={disabled} aria-label="Next track">
                <SkipForward className="size-5" />
              </Button>
            </Hint>
          </div>
          <QueueSide scope={playScope} onScope={(scope) => void setPlayScope(scope)} loopMode={loopMode} onLoop={() => void cycleLoop()} disabled={disabled} />
          <Hint label={`Speed ${rateLabel(rate)}`} detail="Each click moves through 1×, faster, reverse, and half speed.">
            <Button variant="outline" size="sm" className="min-w-12 px-2 tabular-nums" onClick={() => void cycleRate()} disabled={disabled} aria-label={`Speed ${rateLabel(rate)}`}>
              {rateLabel(rate)}
            </Button>
          </Hint>
          <Hint label={crossfade < 1 ? "Crossfade off" : `Crossfade ${crossfadeLabel(crossfade)}`} detail="The end of a track blends into the next. Click for off, 1.5s, 3s, or 5s.">
            <Button variant="outline" size={crossfade < 1 ? "icon" : "sm"} className={crossfade < 1 ? undefined : "px-2 tabular-nums"} onClick={() => void cycleCrossfade()} aria-label={crossfade < 1 ? "Crossfade off" : `Crossfade ${crossfadeLabel(crossfade)}`}>
              {crossfade < 1 ? <Blend className="size-4" /> : crossfadeLabel(crossfade)}
            </Button>
          </Hint>
          <VolumeControl />
        </div>
        <div className="flex w-full max-w-xl items-center gap-2 text-sm text-muted-foreground">
          <span className="w-12 tabular-nums">{formatClock(scrub == null ? position : scrub * duration)}</span>
          <Slider
            max={1000}
            value={[Math.round(shown * 1000)]}
            disabled={disabled || !duration}
            aria-label="Position"
            onValueChange={([value]) => setScrub((value ?? 0) / 1000)}
            onValueCommit={([value]) => {
              setScrub(null)
              void seek(((value ?? 0) / 1000) * duration)
            }}
          />
          <span className="w-12 text-right tabular-nums">{formatClock(duration)}</span>
        </div>
      </div>
    </footer>
  )
}

function Hint({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-56 text-center">
        <span className="block">{label}</span>
        {detail ? <span className="mt-1 block text-white/70">{detail}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}

function QueueSide({
  scope,
  onScope,
  loopMode,
  onLoop,
  disabled,
}: {
  scope: PlayScope
  onScope: (scope: PlayScope) => void
  loopMode: LoopMode
  onLoop: () => void
  disabled: boolean
}) {
  const one = scope === "one"
  return (
    <>
      <Hint label={one ? "One track" : "In order"} detail={one ? "A click plays only that track. Next and previous stay on it." : "A click plays that track and keeps going through the list."}>
        <Button variant="outline" size="icon" aria-pressed={one} aria-label={one ? "One track" : "In order"} onClick={() => onScope(one ? "queue" : "one")}>
          {one ? <ListMusic className="size-4" /> : <ListStart className="size-4" />}
        </Button>
      </Hint>
      <Hint label={loopLabel(loopMode)} detail={loopHint(loopMode)}>
        <Button variant="outline" size="icon" onClick={onLoop} disabled={disabled} aria-label={loopLabel(loopMode)}>
          {loopMode === "track" ? <Repeat1 className="size-4" /> : <Repeat className="size-4" />}
        </Button>
      </Hint>
    </>
  )
}

function VolumeControl() {
  const volume = usePlayer((state) => state.volume)
  const setVolume = usePlayer((state) => state.setVolume)
  const [remembered, setRemembered] = useState(volume || 0.8)
  const Icon = volume <= 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  return (
    <div className="flex w-40 shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={volume <= 0 ? "Unmute" : "Mute"}
        onClick={() => {
          if (volume > 0) {
            setRemembered(volume)
            void setVolume(0)
          } else {
            void setVolume(remembered || 0.8)
          }
        }}
      >
        <Icon className="size-5" />
      </Button>
      <Slider max={100} value={[Math.round(volume * 100)]} aria-label="Volume" onValueChange={([value]) => void setVolume((value ?? 0) / 100)} />
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(volume * 100)}%</span>
    </div>
  )
}
