/**
 * Find & replace in song details.
 *
 *  - Case-insensitive. "exact" matches the whole value; for artists each
 *    credited artist is matched on its own, so in "S.P.Bala, Swarnalatha"
 *    you can replace just "S.P.Bala".
 *  - "contains" replaces the text wherever it appears inside the value.
 *  - An empty replacement removes the value (for artists: removes that one
 *    artist from the credit).
 *  - Album and album artist belong to the album, so those changes apply to
 *    every song on the affected albums.
 */
import type { Filter } from "mongodb";
import { albums, artists, escapeRegex, nameKey, now, songs, type AlbumDoc, type SongDoc } from "../db.js";
import { cleanupOrphans, getOrCreateArtist, reindexOutdatedSongs, splitArtists, updateSong } from "../catalog.js";
import { renameAlbum } from "./fix-titles.js";

export type ReplaceField = "artist" | "title" | "album" | "albumArtist" | "genre";
export type ReplaceMode = "exact" | "contains";

export interface ReplaceRequest {
  field: ReplaceField;
  find: string;
  replace: string;
  mode: ReplaceMode;
  /** Limit to these songs (album-level fields widen to their whole albums). */
  ids?: string[];
}

export interface ReplaceChange {
  id: string;
  title: string;
  from: string;
  to: string;
}

const MAX_PREVIEW = 1000;

/** Replace inside a single value. Returns the value unchanged when it does not match. */
function replaceValue(value: string, req: ReplaceRequest): string {
  if (req.mode === "exact") return nameKey(value) === nameKey(req.find) ? req.replace.trim() : value;
  const re = new RegExp(escapeRegex(req.find.trim()), "gi");
  return value.replace(re, () => req.replace).replace(/\s{2,}/g, " ").trim();
}

/** Mongo regex that finds candidate values (exact or contains), case-insensitive. */
function candidateRegex(req: ReplaceRequest) {
  const esc = escapeRegex(req.find.trim()).replace(/\s+/g, "\\s+");
  return new RegExp(req.mode === "exact" ? `^\\s*${esc}\\s*$` : esc, "i");
}

/** New artist credit with matching artists replaced (or removed). */
function replaceInCredit(d: SongDoc, req: ReplaceRequest) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of d.artists) {
    const next = replaceValue(a.name, req);
    // A replacement may itself be several artists: "A, B".
    for (const name of next ? splitArtists(next) : []) {
      const k = nameKey(name);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(name);
      }
    }
  }
  return out.join(", ");
}

function scopeFilter(req: ReplaceRequest): Filter<SongDoc> {
  return req.ids?.length ? { _id: { $in: req.ids } } : {};
}

interface Plan {
  changes: ReplaceChange[];
  total: number;
  albumWide: boolean;
  /** Internal: what to do on apply. */
  run: () => Promise<number>;
}

async function planSongField(req: ReplaceRequest): Promise<Plan> {
  const re = candidateRegex(req);
  let docs: SongDoc[];
  if (req.field === "artist") {
    const matches = await artists.find({ name: re }, { projection: { _id: 1 } }).toArray();
    docs = matches.length
      ? ((await songs
          .find({ ...scopeFilter(req), artistIds: { $in: matches.map((m) => m._id) } }, { projection: { search: 0, lyrics: 0 } })
          .toArray()) as SongDoc[])
      : [];
  } else {
    const key = req.field === "title" ? "title" : "genre";
    docs = (await songs.find({ ...scopeFilter(req), [key]: re }, { projection: { search: 0, lyrics: 0 } }).toArray()) as SongDoc[];
  }

  const changes: (ReplaceChange & { value: string })[] = [];
  for (const d of docs) {
    if (req.field === "artist") {
      const next = replaceInCredit(d, req);
      if (next !== d.artistName) changes.push({ id: d._id, title: d.title, from: d.artistName, to: next || "Unknown Artist", value: next || "Unknown Artist" });
    } else if (req.field === "title") {
      const next = replaceValue(d.title, req);
      // A song must keep a title.
      if (next && next !== d.title) changes.push({ id: d._id, title: d.title, from: d.title, to: next, value: next });
    } else {
      const cur = d.genre ?? "";
      const next = replaceValue(cur, req);
      if (next !== cur) changes.push({ id: d._id, title: d.title, from: cur, to: next || "—", value: next });
    }
  }

  return {
    changes: changes.slice(0, MAX_PREVIEW).map(({ value: _v, ...c }) => c),
    total: changes.length,
    albumWide: false,
    run: async () => {
      // Only the letter case changes ("spb" → "SPB"): rename the artist itself so it keeps its id and links.
      if (req.field === "artist" && req.mode === "exact" && req.replace.trim() && nameKey(req.replace) === nameKey(req.find)) {
        await artists.updateOne({ nameKey: nameKey(req.find) }, { $set: { name: req.replace.trim() } });
      }
      for (const c of changes) {
        if (req.field === "artist") await updateSong(c.id, { artistName: c.value });
        else if (req.field === "title") await updateSong(c.id, { title: c.value });
        else await updateSong(c.id, { genre: c.value || null });
      }
      return changes.length;
    },
  };
}

