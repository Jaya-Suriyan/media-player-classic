import { albums, artists, escapeRegex, songs, type SearchIndex, type SongDoc } from "./db.js";
import { dice, initials, paddedTrigrams, queryWords, skeleton, soundKey, tokenize, trigrams } from "./text.js";

/**
 * "Likely match" search that runs on any MongoDB (no Atlas Search needed).
 *
 * 1. Candidate retrieval (indexed): songs where any query word prefix-matches
 *    a word, sound-alike key or consonant skeleton, matches a lyric word, or
 *    shares trigrams with the query.
 * 2. Scoring (in memory): each query word is matched against every field
 *    (title > artist > album > album artist > genre > lyrics) with graded
 *    similarity: exact > prefix > sounds alike > contains > vowel slip > typo.
 *    Songs are ranked by how well and how many of the words matched, plus
 *    popularity. A song needs about half the words to match, so extra or
 *    unknown words ("lux papa arjun 2002") don't hide results.
 *
 * Examples that find "Lux Papa": luxpapa, lucks papa, lax papa, lux paapaa,
 * papa lux, lux papa song, lux pappa, luks.
 */

export const SEARCH_INDEX_VERSION = 3;

/* ------------------------------------------------------------------ */
/* Indexing                                                             */
/* ------------------------------------------------------------------ */

export interface IndexInput {
  title: string;
  artistName: string;
  albumTitle: string | null;
  albumArtist: string | null;
  genre: string | null;
  lyrics: string | null;
}

