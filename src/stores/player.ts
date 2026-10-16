import { listen } from "@tauri-apps/api/event"
import { create } from "zustand"
import * as api from "@/lib/api"
import { nextCrossfade, nextLoop, nextRate } from "@/lib/format"
import type { LoopMode, PlaybackState, QueueTrack, Track } from "@/lib/types"
import { toQueue } from "@/lib/types"
import { notePlayback } from "@/lib/listens"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"

const empty: PlaybackState = {
  trackId: null,
  title: "",
  artist: "",
  coverPath: null,
  position: 0,
  duration: 0,
  playing: false,
  rate: 1,
  loopMode: "off",
  index: 0,
  queueLength: 0,
  error: null,
}

const volumeKey = "orfeus-volume"
const fadeKey = "orfeus-crossfade"

function readCrossfade() {
  try {
    const raw = Number(localStorage.getItem(fadeKey))
    if (raw === 1.5 || raw === 3 || raw === 5) return raw
  } catch {
    return 0
  }
  return 0
}

function readVolume() {
  try {
    const stored = localStorage.getItem(volumeKey)
    if (stored == null) return 1
    const raw = Number(stored)
    return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1
  } catch {
    return 1
  }
}

type PlayerState = PlaybackState & {
  bands: number[]
  stageOpen: boolean
  playlistId: string | null
  queue: QueueTrack[]
  init: () => Promise<void>
  playTracks: (tracks: Track[], index: number, loopMode?: LoopMode, playlistId?: string | null) => Promise<void>
  toggle: () => Promise<void>
  seek: (seconds: number) => Promise<void>
  cycleRate: () => Promise<void>
  cycleLoop: () => Promise<void>
  next: () => Promise<void>
  previous: () => Promise<void>
  setStageOpen: (open: boolean) => void
  ready: boolean
  volume: number
  setVolume: (volume: number) => Promise<void>
  crossfade: number
  cycleCrossfade: () => Promise<void>
  syncTrack: (id: string) => void
}

let started = false
let tick = 0

function applyQueue(queue: QueueTrack[], index: number, loopMode: LoopMode, playing: boolean): Partial<PlayerState> {
  const track = queue[index]
  if (!track) return { ...empty, loopMode, queue, queueLength: 0, playing: false }
  return {
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    coverPath: track.coverPath,
    position: 0,
    duration: track.durationMs / 1000,
    playing,
    loopMode,
    index,
    queueLength: queue.length,
    queue,
    error: null,
  }
}

