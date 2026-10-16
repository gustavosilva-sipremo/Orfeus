import { Pause, Play, Repeat, Repeat1, RotateCcw, RotateCw, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react"
import { useState } from "react"
import { Cover } from "@/components/Cover"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { artistLabel, crossfadeLabel, formatClock, loopLabel, rateLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import { usePlayer } from "@/stores/player"

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
  const setStageOpen = usePlayer((state) => state.setStageOpen)
  const stageOpen = usePlayer((state) => state.stageOpen)
  const [scrub, setScrub] = useState<number | null>(null)
  const shown = scrub ?? (duration ? position / duration : 0)
  const disabled = !trackId

  return (
    <footer className={cn("glass relative z-30 border-t px-3 py-2 sm:px-4 sm:py-3", stageOpen && "invisible")} aria-hidden={stageOpen}>
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(16rem,1.5fr)_auto] lg:items-center lg:gap-4">
        <button type="button" className="flex min-w-0 cursor-pointer items-center gap-3 text-left disabled:cursor-not-allowed" onClick={() => setStageOpen(true)} disabled={disabled}>
          <Cover path={coverPath} className="size-12 shrink-0 rounded-md sm:size-14" />
          <span className="min-w-0">
            <span className="serif block truncate text-base sm:text-lg">{title || "Nothing playing"}</span>
            <span className="block truncate text-sm text-muted-foreground">{trackId ? artistLabel(artist) : "Pick a track"}</span>
          </span>
        </button>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => void previous()} disabled={disabled} aria-label="Previous">
              <SkipBack className="size-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => void seek(Math.max(0, position - 5))} disabled={disabled} aria-label="Back 5 seconds">
              <RotateCcw className="size-5" />
            </Button>
            <Button size="icon" className="size-12" onClick={() => void toggle()} disabled={disabled} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="size-6" /> : <Play className="size-6" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => void seek(position + 5)} disabled={disabled} aria-label="Forward 5 seconds">
              <RotateCw className="size-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => void next()} disabled={disabled} aria-label="Next">
              <SkipForward className="size-5" />
            </Button>
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <VolumeControl />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => void cycleLoop()} disabled={disabled}>
                {loopMode === "track" ? <Repeat1 className="size-5" /> : <Repeat className="size-5" />}
                {loopLabel(loopMode)}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Loop the track or the playlist</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => void cycleRate()} disabled={disabled} className="w-16">
                {rateLabel(rate)}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Speed: 1×, 2×, and ½×</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => void cycleCrossfade()} className="w-16">
                {crossfadeLabel(crossfade)}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ease in and out between tracks: off, 1.5s, 3s, or 5s</TooltipContent>
          </Tooltip>
          <Button variant="secondary" size="sm" onClick={() => setStageOpen(true)}>
            Stage
          </Button>
        </div>
      </div>
    </footer>
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