/** Albums in scope whose title / album artist matches. */
async function matchingAlbums(req: ReplaceRequest): Promise<{ album: AlbumDoc; artistName: string | null }[]> {
  const re = candidateRegex(req);
  const scopeAlbumIds = req.ids?.length
    ? ((await songs.distinct("albumId", { _id: { $in: req.ids }, albumId: { $ne: null } })) as string[])
    : null;
  const scope = scopeAlbumIds ? { _id: { $in: scopeAlbumIds } } : {};
  if (req.field === "album") {
    const list = await albums.find({ ...scope, title: re }).toArray();
    return list.map((album) => ({ album, artistName: null }));
  }
  const matchArtists = await artists.find({ name: re }).toArray();
  const byId = new Map(matchArtists.map((a) => [a._id, a.name]));
  // Only albums grouped by an album artist (artistKey set) have one to replace.
  const list = await albums.find({ ...scope, artistKey: { $ne: "" }, artistId: { $in: [...byId.keys()] } }).toArray();
  return list.map((album) => ({ album, artistName: byId.get(album.artistId) ?? null }));
}

/** Point an album at a different album artist (or none), merging with an existing album if needed. */
async function setAlbumArtist(album: AlbumDoc, name: string) {
  const oldArtistId = album.artistId;
  let artistId: string;
  let artistKey: string;
  if (name) {
    if (nameKey(name) === album.artistKey) {
      // Case-only change: rename the artist itself.
      await artists.updateOne({ _id: album.artistId }, { $set: { name } });
      artistId = album.artistId;
    } else {
      artistId = (await getOrCreateArtist(name))._id;
    }
    artistKey = nameKey(name);
  } else {
    const first = await songs.findOne({ albumId: album._id }, { projection: { artistIds: 1 } });
    artistId = first?.artistIds[0] ?? album.artistId;
    artistKey = "";
  }
  const clash = await albums.findOne({ _id: { $ne: album._id }, titleKey: album.titleKey, artistKey });
  if (clash) {
    await songs.updateMany({ albumId: album._id }, { $set: { albumId: clash._id, albumTitle: clash.title, updatedAt: now() } });
    if (!clash.coverKey && album.coverKey) await albums.updateOne({ _id: clash._id }, { $set: { coverKey: album.coverKey } });
    await albums.deleteOne({ _id: album._id });
    await songs.updateMany({ albumId: clash._id }, { $set: { "search.v": 0 } });
  } else {
    await albums.updateOne({ _id: album._id }, { $set: { artistId, artistKey } });
    await songs.updateMany({ albumId: album._id }, { $set: { "search.v": 0, updatedAt: now() } });
  }
  await cleanupOrphans([oldArtistId], []);
}

async function planAlbumField(req: ReplaceRequest): Promise<Plan> {
  const matches = await matchingAlbums(req);
  const albumPlans: { album: AlbumDoc; from: string; to: string }[] = [];
  for (const { album, artistName } of matches) {
    const from = req.field === "album" ? album.title : (artistName ?? "");
    const to = replaceValue(from, req);
    if (to !== from) albumPlans.push({ album, from, to });
  }
  const affected = albumPlans.length
    ? ((await songs
        .find({ albumId: { $in: albumPlans.map((p) => p.album._id) } }, { projection: { title: 1, albumId: 1 } })
        .toArray()) as Pick<SongDoc, "_id" | "title" | "albumId">[])
    : [];
  const byAlbum = new Map(albumPlans.map((p) => [p.album._id, p]));
  const changes = affected.map((s) => {
    const p = byAlbum.get(s.albumId!)!;
    return { id: s._id, title: s.title, from: p.from, to: p.to || "—" };
  });

  return {
    changes: changes.slice(0, MAX_PREVIEW),
    total: changes.length,
    albumWide: true,
    run: async () => {
      for (const p of albumPlans) {
        if (req.field === "album") {
          if (p.to) await renameAlbum(p.album._id, p.to);
          else {
            // Empty album name: songs no longer belong to an album.
            const ids = affected.filter((s) => s.albumId === p.album._id).map((s) => s._id);
            for (const id of ids) await updateSong(id, { albumTitle: null });
          }
        } else {
          await setAlbumArtist(p.album, p.to);
        }
      }
      await reindexOutdatedSongs();
      return changes.length;
    },
  };
}

function plan(req: ReplaceRequest) {
  return req.field === "album" || req.field === "albumArtist" ? planAlbumField(req) : planSongField(req);
}

export async function previewReplace(req: ReplaceRequest) {
  const p = await plan(req);
  return { changes: p.changes, total: p.total, albumWide: p.albumWide };
}

export async function applyReplace(req: ReplaceRequest) {
  const p = await plan(req);
  return { updated: await p.run() };
}