export function buildSearchIndex(d: IndexInput): SearchIndex {
  const artistNames = d.artistName.split(/\s*,\s*/);
  const words = new Set(
    tokenize([d.title, d.artistName, d.albumTitle ?? "", d.albumArtist ?? "", d.genre ?? ""].join(" ")),
  );
  const sound = new Set<string>();
  const skel = new Set<string>();
  const grams = new Set<string>();
  for (const w of words) {
    sound.add(soundKey(w));
    const sk = skeleton(w);
    if (sk) skel.add(sk);
    for (const g of trigrams(w)) grams.add(g);
  }
  // Title written without spaces ("luxpapa") shares these cross-word trigrams.
  for (const g of trigrams(tokenize(d.title).join(""))) grams.add(g);
  // Initials ("spb", "arr") are matched exactly only, never by sound or typo rules.
  for (const name of [...artistNames, d.albumArtist ?? ""]) {
    const ini = initials(name);
    if (ini.length >= 2) words.add(ini);
  }

  const lyr = new Set<string>();
  for (const w of tokenize(d.lyrics ?? "")) {
    if (w.length >= 3) lyr.add(w);
    if (lyr.size >= 400) break;
  }
  return {
    v: SEARCH_INDEX_VERSION,
    words: [...words],
    sound: [...sound],
    skel: [...skel],
    grams: [...grams],
    lyr: [...lyr],
    albumArtist: d.albumArtist,
  };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                              */
/* ------------------------------------------------------------------ */

interface Term {
  w: string;
  sound: string;
  skel: string;
  grams: Set<string>;
  /** Only an exact match counts (initials like "spb"). */
  exactOnly?: boolean;
}

const term = (w: string): Term => ({ w, sound: soundKey(w), skel: skeleton(w), grams: paddedTrigrams(w) });
const exactTerm = (w: string): Term => ({ w, sound: "", skel: "", grams: new Set(), exactOnly: true });

/** Similarity of a query word to one indexed word, 0..1. */
function wordSim(q: Term, f: Term): number {
  if (q.w === f.w) return 1;
  if (f.exactOnly) return 0;
  if (q.w.length >= 2 && f.w.startsWith(q.w)) return 0.92;
  // Sound-alike rules need a few letters to mean anything ("zzzz" → "s").
  if (q.w.length >= 3 && q.sound.length >= 2 && q.sound === f.sound) return 0.88;
  if (q.sound.length >= 3 && f.sound.startsWith(q.sound)) return 0.8;
  if (q.w.length >= 4 && f.w.includes(q.w)) return 0.6;
  // Vowel slips ("lax"→"lux"); short skeletons are too ambiguous ("roja"/"raja").
  if (q.skel.length >= 3 && q.skel === f.skel) return 0.7;
  const d = dice(q.grams, f.grams);
  if (d >= 0.45) return d * 0.85;
  if (q.w.length === 1 && f.w.startsWith(q.w)) return 0.5;
  return 0;
}

interface Field {
  weight: number;
  terms: Term[];
  compact: string;
  compactSound: string;
}

const FIELD_WEIGHTS = { title: 10, artist: 7, album: 5, albumArtist: 5, genre: 3, lyrics: 2 };

/** A scored field. `names` adds the initials of each name as exact-only terms. */
function makeField(text: string, weight: number, names: string[] = []): Field {
  const words = tokenize(text);
  const ini = names.map(initials).filter((s) => s.length >= 2);
  return {
    weight,
    terms: [...words.map(term), ...ini.map(exactTerm)],
    compact: words.join(""),
    compactSound: words.map(soundKey).join(""),
  };
}

interface Scored {
  doc: SongDoc;
  score: number;
  /** Every query word matched well (exact / prefix / sounds alike). */
  exact: boolean;
}

/** Score a song for the query. Returns null when it is not a plausible match. */
function scoreSong(doc: SongDoc, q: Term[], qCompact: string, qCompactSound: string): Scored | null {
  const albumArtist = doc.search?.albumArtist ?? "";
  const fields: Field[] = [
    makeField(doc.title, FIELD_WEIGHTS.title),
    makeField(doc.artistName, FIELD_WEIGHTS.artist, doc.artists.map((a) => a.name)),
    makeField(doc.albumTitle ?? "", FIELD_WEIGHTS.album),
    makeField(albumArtist, FIELD_WEIGHTS.albumArtist, albumArtist ? [albumArtist] : []),
    makeField(doc.genre ?? "", FIELD_WEIGHTS.genre),
  ];
  // Lyrics: exact word hits only (cheap set lookup, avoids typo noise in long text).
  const lyrics = new Set(doc.search?.lyr ?? []);

  let total = 0;
  let matched = 0;
  let strong = 0;
  for (const qt of q) {
    let best = 0;
    let maxSim = 0;
    for (const f of fields) {
      for (const ft of f.terms) {
        const sim = wordSim(qt, ft);
        if (sim * f.weight > best) best = sim * f.weight;
        if (sim > maxSim) maxSim = sim;
      }
    }
    if (lyrics.has(qt.w)) {
      best = Math.max(best, FIELD_WEIGHTS.lyrics);
      maxSim = Math.max(maxSim, 0.9);
    }
    total += best;
    if (maxSim >= 0.5) matched++;
    if (maxSim >= 0.88) strong++;
  }

  // Whole query typed without spaces or as one phrase: "luxpapa", "unpunnagai".
  let phrase = 0;
  let phraseExact = false;
  if (qCompact.length >= 4) {
    for (const f of fields.slice(0, 4)) {
      if (!f.compact) continue;
      if (f.compact === qCompact) {
        phrase = Math.max(phrase, f.weight * 1.2);
        phraseExact = true;
      } else if (f.compact.includes(qCompact) || f.compactSound.includes(qCompactSound)) {
        phrase = Math.max(phrase, f.weight);
        phraseExact = true;
      }
      else {
        const d = dice(paddedTrigrams(qCompact), paddedTrigrams(f.compact));
        if (d >= 0.6) phrase = Math.max(phrase, f.weight * d * 0.9);
      }
    }
  }

  const coverage = matched / q.length;
  if (coverage < 0.5 && phrase === 0) return null;

  const wordPart = total / (q.length * FIELD_WEIGHTS.title); // 0..1 (title-perfect = 1)
  const phrasePart = phrase / FIELD_WEIGHTS.title; // 0..1.2
  const score =
    Math.max(wordPart, phrasePart) * 0.7 +
    coverage * 0.3 +
    (strong === q.length ? 0.1 : 0) +
    Math.log1p(doc.playCount) * 0.015;
  return { doc, score, exact: strong === q.length || phraseExact };
}

/* ------------------------------------------------------------------ */
/* Retrieval                                                            */
/* ------------------------------------------------------------------ */

const CANDIDATES = 400;

async function candidates(q: Term[], qCompact: string): Promise<SongDoc[]> {
  const or: Record<string, unknown>[] = [];
  for (const t of q) {
    or.push({ "search.words": { $regex: `^${escapeRegex(t.w)}` } });
    if (t.sound !== t.w && t.w.length >= 3 && t.sound.length >= 2) or.push({ "search.sound": { $regex: `^${escapeRegex(t.sound)}` } });
    if (t.skel) or.push({ "search.skel": t.skel });
    if (t.w.length >= 3) or.push({ "search.lyr": t.w });
  }
  const grams = [...new Set([...q.flatMap((t) => trigrams(t.w)), ...trigrams(qCompact)])];

  const [byWords, byGrams] = await Promise.all([
    songs
      .find({ status: "ready", $or: or }, { projection: { "search.grams": 0 } })
      .sort({ playCount: -1 })
      .limit(CANDIDATES)
      .toArray(),
    grams.length
      ? songs
          .aggregate<SongDoc>([
            { $match: { status: "ready", "search.grams": { $in: grams } } },
            { $addFields: { _overlap: { $size: { $setIntersection: ["$search.grams", grams] } } } },
            { $sort: { _overlap: -1, playCount: -1 } },
            { $limit: CANDIDATES },
            { $project: { "search.grams": 0, _overlap: 0 } },
          ])
          .toArray()
      : Promise.resolve([] as SongDoc[]),
  ]);
  const seen = new Map<string, SongDoc>();
  for (const d of [...byWords, ...byGrams]) if (!seen.has(d._id)) seen.set(d._id, d as SongDoc);
  return [...seen.values()];
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

export interface SearchResult {
  songs: SongDoc[];
  artistIds: string[];
  albumIds: string[];
  /** No song matched every word well: results are "did you mean" style. */
  fuzzy: boolean;
}

/** How well a name matches the whole query (0..1), for artist / album results. */
function nameScore(q: Term[], qCompact: string, name: string) {
  const f = makeField(name, 1, [name]);
  if (qCompact.length >= 4 && (f.compact.includes(qCompact) || f.compactSound.includes(soundKey(qCompact)))) return 1;
  let total = 0;
  for (const qt of q) total += Math.max(0, ...f.terms.map((ft) => wordSim(qt, ft)));
  return total / q.length;
}

export async function search(query: string, limit = 30): Promise<SearchResult> {
  const words = queryWords(query);
  if (!words.length) return { songs: [], artistIds: [], albumIds: [], fuzzy: false };

  const q = words.map(term);
  const qCompact = words.join("");
  const qCompactSound = words.map(soundKey).join("");

  const scored = (await candidates(q, qCompact))
    .map((d) => scoreSong(d, q, qCompact, qCompactSound))
    .filter((s): s is Scored => !!s)
    .sort((a, b) => b.score - a.score);

  // Drop the long tail when there are clearly better matches.
  const top = scored[0]?.score ?? 0;
  const results = scored.filter((s) => s.score >= top * 0.45).slice(0, limit);

  const artistScores = new Map<string, number>();
  const albumScores = new Map<string, number>();
  for (const { doc } of scored.slice(0, 100)) {
    for (const a of doc.artists) {
      if (artistScores.has(a.id)) continue;
      const s = nameScore(q, qCompact, a.name);
      if (s >= 0.7) artistScores.set(a.id, s);
    }
    if (doc.albumId && doc.albumTitle && !albumScores.has(doc.albumId)) {
      const s = nameScore(q, qCompact, doc.albumTitle);
      if (s >= 0.7) albumScores.set(doc.albumId, s);
    }
  }
  // Album artists / composers (not credited on the song itself).
  const albumIds = [...new Set(scored.slice(0, 100).map((s) => s.doc.albumId).filter((id): id is string => !!id))];
  if (albumIds.length) {
    const grouped = await albums
      .find({ _id: { $in: albumIds }, artistKey: { $ne: "" } }, { projection: { artistId: 1 } })
      .toArray();
    const ids = [...new Set(grouped.map((a) => a.artistId))].filter((id) => !artistScores.has(id));
    for (const a of await artists.find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray()) {
      const s = nameScore(q, qCompact, a.name);
      if (s >= 0.7) artistScores.set(a._id, s);
    }
  }

  const best = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);

  return {
    songs: results.map((r) => r.doc),
    artistIds: best(artistScores, 6),
    albumIds: best(albumScores, 6),
    fuzzy: results.length > 0 && !results[0].exact,
  };
}
