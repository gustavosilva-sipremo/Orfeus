import { describe, expect, it } from "vitest"
import { packageManifestSchema } from "./package"

describe("pacote orfeus", () => {
  it("aceita o manifesto da playlist", () => {
    const parsed = packageManifestSchema.parse({
      format: "orfeus-playlist",
      version: 1,
      playlist: { name: "Descida", cover: "cover.jpg", loopMode: "playlist" },
      tracks: [
        {
          file: "tracks/01.flac",
          title: "Eurídice",
          artist: "Orfeus",
          album: "Rachadura",
          lyrics: "Desci cantando.",
          cover: "covers/01.jpg",
        },
      ],
    })
    expect(parsed.playlist.name).toBe("Descida")
    expect(parsed.tracks[0]?.file).toBe("tracks/01.flac")
  })

  it("recusa um formato diferente", () => {
    const result = packageManifestSchema.safeParse({
      format: "outro",
      version: 1,
      playlist: { name: "X", cover: null, loopMode: "off" },
      tracks: [],
    })
    expect(result.success).toBe(false)
  })
})
