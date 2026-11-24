import path from "node:path";
import { parseFile } from "music-metadata";
import { clean, realLyrics } from "./clean.js";
import { cleanAlbumTitle, cleanArtistCredit, cleanSongTitle, isMeaningfulTitle } from "./title.js";

export { clean } from "./clean.js";

export interface ExtractedMeta {
  title: string;
  artistName: string;
  albumTitle: string | null;
  albumArtist: string | null;
  trackNo: number | null;
  discNo: number | null;
  genre: string | null;
  year: number | null;
  duration: number | null;
  lyrics: string | null;
  picture: { data: Buffer; format: string } | null;
}

export interface NameLookup {
  /** Is this an artist already in the library? Used to read "Artist - Song" file names correctly. */
  isKnownArtist?: (name: string) => Promise<boolean>;
}

/**
 * Read ID3 / Vorbis / MP4 tags, falling back to the file name. Titles from
 * either source are cleaned: track numbers ("1001. "), movie names
 * ("Movie - Song", "(From Movie)"), bitrate / "Official Audio" noise and
 * download-site watermarks are removed; a movie name found there becomes
 * the album when the tags have none.
 */
export async function extractMetadata(filePath: string, originalName: string, lookup: NameLookup = {}): Promise<ExtractedMeta> {
  let common: Awaited<ReturnType<typeof parseFile>>["common"] | undefined;
  let duration: number | null = null;
  try {
    const meta = await parseFile(filePath, { duration: true, skipCovers: false });
    common = meta.common;
    duration = meta.format.duration ?? null;
  } catch {
    /* unreadable tags — rely on file name */
  }

  // Spam credits ("EelamMp3.Com, TamilGood.Com Free … Mp3 Songs") are dropped.
  const tagArtist = cleanArtistCredit(common?.artists?.length ? common.artists.join(", ") : common?.artist);
  const tagAlbumArtist = cleanArtistCredit(common?.albumartist);
  const tagAlbum = cleanAlbumTitle(common?.album) ?? "";
  const ctx = {
    album: tagAlbum || null,
    artists: [...tagArtist.split(/\s*[,&;]\s*/), tagAlbumArtist].filter(Boolean),
  };

  const fromName = cleanSongTitle(path.parse(originalName).name, ctx);
  // Title tags that are just "008" / "Track 3" are ignored in favour of the file name.
  const fromTag = isMeaningfulTitle(common?.title) ? cleanSongTitle(common!.title!, ctx) : null;
  if (fromTag && !isMeaningfulTitle(fromTag.title)) fromTag.title = fromName.title;
  const best = fromTag ?? fromName;

  // "X - Song" where X is unknown: an existing artist → artist, otherwise → movie / album.
  let artistGuess: string | null = best.artist ?? fromName.artist;
  let albumGuess: string | null = best.album ?? fromName.album;
  const prefix = best.unknownPrefix ?? fromName.unknownPrefix;
  if (prefix) {
    if (!tagArtist && lookup.isKnownArtist && (await lookup.isKnownArtist(prefix))) artistGuess ??= prefix;
    else albumGuess ??= prefix;
  }

  const pic = common?.picture?.[0];
  const lyricsTag = common?.lyrics?.[0] as unknown;
  const lyrics =
    typeof lyricsTag === "string" ? lyricsTag : (lyricsTag as { text?: string } | undefined)?.text ?? null;

  return {
    title: best.title,
    artistName: tagArtist || tagAlbumArtist || artistGuess || "Unknown Artist",
    albumTitle: tagAlbum || cleanAlbumTitle(albumGuess) || null,
    albumArtist: tagAlbumArtist || null,
    trackNo: common?.track?.no ?? best.track ?? fromName.track,
    discNo: common?.disk?.no ?? null,
    genre: clean(common?.genre?.[0]) || null,
    year: common?.year ?? best.year ?? fromName.year,
    duration,
    lyrics: realLyrics(lyrics),
    picture: pic ? { data: Buffer.from(pic.data), format: pic.format } : null,
  };
}
