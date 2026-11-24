/**
 * Turn messy file names / title tags into a clean song name.
 *
 *   "1001. Lux Papa"                         → "Lux Papa"
 *   "01 - Ezhumalai - Lux Papa"              → "Lux Papa"         (album: Ezhumalai)
 *   "Ezhumalai - Lux Papa [320kbps]"         → "Lux Papa"         (album: Ezhumalai)
 *   "Lux Papa (From \"Ezhumalai\")"          → "Lux Papa"         (album: Ezhumalai)
 *   "Ezhumalai (2002) - Lux Papa"            → "Lux Papa"         (album: Ezhumalai, year: 2002)
 *   "lux_papa"                               → "Lux Papa"
 *   "Mr. Brightside - Live"                  → "Mr. Brightside (Live)"
 *   "7 Rings", "99 Problems"                 → unchanged (numbers that are part of the name)
 */

import { nameKey } from "../db.js";
import { splitArtists } from "../catalog.js";
import { clean, SITE } from "./clean.js";

export interface TitleContext {
  /** Album / movie name from tags, if any. */
  album?: string | null;
  /** Artist names from tags, if any. */
  artists?: string[];
}

export interface CleanTitle {
  title: string;
  /** Movie / album name found in the text (e.g. "Movie - Song", "(From Movie)"). */
  album: string | null;
  /** Artist name found in the text, when it matched a known artist. */
  artist: string | null;
  year: number | null;
  track: number | null;
  /** Leftover leading part we could not identify ("X - Song"): movie or artist. */
  unknownPrefix: string | null;
}

/**
 * Leading track numbers: "1001. ", "01 - ", "01_", "(01) ", "[01] ", "Track 01 - ", "CD1-01 ",
 * "01 " / "105 " (zero padded or 3 digits, then a space), "021SONG" (glued to the name).
 * Plain short numbers stay: "7 Rings", "99 Problems".
 */
const LEADING_TRACK =
  /^\s*(?:(?:track|trk|no\.?)\s*)?(?:cd\s*\d+\s*[-._]?\s*)?(?:[([]\s*(\d{1,4})\s*[)\]]\s*[-._]?\s*|(\d{1,4})\s*(?:[-._)]|\s-\s)\s*|(0\d{1,3}|\d{3})\s+|(0\d{1,3}|\d{3})(?=[a-z]))(?=\S)/i;

/** Bracketed or trailing noise that is never part of a song name. */
const NOISE = [
  /[([]\s*\d{2,3}\s*kbps\s*[)\]]/gi,
  /\b\d{2,3}\s*kbps\b/gi,
  /[([]\s*(?:hq|hd|4k|full\s*(?:song|audio|video)?|official(?:\s*(?:audio|video|lyric(?:al)?\s*video|music\s*video))?|lyric(?:al)?(?:\s*video)?|audio(?:\s*song)?|video(?:\s*song)?|mp3|original\s*motion\s*picture\s*soundtrack|o\.?s\.?t\.?|single|high\s*quality|new|latest)\s*[)\]]/gi,
  /\s*-\s*(?:full\s*song|full\s*audio|audio\s*song|video\s*song|official\s*(?:audio|video)|lyrical\s*video|lyric\s*video)\s*$/gi,
];

/** "(From "Movie")", "(From Movie)", "[From 'Movie']" */
const FROM_MOVIE = /\s*[([]\s*from\s+(?:the\s+(?:movie|film|album)\s+)?["“'‘]?([^"”'’)\]]+?)["”'’]?\s*[)\]]/i;

/** "(2002)" or "[2002]" */
const YEAR = /\s*[([]\s*((?:19|20)\d{2})\s*[)\]]/;

/** Trailing parts that describe a version of the song rather than a different name. */
const VERSION =
  /^(?:live|remix|remastered|(?:\d{4}\s*)?remaster(?:ed)?|acoustic|unplugged|reprise|edit|radio\s*edit|extended|instrumental|karaoke|cover|version|(?:sad|happy|female|male|duet|slow|club|dj|lofi|lo-fi|bgm|theme)(?:\s*version)?|.*\b(?:version|remix|mix|edit)\b.*)$/i;

