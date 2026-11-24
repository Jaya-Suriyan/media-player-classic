/**
 * Text helpers for search: normalisation, sound-alike keys, trigrams.
 *
 * Song titles are often transliterated (Tamil, Hindi, Telugu… written in
 * English letters), so the same word appears in many spellings:
 * "punnagai" / "punagai" / "punnakai", "ezhumalai" / "elumalai",
 * "paapaa" / "papa", "lux" / "lucks". Sound-alike keys collapse those.
 */

export const normalizeText = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Words (letters + digits, any script). "S.P.Bala" → ["s", "p", "bala"]. */
export const tokenize = (s: string): string[] => normalizeText(s).match(/[\p{L}\p{N}]+/gu) ?? [];

/** Words people add to searches that are never part of a title. */
const FILLER = new Set([
  "song", "songs", "the", "a", "an", "by", "from", "of", "and", "mp3", "lyrics", "lyric", "video",
  "audio", "full", "hd", "movie", "film", "track", "music", "official", "latest", "new", "hit", "hits",
  "download", "play", "listen", "tamil", "hindi", "telugu", "malayalam", "kannada", "english",
]);

/** Query words with filler removed (unless that would leave nothing). */
export function queryWords(q: string) {
  const words = tokenize(q).slice(0, 10);
  const meaningful = words.filter((w) => !FILLER.has(w));
  return meaningful.length ? meaningful : words;
}

/** Only latin-script words get sound-alike keys; other scripts are matched as-is. */
const isLatin = (w: string) => /^[a-z0-9]+$/.test(w);

/**
 * Sound-alike key: maps letters that are commonly swapped in transliteration
 * and English spelling onto one form, then collapses repeats.
 *   punnagai, punagai, punnakai → punakai
 *   ezhumalai, elumalai         → elumalai
 *   lux, lucks, luks            → luks
 *   paapaa, pappa, papa         → papa
 */
export function soundKey(word: string): string {
  if (!isLatin(word)) return word;
  let s = word
    .replace(/zh/g, "l")
    .replace(/ph/g, "f")
    .replace(/sh/g, "s")
    .replace(/ch/g, "s")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/bh/g, "b")
    .replace(/gh/g, "g")
    .replace(/kh/g, "k")
    .replace(/ck/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/z/g, "s")
    .replace(/w/g, "v")
    // voiced / unvoiced pairs are written interchangeably (nagai / nakai, deva / teva)
    .replace(/g/g, "k")
    .replace(/d/g, "t")
    .replace(/b/g, "p")
    // long vowels spelled double or with different letters
    .replace(/ee|ii|ie|ea/g, "i")
    .replace(/oo|uu|ou/g, "u")
    .replace(/aa/g, "a")
    .replace(/y$/, "i")
    .replace(/(?<=[aeiou])h/g, "");
  s = s.replace(/(.)\1+/g, "$1");
  return s || word;
}

/**
 * Consonant skeleton of the sound key: first letter + consonants.
 * Catches vowel slips: "lax"/"lux" → "lks", "ponnagai"/"punnagai" → "pnk".
 */
export function skeleton(word: string): string {
  const k = soundKey(word);
  if (!isLatin(k) || k.length < 3) return "";
  const sk = k[0] + k.slice(1).replace(/[aeiou]/g, "");
  return sk.length >= 2 ? sk : "";
}

export function trigrams(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i <= word.length - 3; i++) out.push(word.slice(i, i + 3));
  return out;
}

/** Trigrams with word-boundary padding, for similarity scoring. */
export function paddedTrigrams(word: string): Set<string> {
  const w = `  ${word} `;
  const out = new Set<string>();
  for (let i = 0; i < w.length - 2; i++) out.add(w.slice(i, i + 3));
  return out;
}

export function dice(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}

/** "S.P. Balasubrahmanyam" → "spb", "A R Rahman" → "arr". Only for multi-word names. */
export function initials(name: string): string {
  const words = tokenize(name);
  return words.length >= 2 ? words.map((w) => w[0]).join("") : "";
}