export const usePlayer = create<PlayerState>((set, get) => ({
  ...empty,
  bands: Array.from({ length: 64 }, () => 0),
  stageOpen: false,
  playlistId: null,
  queue: [],
  ready: false,
  volume: readVolume(),
  crossfade: readCrossfade(),
  init: async () => {
    if (started) return
    started = true
    const crossfade = readCrossfade()
    set({ crossfade })
    if (!api.desktop()) {
      set({ ready: true })
      window.setInterval(() => {
        const heard = get()
        notePlayback({
          trackId: heard.trackId,
          playing: heard.playing,
          position: heard.position,
          title: heard.title,
          artist: heard.artist,
          coverPath: heard.coverPath,
        })
        tick += 1
        const playing = get().playing
        const bands = Array.from({ length: 64 }, (_, index) => {
          const center = 16 + Math.sin(tick / 28) * 10
          const envelope = Math.exp(-((index - center) ** 2) / 160)
          const wave = 0.55 + 0.45 * Math.sin(tick / 8 + index * 0.37)
          return Math.max(0, Math.min(1, wave * envelope * (playing ? 0.95 : 0.22)))
        })
        const state = get()
        if (!state.playing || !state.duration) {
          set({ bands })
          return
        }
        let position = state.position + 0.2 * state.rate
        let index = state.index
        let playingNow = true
        if (position >= state.duration) {
          if (state.loopMode === "track") position = 0
          else if (index + 1 < state.queue.length || state.loopMode === "playlist") {
            index = index + 1 >= state.queue.length ? 0 : index + 1
            const next = applyQueue(state.queue, index, state.loopMode, true)
            set({ ...next, bands })
            return
          } else {
            position = state.duration
            playingNow = false
          }
        }
        set({ bands, position, playing: playingNow })
      }, 200)
      return
    }
    void api.setVolume(get().volume)
    void api.setCrossfade(get().crossfade)
    let heard = ""
    const unlistenState = await listen<PlaybackState>("playback://state", (event) => {
      const payload = event.payload
      const track = useLibrary.getState().tracks.find((item) => item.id === payload.trackId)
      if (payload.trackId && payload.trackId !== heard) {
        heard = payload.trackId
        void api.setTrackGain(track?.gain ?? 1)
      }
      const next = track
        ? { ...payload, title: track.title, artist: track.artist, coverPath: track.coverPath }
        : payload
      set(next)
      notePlayback({
        trackId: next.trackId,
        playing: next.playing,
        position: next.position,
        title: next.title,
        artist: next.artist,
        coverPath: next.coverPath,
      })
    })
    const unlistenSpectrum = await listen<number[]>("playback://spectrum", (event) => {
      set({ bands: event.payload })
    })
    window.addEventListener("beforeunload", () => {
      void unlistenState()
      void unlistenSpectrum()
    })
    try {
      set(await api.playbackState())
    } catch (error) {
      set({ error: message(error) })
    }
    set({ ready: true })
  },
  playTracks: async (tracks, index, loopMode = "off", playlistId = null) => {
    const chosen = tracks[index]
    const queue = tracks.filter((track) => !track.missing).map(toQueue)
    const playableIndex = queue.findIndex((track) => track.id === chosen?.id)
    if (!chosen || playableIndex < 0) {
      set({ error: "That file is no longer on disk." })
      return
    }
    set({ playlistId, ...applyQueue(queue, playableIndex, loopMode, true) })
    if (!api.desktop()) return
    void api.setTrackGain(chosen.gain ?? 1)
    try {
      await api.play(queue, playableIndex, loopMode)
    } catch (error) {
      set({ error: message(error), playing: false })
    }
  },
  toggle: async () => {
    if (!api.desktop()) {
      const state = get()
      if (!state.trackId) return
      if (!state.playing && state.duration > 0 && state.position >= state.duration - 0.05) {
        set({ playing: true, position: 0 })
        return
      }
      set({ playing: !state.playing })
      return
    }
    try {
      await api.toggle()
    } catch (error) {
      set({ error: message(error) })
    }
  },
  seek: async (seconds) => {
    const duration = get().duration
    const position = Math.min(Math.max(seconds, 0), duration || seconds)
    set({ position })
    if (!api.desktop()) return
    try {
      await api.seek(position)
    } catch (error) {
      set({ error: message(error) })
    }
  },
  cycleRate: async () => {
    const rate = nextRate(get().rate)
    set({ rate })
    if (!api.desktop()) return
    try {
      await api.setRate(rate)
    } catch (error) {
      set({ error: message(error) })
    }
  },
  cycleLoop: async () => {
    const loopMode = nextLoop(get().loopMode)
    set({ loopMode })
    const playlistId = get().playlistId
    if (playlistId) {
      void useLibrary.getState().savePlaylist({ id: playlistId, loopMode }).catch((error: unknown) => {
        useLibrary.setState({ error: message(error) })
      })
    }
    if (!api.desktop()) return
    try {
      await api.setLoop(loopMode)
    } catch (error) {
      set({ error: message(error) })
    }
  },
  next: async () => {
    if (!api.desktop()) {
      const state = get()
      if (!state.queue.length) return
      const index = state.index + 1 >= state.queue.length ? (state.loopMode === "playlist" ? 0 : state.index) : state.index + 1
      if (index === state.index && state.loopMode !== "playlist") return
      set(applyQueue(state.queue, index, state.loopMode, true))
      return
    }
    try {
      await api.next()
    } catch (error) {
      set({ error: message(error) })
    }
  },
  previous: async () => {
    if (!api.desktop()) {
      const state = get()
      if (state.position > 2) {
        set({ position: 0, playing: true })
        return
      }
      const index = Math.max(0, state.index - 1)
      set(applyQueue(state.queue, index, state.loopMode, true))
      return
    }
    try {
      await api.previous()
    } catch (error) {
      set({ error: message(error) })
    }
  },
  setStageOpen: (stageOpen) => set({ stageOpen }),
  syncTrack: (id) => {
    const track = useLibrary.getState().tracks.find((item) => item.id === id)
    if (!track) return
    const state = get()
    const queue = state.queue.map((item) =>
      item.id === id ? { ...item, title: track.title, artist: track.artist, coverPath: track.coverPath } : item,
    )
    if (state.trackId !== id) {
      set({ queue })
      return
    }
    set({ queue, title: track.title, artist: track.artist, coverPath: track.coverPath })
  },
  cycleCrossfade: async () => {
    const crossfade = nextCrossfade(get().crossfade)
    localStorage.setItem(fadeKey, String(crossfade))
    set({ crossfade })
    if (!api.desktop()) return
    try {
      await api.setCrossfade(crossfade)
    } catch (error) {
      set({ error: message(error) })
    }
  },
  setVolume: async (volume) => {
    const next = Math.min(1, Math.max(0, volume))
    set({ volume: next })
    localStorage.setItem(volumeKey, String(next))
    if (!api.desktop()) return
    try {
      await api.setVolume(next)
    } catch (error) {
      set({ error: message(error) })
    }
  },
}))
