import * as api from "@/lib/api"

type Session = {
  trackId: string
  title: string
  artist: string
  coverPath: string | null
  playId: number | null
  heard: number
  sent: number
  last: number
  mark: number
}

let open: Session | null = null
let sending = false
let waiting: Session | null = null

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (open) void pump(open, true)
  })
}

export function notePlayback(input: {
  trackId: string | null
  playing: boolean
  position: number
  title: string
  artist: string
  coverPath: string | null
}) {
  const now = performance.now()
  const trackId = input.trackId ?? ""
  if (open && (open.trackId !== trackId || input.position + 3 < open.mark)) {
    const done = open
    open = null
    void pump(done, true)
  }
  if (!trackId) return
  if (!open) {
    open = {
      trackId,
      title: input.title,
      artist: input.artist,
      coverPath: input.coverPath,
      playId: null,
      heard: 0,
      sent: 0,
      last: now,
      mark: input.position,
    }
    return
  }
  if (input.playing) {
    const dt = (now - open.last) / 1000
    if (dt > 0 && dt <= 1.5) open.heard += dt
  }
  open.last = now
  open.mark = input.position
  if (input.title) open.title = input.title
  open.artist = input.artist
  open.coverPath = input.coverPath
  void pump(open, false)
}

async function pump(session: Session, force: boolean) {
  if (sending) {
    if (force) waiting = session
    return
  }
  const pending = session.heard - session.sent
  const due = session.heard >= 5 && (session.playId == null || pending >= 20 || (force && pending >= 1))
  if (!due || pending < 1) return
  const delta = pending
  session.sent += delta
  sending = true
  let failed = false
  try {
    session.playId = await api.recordListen({
      trackId: session.trackId,
      title: session.title,
      artist: session.artist,
      coverPath: session.coverPath,
      seconds: delta,
      playId: session.playId,
    })
  } catch {
    session.sent -= delta
    failed = true
  } finally {
    sending = false
  }
  if (failed) return
  const next = waiting
  waiting = null
  if (next && next !== session) {
    void pump(next, true)
    return
  }
  if (session.heard - session.sent >= 1 && (force || open === session)) void pump(session, force)
}
