import type { Playlist, SearchReport, Track } from "@/lib/types"

export const previewTracks: Track[] = [
  {
    id: "preview-1",
    path: "/musica/euridice.flac",
    storage: "linked",
    title: "Eurídice",
    artist: "Orfeus",
    album: "Rachadura",
    durationMs: 214000,
    coverPath: null,
    lyrics: "Desci cantando até onde a luz se rompe.\nA pedra guardava o nome dela em ouro fino.",
    syncedLyrics: "[00:02.00]Desci cantando até onde a luz se rompe.\n[00:08.00]A pedra guardava o nome dela em ouro fino.",
    gain: 1,
    missing: false,
    addedAt: 1,
  },
  {
    id: "preview-2",
    path: "/musica/lira.mp3",
    storage: "linked",
    title: "Lira na margem",
    artist: "Orfeus",
    album: "Rachadura",
    durationMs: 186000,
    coverPath: null,
    lyrics: "A corda treme e o rio responde.\nNada aqui pede pressa.",
    syncedLyrics: "",
    gain: 0.65,
    missing: false,
    addedAt: 2,
  },
  {
    id: "preview-3",
    path: "/musica/volta.wav",
    storage: "linked",
    title: "A volta",
    artist: "Coro",
    album: "Rachadura",
    durationMs: 248000,
    coverPath: null,
    lyrics: "",
    syncedLyrics: "",
    gain: 1,
    missing: true,
    addedAt: 3,
  },
]

export const previewPlaylists: Playlist[] = [
  {
    id: "preview-playlist",
    name: "Descida",
    coverPath: null,
    loopMode: "playlist",
    createdAt: 1,
    trackIds: ["preview-1", "preview-2"],
  },
]

const previewCover =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#000000"/><circle cx="28" cy="24" r="18" fill="#2a2a2a"/><circle cx="52" cy="56" r="20" fill="#f5f5f5"/></svg>',
  )

export function previewSearch(title: string, artist: string): SearchReport {
  return {
    hits: [
      {
        title: title.trim() || "Eurídice",
        artist: artist.trim() || "Orfeus",
        album: "Rachadura",
        coverUrl: previewCover,
        lyrics: "Desci cantando até onde a luz se rompe.\nCada rachadura acendia um verso.",
        syncedLyrics: "[00:01.20]Desci cantando até onde a luz se rompe.\n[00:06.40]Cada rachadura acendia um verso.",
      },
    ],
    lookups: [
      { field: "metadata", outcome: "found", detail: "1 catalog match." },
      { field: "cover", outcome: "found", detail: "Cover art was saved from the catalog." },
      { field: "lyrics", outcome: "found", detail: "Timed lyrics are available." },
    ],
  }
}
