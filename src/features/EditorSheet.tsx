import { open } from "@tauri-apps/plugin-dialog"
import { useEffect, useRef, useState } from "react"
import { Cover } from "@/components/Cover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import * as api from "@/lib/api"
import type { FieldLookup, SearchHit } from "@/lib/types"
import { sourceKind } from "@/lib/format"
import { message } from "@/lib/utils"
import { useLibrary } from "@/stores/library"
import { usePlayer } from "@/stores/player"

export function EditorSheet() {
  const editingId = useLibrary((state) => state.editingId)
  const track = useLibrary((state) => state.tracks.find((item) => item.id === editingId))
  const setEditingId = useLibrary((state) => state.setEditingId)
  const updateTrack = useLibrary((state) => state.updateTrack)
  const searchMetadata = useLibrary((state) => state.searchMetadata)
  const fetchCover = useLibrary((state) => state.fetchCover)
  const [title, setTitle] = useState("")
  const [artist, setArtist] = useState("")
  const [album, setAlbum] = useState("")
  const [lyrics, setLyrics] = useState("")
  const [syncedLyrics, setSyncedLyrics] = useState("")
  const [gain, setGain] = useState(1)
  const [coverSource, setCoverSource] = useState<string | null>(null)
  const [clearCover, setClearCover] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [lookups, setLookups] = useState<FieldLookup[]>([])
  const [searching, setSearching] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const playingId = usePlayer((state) => state.trackId)
  const loadedId = useRef<string | null>(null)

  useEffect(() => {
    if (!editingId) {
      loadedId.current = null
      return
    }
    if (!track || loadedId.current === editingId) return
    loadedId.current = editingId
    setTitle(track.title)
    setArtist(track.artist)
    setAlbum(track.album)
    setLyrics(track.lyrics)
    setSyncedLyrics(track.syncedLyrics)
    setGain(track.gain)
    setCoverSource(null)
    setClearCover(false)
    setHits([])
    setLookups([])
    setLocalError(null)
  }, [editingId, track])

  const preview = clearCover ? null : coverSource ?? track?.coverPath ?? null

  async function chooseCover() {
    if (!api.desktop()) {
      setLocalError("Cover art is chosen in the desktop app.")
      return
    }
    const picked = await open({
      title: "Choose cover",
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"] }],
    })
    if (typeof picked !== "string") return
    setCoverSource(picked)
    setClearCover(false)
  }

  async function search() {
    setSearching(true)
    setLocalError(null)
    try {
      const found = await searchMetadata(title, artist)
      setHits(found.hits)
      setLookups(found.lookups)
    } catch (error) {
      setHits([])
      setLocalError(message(error))
    } finally {
      setSearching(false)
    }
  }

  async function applyHit(hit: SearchHit) {
    setTitle(hit.title)
    setArtist(hit.artist)
    setAlbum(hit.album)
    setLyrics(hit.lyrics ?? "")
    setSyncedLyrics(hit.syncedLyrics ?? "")
    if (hit.coverUrl) {
      const path = hit.coverUrl.startsWith("https://") ? await fetchCover(hit.coverUrl) : hit.coverUrl
      if (path) {
        setCoverSource(path)
        setClearCover(false)
      } else {
        setLocalError("The cover could not be saved.")
      }
    }
    setHits([])
  }

  async function save() {
    if (!track) return
    if (!title.trim()) {
      setLocalError("The title cannot be empty.")
      return
    }
    try {
      await updateTrack({
        id: track.id,
        title: title.trim(),
        artist: artist.trim(),
        album: album.trim(),
        lyrics,
        syncedLyrics,
        gain,
        coverSource,
        clearCover,
      })
      setEditingId(null)
    } catch (error) {
      setLocalError(message(error))
    }
  }

  return (
    <Sheet open={editingId != null} onOpenChange={(open) => !open && setEditingId(null)}>
      <SheetContent>
        <SheetTitle>Edit track</SheetTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {playingId && playingId === track?.id
            ? "This track is playing. Saving the artist, title, or cover updates the player without reopening the file."
            : "Changes stay in Orfeus. The original file changes only when you export."}
        </p>
        {!track ? <p className="mt-6 text-base text-muted-foreground">This track is no longer in the library.</p> : null}
        <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5 overflow-auto pr-1">
          <section className="glass space-y-3 rounded-2xl p-4">
            <h3 className="text-sm tracking-[0.16em] text-gold uppercase">Artwork</h3>
            <div className="flex items-end gap-3">
              <Cover path={preview} className="size-24 rounded-lg" />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void chooseCover()}>Cover</Button>
                <Button variant="ghost" size="sm" onClick={() => { setClearCover(true); setCoverSource(null) }}>Remove</Button>
              </div>
            </div>
          </section>
          <section className="glass space-y-3 rounded-2xl p-4">
            <h3 className="text-sm tracking-[0.16em] text-gold uppercase">Details</h3>
            <Field id="title" label="Title" value={title} onChange={setTitle} />
            <Field id="artist" label="Artist" value={artist} onChange={setArtist} />
            <Field id="album" label="Album" value={album} onChange={setAlbum} />
          </section>
          {track ? (
            <section className="glass space-y-2 rounded-2xl p-4">
              <h3 className="text-sm tracking-[0.16em] text-gold uppercase">Source</h3>
              <p className="text-base">{sourceKind(track)}</p>
              <p className="text-sm break-all text-muted-foreground">{track.path}</p>
            </section>
          ) : null}
          <section className="glass space-y-3 rounded-2xl p-4">
            <h3 className="text-sm tracking-[0.16em] text-gold uppercase">Track volume</h3>
            <Label htmlFor="gain">{Math.round(gain * 100)}% of the main volume</Label>
            <Slider id="gain" max={100} value={[Math.round(gain * 100)]} onValueChange={([value]) => setGain((value ?? 100) / 100)} aria-label="Track volume" />
          </section>
          <section className="glass space-y-3 rounded-2xl p-4">
            <h3 className="text-sm tracking-[0.16em] text-gold uppercase">Lyrics and sync</h3>
            <Button variant="secondary" onClick={() => void search()} disabled={searching}>
              {searching ? "Searching…" : "Search cover, lyrics, and sync"}
            </Button>
            {localError ? <p className="text-base text-pigment">{localError}</p> : null}
            {lookups.length ? (
              <ul className="space-y-1">
                {lookups.map((item) => (
                  <li key={item.field} className={item.outcome === "error" ? "text-sm text-pigment" : "text-sm text-muted-foreground"}>
                    <span className="text-foreground">{lookupLabel(item.field)}: </span>
                    {item.detail}
                  </li>
                ))}
              </ul>
            ) : null}
            {hits.length ? (
              <ul className="space-y-2">
                {hits.map((hit, index) => (
                  <li key={`${hit.title}-${index}`} className="rounded-lg border border-white/15 p-3">
                    <div className="flex gap-3">
                      <Cover path={hit.coverUrl} className="size-20 shrink-0 rounded-md" />
                      <div className="min-w-0">
                        <p className="text-base font-medium">{hit.title}</p>
                        <p className="text-sm text-muted-foreground">{hit.artist}{hit.album ? ` · ${hit.album}` : ""}</p>
                        <p className="mt-1 text-sm text-gold">{hit.syncedLyrics ? "Timed lyrics included" : hit.lyrics ? "Plain lyrics only" : "No lyrics in this match"}</p>
                        <Button className="mt-3" size="sm" onClick={() => void applyHit(hit)}>Use</Button>
                      </div>
                    </div>
                    {hit.lyrics ? <p className="mt-2 line-clamp-3 text-sm whitespace-pre-wrap">{hit.lyrics}</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="lyrics">Lyrics</Label>
              <Textarea id="lyrics" value={lyrics} onChange={(event) => setLyrics(event.target.value)} className="min-h-24" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="synced">Timed lyrics</Label>
              <Textarea id="synced" value={syncedLyrics} onChange={(event) => setSyncedLyrics(event.target.value)} className="min-h-24 font-mono text-sm" placeholder={"[00:12.00] first line"} />
              <p className="text-sm text-muted-foreground">Search fills this when LRCLIB has timestamps. You can also paste LRC or stamp lines on the stage.</p>
            </div>
          </section>
        </div>
        <Button className="mt-4" onClick={() => void save()}>Save</Button>
      </SheetContent>
    </Sheet>
  )
}

function lookupLabel(field: string) {
  if (field === "cover") return "Cover"
  if (field === "lyrics") return "Lyrics"
  return "Title and metadata"
}

function Field({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}
