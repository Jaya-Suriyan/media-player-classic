import path from "node:path";
import { albums, artists, nameKey, songs, type SongDoc } from "../db.js";
import { cleanupOrphans, reindexOutdatedSongs } from "../catalog.js";
import { updateSong } from "../catalog.js";
import { cleanAlbumTitle, cleanArtistCredit, cleanSongTitle, isMeaningfulTitle } from "./title.js";

export interface TitleChange {
  id: string;
  from: string;
  to: string;
  track: number | null;
  file: string | null;
  /** Set when the artist credit changes (spam removed). */
  artistFrom?: string;
  artistTo?: string;
}

export interface AlbumChange {
  id: string;
  from: string;
  to: string;
}

/**
 * Work out cleaner titles for songs that are already in the library:
 * titles that are only a number ("008") are rebuilt from the original file
 * name, others get the same clean-up as new uploads. Album names lose
 * "(105 Tamil Mp3 Songs)"-style noise.
 */
export async function planTitleFixes(ids?: string[]) {
  const filter = ids?.length ? { _id: { $in: ids } } : {};
  const docs = (await songs
    .find(filter, { projection: { lyrics: 0, "search.words": 0, "search.sound": 0, "search.skel": 0, "search.grams": 0, "search.lyr": 0 } })
    .limit(20_000)
    .toArray()) as SongDoc[];

  const changes: TitleChange[] = [];
  for (const d of docs) {
    // Artist credit without download-site spam; fall back to the album artist.
    const credit = cleanArtistCredit(d.artistName) || cleanArtistCredit(d.search?.albumArtist) || "Unknown Artist";
    const artistChanged = credit !== d.artistName;
    const ctx = { album: d.albumTitle, artists: credit.split(", ") };
    const fromFile = d.originalName ? cleanSongTitle(path.parse(d.originalName).name, ctx) : null;
    const proposed = isMeaningfulTitle(d.title)
      ? cleanSongTitle(d.title, ctx).title
      : fromFile && isMeaningfulTitle(fromFile.title)
        ? fromFile.title
        : null;
    const track = d.trackNo == null ? (fromFile?.track ?? null) : null;
    if ((proposed && proposed !== d.title && isMeaningfulTitle(proposed)) || track != null || artistChanged) {
      changes.push({
        id: d._id,
        from: d.title,
        to: proposed && isMeaningfulTitle(proposed) ? proposed : d.title,
        track,
        file: d.originalName,
        ...(artistChanged ? { artistFrom: d.artistName, artistTo: credit } : {}),
      });
    }
  }

  const albumIds = [...new Set(docs.map((d) => d.albumId).filter((x): x is string => !!x))];
  const albumChanges: AlbumChange[] = [];
  for (const a of await albums.find({ _id: { $in: albumIds } }).toArray()) {
    const to = cleanAlbumTitle(a.title);
    if (to && to !== a.title) albumChanges.push({ id: a._id, from: a.title, to });
  }
  return { changes, albums: albumChanges };
}

/** Rename an album; merges into an existing album of the same name and artist grouping. */
export async function renameAlbum(id: string, title: string) {
  const album = await albums.findOne({ _id: id });
  if (!album) return;
  const titleKey = nameKey(title);
  const clash = await albums.findOne({ _id: { $ne: id }, titleKey, artistKey: album.artistKey });
  const targetId = clash?._id ?? id;
  if (clash) {
    await songs.updateMany({ albumId: id }, { $set: { albumId: clash._id, albumTitle: clash.title } });
    if (!clash.coverKey && album.coverKey) await albums.updateOne({ _id: clash._id }, { $set: { coverKey: album.coverKey } });
    await albums.deleteOne({ _id: id });
  } else {
    await albums.updateOne({ _id: id }, { $set: { title, titleKey } });
    await songs.updateMany({ albumId: id }, { $set: { albumTitle: title } });
  }
  // Force a search re-index of the affected songs.
  await songs.updateMany({ albumId: targetId }, { $set: { "search.v": 0 } });
}

export async function applyTitleFixes(ids?: string[]) {
  const plan = await planTitleFixes(ids);
  for (const c of plan.changes) {
    await updateSong(c.id, {
      title: c.to,
      ...(c.track != null ? { trackNo: c.track } : {}),
      ...(c.artistTo ? { artistName: c.artistTo } : {}),
    });
  }
  for (const a of plan.albums) await renameAlbum(a.id, a.to);
  if (plan.albums.length) {
    await reindexOutdatedSongs();
    await cleanupOrphans((await artists.find({}, { projection: { _id: 1 } }).toArray()).map((x) => x._id), []);
  }
  return { songs: plan.changes.length, albums: plan.albums.length };
}
