import { z } from "zod"

export const loopModeSchema = z.enum(["off", "track", "playlist"])

export const packageTrackSchema = z.object({
  file: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  lyrics: z.string(),
  cover: z.string().nullable(),
})

export const packageManifestSchema = z.object({
  format: z.literal("orfeus-playlist"),
  version: z.literal(1),
  playlist: z.object({
    name: z.string(),
    cover: z.string().nullable(),
    loopMode: loopModeSchema,
  }),
  tracks: z.array(packageTrackSchema),
})

export type PackageManifest = z.infer<typeof packageManifestSchema>
export type PackageTrack = z.infer<typeof packageTrackSchema>
