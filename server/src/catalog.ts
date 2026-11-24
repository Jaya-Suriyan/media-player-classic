import type { Filter, Sort } from "mongodb";
import {
  albums,
  artists,
  GENRE_COLLATION,
  nameKey,
  newId,
  now,
  songs,
  type AlbumDoc,
  type ArtistDoc,
  type SongDoc,
  type SongStatus,
} from "./db.js";
import { storage } from "./storage/index.js";
import { buildSearchIndex, SEARCH_INDEX_VERSION } from "./search.js";

export type { SongDoc, SongStatus } from "./db.js";

export interface Cover {
  sm: string;
  lg: string;
}

export const clampLimit = (n: number | undefined, max = 200) => Math.min(Math.max(Number(n) || 50, 1), max);

/* ------------------------------------------------------------------ */
/* Search index                                                         */
/* ------------------------------------------------------------------ */

/** Album artist / composer name when the album was grouped by one. */
async function albumArtistName(album: AlbumDoc | null | undefined) {
  if (!album?.artistKey) return null;
  return (await artists.findOne({ _id: album.artistId }, { projection: { name: 1 } }))?.name ?? null;
}

/** Re-index songs whose search index is missing or from an older version. */
export async function reindexOutdatedSongs() {
  const cursor = songs.find(
    { "search.v": { $ne: SEARCH_INDEX_VERSION } },
    { projection: { title: 1, artistName: 1, albumId: 1, albumTitle: 1, genre: 1, lyrics: 1 } },
  );
  const albumCache = new Map<string, string | null>();
  let n = 0;
  for await (const d of cursor) {
    let albumArtist: string | null = null;
    if (d.albumId) {
      if (!albumCache.has(d.albumId)) albumCache.set(d.albumId, await albumArtistName(await albums.findOne({ _id: d.albumId })));
      albumArtist = albumCache.get(d.albumId) ?? null;
    }
    await songs.updateOne(
      { _id: d._id },
      { $set: { search: buildSearchIndex({ ...d, albumArtist }) } },
    );
    n++;
  }
  if (n) console.log(`[search] re-indexed ${n} song(s)`);
}

/* ------------------------------------------------------------------ */
/* Covers & serialisation                                               */
/* ------------------------------------------------------------------ */

export async function coverUrls(prefix: string | null | undefined): Promise<Cover | null> {
  if (!prefix) return null;
  const [sm, lg] = await Promise.all([storage.url(`${prefix}/sm.jpg`), storage.url(`${prefix}/lg.jpg`)]);
  return { sm, lg };
}

/** Album covers for a set of songs, fetched in one query. */
async function albumCovers(docs: SongDoc[]) {
  const ids = [...new Set(docs.filter((d) => !d.coverKey && d.albumId).map((d) => d.albumId!))];
  if (!ids.length) return new Map<string, string | null>();
  const rows = await albums.find({ _id: { $in: ids } }, { projection: { coverKey: 1 } }).toArray();
  return new Map(rows.map((r) => [r._id, r.coverKey]));
}

function publicShape(d: SongDoc, cover: Cover | null) {
  return {
    id: d._id,
    title: d.title,
    /** Primary artist (first credited). */
    artist: d.artists[0],
    artists: d.artists,
    album: d.albumId ? { id: d.albumId, title: d.albumTitle! } : null,
    trackNo: d.trackNo,
    discNo: d.discNo,
    genre: d.genre,
    year: d.year,
    duration: d.duration,
    cover,
    playCount: d.playCount,
    hasLyrics: !!d.lyrics,
    createdAt: d.createdAt,
  };
}

function adminShape(d: SongDoc, cover: Cover | null) {
  return {
    ...publicShape(d, cover),
    lyrics: d.lyrics,
    status: d.status,
    error: d.error,
    originalName: d.originalName,
    originalSize: d.originalSize,
    updatedAt: d.updatedAt,
  };
}

async function withCovers<T>(docs: SongDoc[], shape: (d: SongDoc, c: Cover | null) => T): Promise<T[]> {
  const covers = await albumCovers(docs);
  return Promise.all(
    docs.map(async (d) => shape(d, await coverUrls(d.coverKey ?? (d.albumId ? covers.get(d.albumId) : null)))),
  );
}

