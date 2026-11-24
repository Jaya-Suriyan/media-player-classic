import path from "node:path";
import { parseFile } from "music-metadata";

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

/**
 * Read ID3 / Vorbis / MP4 tags. Falls back to parsing the file name
 * ("Artist - Title.mp3", "01 - Title.mp3", "01. Title.mp3").
 */
export async function extractMetadata(filePath: string, originalName: string): Promise<ExtractedMeta> {
  const fromName = parseFileName(originalName);
  let common: Awaited<ReturnType<typeof parseFile>>["common"] | undefined;
  let duration: number | null = null;
  try {
    const meta = await parseFile(filePath, { duration: true, skipCovers: false });
    common = meta.common;
    duration = meta.format.duration ?? null;
  } catch {
    /* unreadable tags — rely on file name */
  }

  const pic = common?.picture?.[0];
  const lyricsTag = common?.lyrics?.[0] as unknown;
  const lyrics =
    typeof lyricsTag === "string" ? lyricsTag : (lyricsTag as { text?: string } | undefined)?.text ?? null;

  return {
    title: clean(common?.title) || fromName.title,
    artistName:
      clean(common?.artists?.length ? common.artists.join(", ") : common?.artist) ||
      clean(common?.albumartist) ||
      fromName.artist ||
      "Unknown Artist",
    albumTitle: clean(common?.album) || null,
    albumArtist: clean(common?.albumartist) || null,
    trackNo: common?.track?.no ?? fromName.track,
    discNo: common?.disk?.no ?? null,
    genre: clean(common?.genre?.[0]) || null,
    year: common?.year ?? null,
    duration,
    lyrics: realLyrics(lyrics),
    picture: pic ? { data: Buffer.from(pic.data), format: pic.format } : null,
  };
}

/**
 * Download sites stamp their domain into tags: "Song - MassTamilan.com",
 * "Album [www.site.in]", "(Starmusiq.com)". Strip those.
 */
const SITE = String.raw`(?:www\.)?[a-z0-9][a-z0-9-]*\.(?:com|net|org|in|co|info|io|me|cc|fm|tv|xyz|pk|lk|biz|cool|club|site|online|live|to|la|ws|mobi)(?:\.[a-z]{2})?`;
const WATERMARKS = [
  new RegExp(String.raw`\s*[\[(]\s*${SITE}\s*[\])]`, "gi"),
  new RegExp(String.raw`\s*(?:[-–—|:~]|::)\s*${SITE}\s*$`, "gi"),
  new RegExp(String.raw`^\s*${SITE}\s*(?:[-–—|:~]|::)\s*`, "gi"),
  new RegExp(String.raw`^\s*${SITE}\s*$`, "gi"),
];

/** Short "lyrics" that mention a website are download-site adverts, not lyrics. */
function realLyrics(text: string | null) {
  const t = text?.replace(/\u0000/g, "").trim();
  if (!t) return null;
  if (t.length < 300 && new RegExp(SITE, "i").test(t)) return null;
  return t;
}

export function clean(s: string | undefined | null) {
  let out = (s ?? "").replace(/\u0000/g, "").trim();
  for (const re of WATERMARKS) out = out.replace(re, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

export function parseFileName(name: string) {
  let base = clean(path.parse(name).name.replace(/_/g, " "));
  let track: number | null = null;
  const t = base.match(/^(\d{1,3})\s*[-.)]\s*(.+)$/);
  if (t) {
    track = Number(t[1]);
    base = t[2];
  }
  let artist: string | null = null;
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) {
    artist = parts[0].trim();
    base = parts.slice(1).join(" - ");
  }
  // "Un-Punnagai" → "Un Punnagai" only when it is clearly a slug (no spaces).
  const title = !base.includes(" ") ? base.replace(/-/g, " ") : base;
  return { title: title.trim() || "Untitled", artist, track };
}
