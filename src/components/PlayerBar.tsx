import { ListMusic, ListStart, Pause, Play, Repeat, Repeat1, RotateCcw, RotateCw, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Cover } from "@/components/Cover"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { artistLabel, crossfadeLabel, formatClock, loopHint, loopLabel, rateLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
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
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left disabled:cursor-not-allowed" onClick={() => setStageOpen(true)} disabled={disabled}>
            <Cover path={coverPath} className="size-12 shrink-0 rounded-md sm:size-14" />
            <span className="min-w-0">
              <span className="serif block truncate text-base sm:text-lg">{title || "Nothing playing"}</span>
              <span className="block truncate text-sm text-muted-foreground">{trackId ? artistLabel(artist) : "Pick a track"}</span>
            </span>
          </button>
          <div className="hidden items-center gap-2 lg:flex">
            <ScopeToggle scope={playScope} onChange={(scope) => void setPlayScope(scope)} />
            <Hint label={loopLabel(loopMode)} detail={loopHint(loopMode)}>
              <Button variant="outline" size="sm" onClick={() => void cycleLoop()} disabled={disabled} aria-label={loopLabel(loopMode)}>
                {loopMode === "track" ? <Repeat1 className="size-4" /> : <Repeat className="size-4" />}
                {loopLabel(loopMode)}
              </Button>
            </Hint>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 lg:w-[min(28rem,36vw)]">
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
        <div className="flex flex-wrap items-center gap-2 lg:justify-start">
          <div className="flex items-center gap-2 lg:hidden">
            <ScopeToggle scope={playScope} onChange={(scope) => void setPlayScope(scope)} />
            <Hint label={loopLabel(loopMode)} detail={loopHint(loopMode)}>
              <Button variant="outline" size="sm" onClick={() => void cycleLoop()} disabled={disabled} aria-label={loopLabel(loopMode)}>
                {loopMode === "track" ? <Repeat1 className="size-4" /> : <Repeat className="size-4" />}
                {loopLabel(loopMode)}
              </Button>
            </Hint>
          </div>
          <Hint label={`Speed ${rateLabel(rate)}`} detail="Each click moves through 1×, faster, reverse, and half speed.">
            <Button variant="outline" size="sm" onClick={() => void cycleRate()} disabled={disabled} aria-label={`Speed ${rateLabel(rate)}`}>
              Speed {rateLabel(rate)}
            </Button>
          </Hint>
          <Hint label={crossfade < 1 ? "Crossfade off" : `Crossfade ${crossfadeLabel(crossfade)}`} detail="The end of a track blends into the next. Click for off, 1.5s, 3s, or 5s.">
            <Button variant="outline" size="sm" onClick={() => void cycleCrossfade()} aria-label={crossfade < 1 ? "Crossfade off" : `Crossfade ${crossfadeLabel(crossfade)}`}>
              Fade {crossfadeLabel(crossfade)}
            </Button>
          </Hint>
          <VolumeControl />
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

function ScopeToggle({ scope, onChange }: { scope: PlayScope; onChange: (scope: PlayScope) => void }) {
  return (
    <div className="flex rounded-md border border-white/10 bg-black p-0.5" role="group" aria-label="What plays next">
      <ScopeButton active={scope === "one"} icon={<ListMusic className="size-4" />} label="One track" detail="A click plays only that track. Next and previous stay on it." onClick={() => onChange("one")} />
      <ScopeButton active={scope === "queue"} icon={<ListStart className="size-4" />} label="In order" detail="A click plays that track and keeps going through the list." onClick={() => onChange("queue")} />
    </div>
  )
}

function ScopeButton({ active, icon, label, detail, onClick }: { active: boolean; icon: ReactNode; label: string; detail: string; onClick: () => void }) {
  return (
    <Hint label={label} detail={detail}>
      <button
        type="button"
        aria-pressed={active}
        className={cn("flex h-9 cursor-pointer items-center gap-1.5 rounded px-2.5 text-sm", active ? "bg-[#242424] text-white" : "text-white/45 hover:text-white/80")}
        onClick={onClick}
      >
        {icon}
        <span className="hidden xl:inline">{label}</span>
      </button>
    </Hint>
  )
}

function VolumeControl() {
  const volume = usePlayer((state) => state.volume)
  const setVolume = usePlayer((state) => state.setVolume)
  const [remembered, setRemembered] = useState(volume || 0.8)
  const Icon = volume <= 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  return (
    <div className="flex w-28 items-center gap-1 sm:w-40">
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
    </div>
  )
}