export const publicSongs = (docs: SongDoc[]) => withCovers(docs, publicShape);
export const adminSongs = (docs: SongDoc[]) => withCovers(docs, adminShape);
export const publicSong = async (d: SongDoc) => (await publicSongs([d]))[0];
export const adminSong = async (d: SongDoc) => (await adminSongs([d]))[0];

/* ------------------------------------------------------------------ */
/* Artists & albums                                                     */
/* ------------------------------------------------------------------ */

/**
 * Split a credit like "S.P.Bala, Swarnalatha feat. X" into individual artists.
 * Admins can always fix edge cases (e.g. a band name containing "&") by editing.
 */
export function splitArtists(credit: string): string[] {
  const parts = credit
    .split(/\s*(?:,|;|\s&\s|\s+(?:feat\.?|ft\.?|featuring|x)\s+)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts.length ? parts : ["Unknown Artist"]) {
    const k = nameKey(p);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out.slice(0, 12);
}

export async function getOrCreateArtist(name: string): Promise<ArtistDoc> {
  const clean = name.trim() || "Unknown Artist";
  const res = await artists.findOneAndUpdate(
    { nameKey: nameKey(clean) },
    { $setOnInsert: { _id: newId(), name: clean, imageKey: null, createdAt: now() } },
    { upsert: true, returnDocument: "after" },
  );
  return res!;
}

async function resolveArtists(credit: string) {
  const docs = [];
  for (const name of splitArtists(credit)) docs.push(await getOrCreateArtist(name));
  return docs.map((d) => ({ id: d._id, name: d.name }));
}

/**
 * Albums are grouped by title + album artist. Without an album-artist tag
 * (common for film soundtracks where every track has different singers) the
 * title alone groups them, so all tracks land in one album.
 */
export async function getOrCreateAlbum(
  title: string | null | undefined,
  opts: { albumArtist?: string | null; fallbackArtistId: string; year?: number | null },
) {
  const clean = title?.trim();
  if (!clean) return null;
  const albumArtist = opts.albumArtist?.trim() ? await getOrCreateArtist(opts.albumArtist) : null;
  const res = await albums.findOneAndUpdate(
    { titleKey: nameKey(clean), artistKey: albumArtist ? albumArtist.nameKey : "" },
    {
      $setOnInsert: {
        _id: newId(),
        title: clean,
        artistId: albumArtist?._id ?? opts.fallbackArtistId,
        year: opts.year ?? null,
        coverKey: null,
        createdAt: now(),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (res && !res.year && opts.year) await albums.updateOne({ _id: res._id }, { $set: { year: opts.year } });
  return res!;
}

/** Remove artists / albums that no longer have any songs. */
export async function cleanupOrphans(artistIds: string[], albumIds: (string | null)[]) {
  for (const id of new Set(albumIds)) {
    if (id && !(await songs.countDocuments({ albumId: id }, { limit: 1 }))) await albums.deleteOne({ _id: id });
  }
  for (const id of new Set(artistIds)) {
    const used =
      (await songs.countDocuments({ artistIds: id }, { limit: 1 })) ||
      (await albums.countDocuments({ artistId: id }, { limit: 1 }));
    if (!used) await artists.deleteOne({ _id: id });
  }
}

/* ------------------------------------------------------------------ */
/* Songs                                                                */
/* ------------------------------------------------------------------ */

export const getSong = (id: string) => songs.findOne({ _id: id });

export interface SongInput {
  title: string;
  /** One or more artists: "A, B feat. C". */
  artistName: string;
  albumTitle?: string | null;
  albumArtist?: string | null;
  trackNo?: number | null;
  discNo?: number | null;
  genre?: string | null;
  year?: number | null;
  duration?: number | null;
  lyrics?: string | null;
}

const displayCredit = (list: { name: string }[]) => list.map((a) => a.name).join(", ");

export async function createSong(
  id: string,
  input: SongInput,
  extra: Pick<SongDoc, "originalKey" | "originalName" | "originalSize">,
) {
  const credit = await resolveArtists(input.artistName);
  const album = await getOrCreateAlbum(input.albumTitle, {
    albumArtist: input.albumArtist,
    fallbackArtistId: credit[0].id,
    year: input.year,
  });
  const t = now();
  const base = {
    title: input.title.trim() || "Untitled",
    artistName: displayCredit(credit),
    albumTitle: album?.title ?? null,
    genre: input.genre?.trim() || null,
  };
  const doc: SongDoc = {
    _id: id,
    ...base,
    artists: credit,
    artistIds: credit.map((a) => a.id),
    albumId: album?._id ?? null,
    trackNo: input.trackNo ?? null,
    discNo: input.discNo ?? null,
    year: input.year ?? null,
    duration: input.duration ?? null,
    lyrics: input.lyrics ?? null,
    coverKey: null,
    hlsKey: null,
    status: "pending",
    error: null,
    playCount: 0,
    createdAt: t,
    updatedAt: t,
    search: buildSearchIndex({
      ...base,
      albumArtist: input.albumArtist?.trim() || (await albumArtistName(album)),
      lyrics: input.lyrics ?? null,
    }),
    ...extra,
  };
  await songs.insertOne(doc);
  return doc;
}

export type SongPatch = Partial<SongInput>;

export async function updateSong(id: string, patch: SongPatch) {
  const cur = await getSong(id);
  if (!cur) return null;
  const credit = patch.artistName !== undefined ? await resolveArtists(patch.artistName) : cur.artists;
  const albumTitle = patch.albumTitle !== undefined ? patch.albumTitle : cur.albumTitle;
  const year = patch.year !== undefined ? patch.year : cur.year;

  // Keep the current album-artist grouping unless a new one is given.
  let albumArtist = patch.albumArtist;
  if (albumArtist === undefined && cur.albumId) {
    const curAlbum = await albums.findOne({ _id: cur.albumId });
    if (curAlbum?.artistKey) albumArtist = (await artists.findOne({ _id: curAlbum.artistId }))?.name ?? null;
  }
  const album = await getOrCreateAlbum(albumTitle, { albumArtist, fallbackArtistId: credit[0].id, year });

  const base = {
    title: (patch.title ?? cur.title).trim() || "Untitled",
    artistName: displayCredit(credit),
    albumTitle: album?.title ?? null,
    genre: patch.genre !== undefined ? patch.genre?.trim() || null : cur.genre,
  };
  const lyrics = patch.lyrics !== undefined ? patch.lyrics : cur.lyrics;
  const next = await songs.findOneAndUpdate(
    { _id: id },
    {
      $set: {
        ...base,
        artists: credit,
        artistIds: credit.map((a) => a.id),
        albumId: album?._id ?? null,
        trackNo: patch.trackNo !== undefined ? patch.trackNo : cur.trackNo,
        discNo: patch.discNo !== undefined ? patch.discNo : cur.discNo,
        year,
        lyrics,
        updatedAt: now(),
        search: buildSearchIndex({ ...base, albumArtist: await albumArtistName(album), lyrics }),
      },
    },
    { returnDocument: "after", projection: { search: 0 } },
  );
  await cleanupOrphans(cur.artistIds, [cur.albumId]);
  return next as SongDoc | null;
}

export async function setSongFields(
  id: string,
  fields: Partial<Pick<SongDoc, "status" | "error" | "hlsKey" | "duration" | "coverKey" | "originalKey">>,
) {
  await songs.updateOne({ _id: id }, { $set: { ...fields, updatedAt: now() } });
}

export async function deleteSongDoc(d: SongDoc) {
  await songs.deleteOne({ _id: d._id });
  await cleanupOrphans(d.artistIds, [d.albumId]);
}

/* ------------------------------------------------------------------ */
/* Queries                                                              */
/* ------------------------------------------------------------------ */

export async function listSongs(opts: {
  sort?: "new" | "popular" | "title";
  limit?: number;
  offset?: number;
  genre?: string;
}) {
  const filter: Filter<SongDoc> = { status: "ready" };
  if (opts.genre) filter.genre = opts.genre;
  const sort: Sort =
    opts.sort === "popular" ? { playCount: -1, createdAt: -1 } : opts.sort === "title" ? { title: 1 } : { createdAt: -1 };
  return songs
    .find(filter, { projection: { search: 0 }, ...(opts.genre ? { collation: GENRE_COLLATION } : {}) })
    .sort(sort)
    .skip(opts.offset ?? 0)
    .limit(clampLimit(opts.limit))
    .toArray() as Promise<SongDoc[]>;
}

/** Fetch songs by id, preserving the requested order. */
export async function songsByIds(ids: string[], onlyReady = true) {
  if (!ids.length) return [];
  const rows = await songs
    .find({ _id: { $in: ids }, ...(onlyReady ? { status: "ready" as const } : {}) }, { projection: { search: 0 } })
    .toArray();
  const byId = new Map(rows.map((r) => [r._id, r as SongDoc]));
  return ids.map((id) => byId.get(id)).filter((r): r is SongDoc => !!r);
}

export const albumSongs = (albumId: string) =>
  songs
    .find({ albumId, status: "ready" }, { projection: { search: 0 } })
    .sort({ discNo: 1, trackNo: 1, title: 1 })
    .toArray() as Promise<SongDoc[]>;

export const artistSongs = (artistId: string, limit = 100) =>
  songs
    .find({ artistIds: artistId, status: "ready" }, { projection: { search: 0 } })
    .sort({ playCount: -1, createdAt: -1 })
    .limit(clampLimit(limit, 500))
    .toArray() as Promise<SongDoc[]>;

/* Artists ------------------------------------------------------------ */

interface ArtistAgg {
  _id: string;
  songCount: number;
  plays: number;
  coverKey: string | null;
}

/** Song stats per artist (only ready songs). */
async function artistStats(match: Filter<SongDoc>, sort: Record<string, 1 | -1>, skip: number, limit: number) {
  return songs
    .aggregate<ArtistAgg>([
      { $match: { ...match, status: "ready" } },
      { $sort: { playCount: -1 } },
      { $unwind: "$artistIds" },
      ...(match.artistIds ? [{ $match: { artistIds: match.artistIds } }] : []),
      {
        $group: {
          _id: "$artistIds",
          songCount: { $sum: 1 },
          plays: { $sum: "$playCount" },
          coverKey: { $first: "$coverKey" },
        },
      },
      { $sort: sort },
      { $skip: skip },
      { $limit: limit },
    ])
    .toArray();
}

async function toPublicArtists(stats: ArtistAgg[]) {
  const docs = await artists.find({ _id: { $in: stats.map((s) => s._id) } }).toArray();
  const byId = new Map(docs.map((d) => [d._id, d]));
  return Promise.all(
    stats
      .filter((s) => byId.has(s._id))
      .map(async (s) => {
        const a = byId.get(s._id)!;
        return { id: a._id, name: a.name, songCount: s.songCount, image: await coverUrls(a.imageKey ?? s.coverKey) };
      }),
  );
}

export async function listArtists(limit = 50, offset = 0, sort: "popular" | "name" = "popular") {
  if (sort === "name") {
    const docs = await artists.find().sort({ nameKey: 1 }).skip(offset).limit(clampLimit(limit)).toArray();
    const stats = await artistStats({ artistIds: { $in: docs.map((d) => d._id) } }, { _id: 1 }, 0, docs.length || 1);
    const byId = new Map(stats.map((s) => [s._id, s]));
    return toPublicArtists(docs.map((d) => byId.get(d._id)).filter((s): s is ArtistAgg => !!s));
  }
  return toPublicArtists(await artistStats({}, { plays: -1, songCount: -1, _id: 1 }, offset, clampLimit(limit)));
}

export async function getArtists(ids: string[]) {
  if (!ids.length) return [];
  const list = await toPublicArtists(await artistStats({ artistIds: { $in: ids } }, { _id: 1 }, 0, ids.length));
  const byId = new Map(list.map((a) => [a.id, a]));

  // Album artists / composers with no songs credited to them directly.
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    const theirAlbums = await albums.find({ artistId: { $in: missing } }).toArray();
    const docs = await artists.find({ _id: { $in: missing } }).toArray();
    for (const a of docs) {
      const albumIds = theirAlbums.filter((al) => al.artistId === a._id).map((al) => al._id);
      if (!albumIds.length) continue;
      const songCount = await songs.countDocuments({ albumId: { $in: albumIds }, status: "ready" });
      if (!songCount) continue;
      const cover = theirAlbums.find((al) => al.artistId === a._id && al.coverKey)?.coverKey ?? null;
      byId.set(a._id, { id: a._id, name: a.name, songCount, image: await coverUrls(a.imageKey ?? cover) });
    }
  }
  return ids.map((id) => byId.get(id)).filter((a) => !!a);
}

/** Songs credited to an artist, or (for composers / album artists) the songs on their albums. */
export async function artistOrAlbumArtistSongs(artistId: string, limit = 200) {
  const credited = await artistSongs(artistId, limit);
  if (credited.length) return credited;
  const albumIds = (await albums.find({ artistId }, { projection: { _id: 1 } }).toArray()).map((a) => a._id);
  if (!albumIds.length) return [];
  return songs
    .find({ albumId: { $in: albumIds }, status: "ready" }, { projection: { search: 0 } })
    .sort({ playCount: -1, createdAt: -1 })
    .limit(clampLimit(limit, 500))
    .toArray() as Promise<SongDoc[]>;
}

/* Albums ------------------------------------------------------------- */

async function toPublicAlbums(docs: AlbumDoc[]) {
  if (!docs.length) return [];
  const ids = docs.map((d) => d._id);
  const [counts, artistDocs] = await Promise.all([
    songs
      .aggregate<{ _id: string; n: number; coverKey: string | null }>([
        { $match: { albumId: { $in: ids }, status: "ready" } },
        { $group: { _id: "$albumId", n: { $sum: 1 }, coverKey: { $max: "$coverKey" } } },
      ])
      .toArray(),
    artists.find({ _id: { $in: [...new Set(docs.map((d) => d.artistId))] } }).toArray(),
  ]);
  const countBy = new Map(counts.map((c) => [c._id, c]));
  const artistBy = new Map(artistDocs.map((a) => [a._id, a.name]));
  return Promise.all(
    docs
      .filter((d) => countBy.has(d._id))
      .map(async (d) => ({
        id: d._id,
        title: d.title,
        artist: { id: d.artistId, name: artistBy.get(d.artistId) ?? "Unknown Artist" },
        year: d.year,
        songCount: countBy.get(d._id)!.n,
        cover: await coverUrls(d.coverKey ?? countBy.get(d._id)!.coverKey),
      })),
  );
}

export async function listAlbums(opts: { limit?: number; offset?: number; artistId?: string }) {
  // Only albums that have at least one playable song.
  const ready = (await songs.distinct("albumId", {
    status: "ready",
    albumId: { $ne: null },
    ...(opts.artistId ? { artistIds: opts.artistId } : {}),
  })) as string[];
  // An artist's albums also include the ones they are the album artist of.
  const filter = opts.artistId
    ? {
        $or: [
          { _id: { $in: ready } },
          { artistId: opts.artistId, _id: { $in: (await songs.distinct("albumId", { status: "ready" })) as string[] } },
        ],
      }
    : { _id: { $in: ready } };
  const docs = await albums
    .find(filter)
    .sort({ year: -1, createdAt: -1 })
    .skip(opts.offset ?? 0)
    .limit(clampLimit(opts.limit))
    .toArray();
  return toPublicAlbums(docs);
}

export async function getAlbums(ids: string[]) {
  if (!ids.length) return [];
  const list = await toPublicAlbums(await albums.find({ _id: { $in: ids } }).toArray());
  const byId = new Map(list.map((a) => [a.id, a]));
  return ids.map((id) => byId.get(id)).filter((a) => !!a);
}

export async function listGenres() {
  const rows = await songs
    .aggregate<{ _id: string; count: number }>(
      [
        { $match: { status: "ready", genre: { $nin: [null, ""] } } },
        { $group: { _id: "$genre", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 30 },
      ],
      { collation: GENRE_COLLATION },
    )
    .toArray();
  return rows.map((r) => ({ genre: r._id, count: r.count }));
}

export async function incrementPlay(id: string) {
  const r = await songs.updateOne({ _id: id, status: "ready" }, { $inc: { playCount: 1 } });
  return r.matchedCount > 0;
}