/** Split "A - B", "A – B", "A | B", "A -B" but not "Un-Punnagai" (needs a space on one side). */
const SEPARATOR = /\s+[-–—|~]+\s*|\s*[-–—|~]+\s+|\s*_-_\s*/;

const isYearOnly = (s: string) => /^\(?(?:19|20)\d{2}\)?$/.test(s.trim());
const isNumberOnly = (s: string) => /^\d{1,4}$/.test(s.trim());

function sameName(a: string, b: string) {
  const x = nameKey(a).replace(/[^\p{L}\p{N}]/gu, "");
  const y = nameKey(b).replace(/[^\p{L}\p{N}]/gu, "");
  return !!x && !!y && (x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))));
}

/** Title-case names written ALL CAPS or all lower case ("lux papa" → "Lux Papa"). */
function fixCase(s: string) {
  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 3) return s;
  if (letters !== letters.toLowerCase() && letters !== letters.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s(\[-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

function stripTrack(s: string): { text: string; track: number | null } {
  const m = s.match(LEADING_TRACK);
  if (!m) return { text: s, track: null };
  const rest = s.slice(m[0].length).trim();
  if (!rest) return { text: s, track: null };
  const n = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
  // Big numbers ("1001. Song") are site serial numbers, not album track numbers.
  return { text: rest, track: n >= 1 && n <= 300 ? n : null };
}

/** Download-site spam that ends up in artist / album tags. */
const SPAM_WORDS =
  /\b(?:free|download(?:s|ed)?|\d{2,3}\s*kbps|kbps|mp3|rar|zip|high\s*quality|full\s*album|single\s*link|direct\s*link|torrent|isaimini|tamilrockers|masstamilan|starmusiq)\b/gi;

/** A website name, or two or more spam words ("Mp3 Songs Free"). "Free Bird" is fine. */
export function isSpam(s: string) {
  if (new RegExp(SITE, "i").test(s)) return true;
  const hits = new Set((s.match(SPAM_WORDS) ?? []).map((w) => w.toLowerCase().replace(/\s+/g, "")));
  return hits.size >= 2;
}

/**
 * Clean an artist credit: drop site names and spam ("EelamMp3.Com,
 * TamilGood.Com Free High Quality Tamil Mp3 Songs …"), keep real names.
 * Returns "" when nothing real is left.
 */
export function cleanArtistCredit(raw: string | null | undefined): string {
  // When the credit as a whole is spam, also drop fragments with a single spam word ("ZIP format").
  const strict = isSpam(raw ?? "");
  const oneSpamWord = new RegExp(SPAM_WORDS.source, "i");
  // "www.site.xyz - Uploader" : a leading site name means the rest is the uploader's tag, not an artist.
  const leadingSite = new RegExp(String.raw`^\s*${SITE}`, "i");
  const names = splitArtists((raw ?? "").replace(/\u0000/g, ""))
    .filter((n) => !leadingSite.test(n))
    .map((n) => clean(n).replace(/^[\s\-–—.,:;[\]()]+|[\s\-–—,:;[\]()]+$/g, ""))
    .filter((n) => n && n !== "Unknown Artist" && !isSpam(n) && !(strict && oneSpamWord.test(n)) && /\p{L}/u.test(n));
  return names.join(", ");
}

/** A title tag like "008", "Track 3" or "Untitled" carries no name: use the file name instead. */
export function isMeaningfulTitle(raw: string | null | undefined) {
  const s = clean(raw ?? "");
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) return false;
  return !/^(?:track|audio|untitled|unknown|new\s*recording|song)\s*[-_#.]?\s*\d*$/i.test(s);
}

/** "Super Hits Collections Vol-1 (105 Tamil Mp3 Songs) [320kbps]" → "Super Hits Collections Vol-1" */
export function cleanAlbumTitle(raw: string | null | undefined): string | null {
  let s = clean((raw ?? "").replace(/_/g, " "));
  // Whole album tag is an advert ("TamilGood.Com Free Mp3 Songs") → no album.
  if (isSpam(s.replace(/\s*[([][^)\]]*[)\]]/g, ""))) return null;
  s = s.replace(/\s*[([]\s*\d*\s*(?:(?:tamil|hindi|telugu|malayalam|kannada|english)\s*)?(?:mp3\s*)?songs?\s*[)\]]/gi, "");
  for (const re of NOISE) s = s.replace(re, "");
  s = s.replace(/\s{2,}/g, " ").replace(/^[\s\-–—.,:;]+|[\s\-–—,:;]+$/g, "").trim();
  return s ? fixCase(s) : null;
}

export function cleanSongTitle(raw: string, ctx: TitleContext = {}): CleanTitle {
  let s = clean(raw.replace(/_/g, " ").replace(/\s{2,}/g, " "));
  let album: string | null = null;
  let year: number | null = null;
  let artist: string | null = null;
  let unknownPrefix: string | null = null;

  const fromMovie = s.match(FROM_MOVIE);
  if (fromMovie) {
    album = fromMovie[1].trim();
    s = s.replace(FROM_MOVIE, "");
  }
  for (const re of NOISE) s = s.replace(re, "");

  const first = stripTrack(s);
  s = first.text;
  let track = first.track;

  let parts = s
    .split(SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    // Pull the year out of any part: "Movie (2002) - Song".
    parts = parts.map((p) => {
      const y = p.match(YEAR);
      if (y) {
        year = Number(y[1]);
        return p.replace(YEAR, "").trim();
      }
      return p;
    });
    // Drop parts that are just numbers / years ("Movie - 03 - Song").
    parts = parts.filter((p) => {
      if (isYearOnly(p)) {
        year ??= Number(p.replace(/\D/g, ""));
        return false;
      }
      if (isNumberOnly(p)) {
        track ??= Number(p);
        return false;
      }
      return !!p;
    });

    // Keep "Song - Live" together as "Song (Live)".
    let versionTag: string | null = null;
    if (parts.length >= 2 && VERSION.test(parts[parts.length - 1])) versionTag = parts.pop()!;

    // Remove parts that are the known album / artists.
    const known = parts.filter((p) => {
      if (ctx.album && sameName(p, ctx.album)) {
        album ??= p;
        return false;
      }
      const a = ctx.artists?.find((n) => sameName(p, n));
      if (a) {
        artist ??= p;
        return false;
      }
      return true;
    });
    const removedSomething = known.length < parts.length;
    if (known.length) parts = known;

    // Tags already tell us the album and artist, and neither appears here:
    // the dash is part of the real name ("Arabic Kuthu - Halamithi Habibo").
    const tagsKnown = !!ctx.album && !!ctx.artists?.length;
    if (parts.length >= 2 && tagsKnown && !removedSomething) {
      parts = [parts.join(" - ")];
    }

    if (parts.length >= 2) {
      // "Movie - Song" (most common for film music) / "Artist - Song": the song is last.
      unknownPrefix = parts.slice(0, -1).join(" - ");
      parts = [parts[parts.length - 1]];
    }
    s = parts.join(" - ");
    if (versionTag) s = `${s} (${versionTag})`;
  }

  // Track number after the movie name: "Movie - 01. Song".
  const second = stripTrack(s);
  s = second.text;
  track ??= second.track;

  // A remaining year in brackets is metadata, not the name.
  const y = s.match(YEAR);
  if (y && s.replace(YEAR, "").trim()) {
    year ??= Number(y[1]);
    s = s.replace(YEAR, "");
  }

  // Zero typed for the letter O: "P0NDICHERRY" → "PONDICHERRY".
  s = s.replace(/(?<=\p{L})0(?=\p{L})/gu, (_m, off: number, str: string) => (/\p{Lu}/u.test(str[off - 1]) ? "O" : "o"));

  // "Un-Punnagai" → "Un Punnagai" when the whole name is a dash slug.
  if (!/\s/.test(s) && /\p{L}-\p{L}/u.test(s)) s = s.replace(/-/g, " ");

  s = fixCase(s.replace(/\s{2,}/g, " ").replace(/^[\s\-–—.,:;]+|[\s\-–—,:;]+$/g, "").trim());
  return {
    title: s || "Untitled",
    album: album ? fixCase(album) : null,
    artist,
    year,
    track,
    unknownPrefix: unknownPrefix ? fixCase(unknownPrefix) : null,
  };
}
