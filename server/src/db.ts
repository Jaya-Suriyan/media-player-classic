import fs from "node:fs";
import { MongoClient, type Collection } from "mongodb";
import { customAlphabet } from "nanoid";
import { config } from "./config.js";
import { normalizeText } from "./text.js";

fs.mkdirSync(config.dataDir, { recursive: true });

/** URL-safe, lowercase ids (nice for links, easy to type in a mobile app). */
export const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
export const now = () => Date.now();

export type SongStatus = "pending" | "processing" | "ready" | "failed";

export interface UserDoc {
  _id: string;
  email: string; // stored lowercase
  passwordHash: string;
  role: "admin";
  createdAt: number;
}

export interface ArtistDoc {
  _id: string;
  name: string;
  nameKey: string;
  imageKey: string | null;
  createdAt: number;
}

export interface AlbumDoc {
  _id: string;
  title: string;
  titleKey: string;
  /** Display artist (album artist if tagged, else first song's artist). */
  artistId: string;
  /** nameKey of the album-artist tag, or "" when grouped by title only. */
  artistKey: string;
  year: number | null;
  coverKey: string | null;
  createdAt: number;
}

export interface SearchIndex {
  /** Index format version; old songs are re-indexed on startup. */
  v: number;
  /** Normalised words of title, artists, album, album artist, genre + artist initials. */
  words: string[];
  /** Sound-alike keys of those words. */
  sound: string[];
  /** Consonant skeletons (vowel-slip tolerance). */
  skel: string[];
  /** Trigrams of words and of the joined title (typo / no-space tolerance). */
  grams: string[];
  /** Distinct lyric words (low-weight matches). */
  lyr: string[];
  /** Album artist / composer name, for scoring. */
  albumArtist: string | null;
}

export interface SongDoc {
  _id: string;
  title: string;
  /** Credited artists in order; the first is the primary artist. */
  artists: { id: string; name: string }[];
  artistIds: string[];
  /** Display credit, e.g. "S.P.Bala, Swarnalatha" (denormalised for lists & search). */
  artistName: string;
  albumId: string | null;
  albumTitle: string | null;
  trackNo: number | null;
  discNo: number | null;
  genre: string | null;
  year: number | null;
  duration: number | null;
  lyrics: string | null;
  coverKey: string | null;
  originalKey: string | null;
  originalName: string | null;
  originalSize: number | null;
  hlsKey: string | null;
  status: SongStatus;
  error: string | null;
  playCount: number;
  createdAt: number;
  updatedAt: number;
  /** Search index, see search.ts → buildSearchIndex(). */
  search: SearchIndex;
}

export interface SettingsDoc {
  _id: string;
  [key: string]: unknown;
}

export const client = new MongoClient(config.mongoUrl, { maxPoolSize: 20 });
const database = client.db(config.mongoDb);

export const users: Collection<UserDoc> = database.collection("users");
export const artists: Collection<ArtistDoc> = database.collection("artists");
export const albums: Collection<AlbumDoc> = database.collection("albums");
export const songs: Collection<SongDoc> = database.collection("songs");
export const settings: Collection<SettingsDoc> = database.collection("settings");

/** Case-insensitive matching for genre filters / grouping. */
export const GENRE_COLLATION = { locale: "en", strength: 2 } as const;

export async function connectDb() {
  await client.connect();
  await Promise.all([
    users.createIndexes([{ key: { email: 1 }, unique: true }]),
    artists.createIndexes([{ key: { nameKey: 1 }, unique: true }]),
    albums.createIndexes([
      { key: { titleKey: 1, artistKey: 1 }, unique: true },
      { key: { artistId: 1 } },
      { key: { year: -1, createdAt: -1 } },
      { key: { coverKey: 1 } },
    ]),
    songs.createIndexes([
      { key: { status: 1, createdAt: -1 } },
      { key: { status: 1, playCount: -1 } },
      { key: { artistIds: 1, status: 1, playCount: -1 } },
      { key: { albumId: 1, discNo: 1, trackNo: 1 } },
      { key: { genre: 1, status: 1 }, collation: GENRE_COLLATION },
      { key: { coverKey: 1 } },
      { key: { "search.words": 1, status: 1 } },
      { key: { "search.sound": 1, status: 1 } },
      { key: { "search.skel": 1 } },
      { key: { "search.grams": 1 } },
      { key: { "search.lyr": 1 } },
      { key: { "search.v": 1 } },
    ]),
  ]);
}

/** Normalised key used for de-duplicating artist / album names. */
export const nameKey = (s: string) => normalizeText(s).replace(/\s+/g, " ").trim();

export { normalizeText };

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
