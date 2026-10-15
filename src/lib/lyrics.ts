export type LyricLine = { time: number | null; text: string }

export function parseLyrics(synced: string, plain: string): LyricLine[] {
  const timed = parseLrc(synced)
  if (timed.some((line) => line.time != null)) return timed.filter((line) => line.text)
  return plain
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ time: null, text }))
}

export function parseLrc(input: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of input.split(/\r?\n/)) {
    const match = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/)
    if (!match) continue
    const time = Number(match[1]) * 60 + Number(match[2])
    lines.push({ time: Number.isFinite(time) ? time : null, text: match[3]?.trim() ?? "" })
  }
  return lines
}

export function plainFromLrc(input: string) {
  const lines = parseLrc(input).map((line) => line.text).filter(Boolean)
  return lines.join("\n")
}

export function activeLine(lines: LyricLine[], position: number, offset: number) {
  const time = position + offset
  let index = -1
  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const stamp = lines[cursor]?.time
    if (stamp != null && stamp <= time) index = cursor
  }
  return index
}

export function stampLine(lines: LyricLine[], index: number, time: number) {
  return lines
    .map((line, cursor) => {
      const stamp = cursor === index ? time : line.time
      if (stamp == null) return line.text
      return `${formatStamp(stamp)}${line.text}`
    })
    .join("\n")
}

export function shiftLrc(input: string, delta: number) {
  return parseLrc(input)
    .map((line) => {
      if (line.time == null) return line.text
      return `${formatStamp(Math.max(0, line.time + delta))}${line.text}`
    })
    .join("\n")
}

function formatStamp(time: number) {
  const safe = Math.max(0, time)
  const minutes = Math.floor(safe / 60)
  const seconds = (safe % 60).toFixed(2).padStart(5, "0")
  return `[${String(minutes).padStart(2, "0")}:${seconds}]`
}
