/**
 * Download sites stamp their domain into tags: "Song - MassTamilan.com",
 * "Album [www.site.in]", "(Starmusiq.com)". Strip those.
 */
export const SITE = String.raw`(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9][a-z0-9-]*\.(?:com|net|org|in|co|info|io|me|cc|fm|tv|xyz|pk|lk|biz|cool|club|site|online|live|to|la|ws|mobi|autos|pro|vip|top|fun|icu|cyou|lol|wtf|guru)(?:\.[a-z]{2})?)`;

const WATERMARKS = [
  new RegExp(String.raw`\s*[\[(]\s*${SITE}\s*[\])]`, "gi"),
  new RegExp(String.raw`\s*(?:[-–—|:~]|::)\s*${SITE}\s*$`, "gi"),
  new RegExp(String.raw`^\s*${SITE}\s*(?:[-–—|:~]|::)\s*`, "gi"),
  new RegExp(String.raw`^\s*${SITE}\s*$`, "gi"),
];

export function clean(s: string | undefined | null) {
  let out = (s ?? "").replace(/\u0000/g, "").trim();
  for (const re of WATERMARKS) out = out.replace(re, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Short "lyrics" that mention a website are download-site adverts, not lyrics. */
export function realLyrics(text: string | null) {
  const t = text?.replace(/\u0000/g, "").trim();
  if (!t) return null;
  if (t.length < 300 && new RegExp(SITE, "i").test(t)) return null;
  return t;
}
