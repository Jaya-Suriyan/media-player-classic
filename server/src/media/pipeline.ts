import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { albums, newId, songs } from "../db.js";
import { config } from "../config.js";
import { storage, IMMUTABLE } from "../storage/index.js";
import { createSong, getSong, setSongFields, type SongInput } from "../catalog.js";
import { extractMetadata } from "./metadata.js";
import { masterPlaylist, resizeCover, transcodeToHls } from "./ffmpeg.js";

fs.mkdirSync(config.tmpDir, { recursive: true });

export const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus", ".wma", ".aiff", ".aif", ".alac", ".webm"]);

const CONTENT_TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".m4s": "audio/mp4",
  ".mp4": "audio/mp4",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
};
export const contentTypeFor = (p: string) => CONTENT_TYPES[path.extname(p).toLowerCase()] ?? "application/octet-stream";

const tmpOriginal = (songId: string) => path.join(config.tmpDir, `orig-${songId}`);

/* ------------------------------------------------------------------ */
/* Covers                                                               */
/* ------------------------------------------------------------------ */

/** Store an image as two square JPEGs (160px for lists, 600px for players). Returns the key prefix. */
export async function storeCover(ownerId: string, image: Buffer): Promise<string> {
  const work = await fsp.mkdtemp(path.join(config.tmpDir, "cover-"));
  try {
    const src = path.join(work, "src");
    await fsp.writeFile(src, image);
    const sm = path.join(work, "sm.jpg");
    const lg = path.join(work, "lg.jpg");
    await resizeCover(src, sm, 160, 5);
    await resizeCover(src, lg, 600, 3);
    const prefix = `covers/${ownerId}/${newId().slice(0, 6)}`;
    await storage.putFile(`${prefix}/sm.jpg`, sm, { contentType: "image/jpeg", cacheControl: IMMUTABLE });
    await storage.putFile(`${prefix}/lg.jpg`, lg, { contentType: "image/jpeg", cacheControl: IMMUTABLE });
    return prefix;
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

export async function deleteCover(prefix: string | null | undefined) {
  if (prefix) await storage.deletePrefix(prefix + "/").catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Ingest                                                               */
/* ------------------------------------------------------------------ */

/**
 * Take an uploaded / imported audio file, read its tags, store the original
 * and queue it for transcoding. The temp file is moved and owned by the pipeline.
 */
export async function ingestAudioFile(tmpPath: string, originalName: string, overrides: Partial<SongInput> = {}) {
  const ext = path.extname(originalName).toLowerCase() || ".bin";
  const id = newId();
  const size = (await fsp.stat(tmpPath)).size;
  const meta = await extractMetadata(tmpPath, originalName);

  const input: SongInput = {
    title: meta.title,
    artistName: meta.artistName,
    albumTitle: meta.albumTitle,
    albumArtist: meta.albumArtist,
    trackNo: meta.trackNo,
    discNo: meta.discNo,
    genre: meta.genre,
    year: meta.year,
    duration: meta.duration,
    lyrics: meta.lyrics,
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined && v !== null && v !== "") (input as unknown as Record<string, unknown>)[k] = v;
  }

  const originalKey = `songs/${id}/original${ext}`;
  await storage.putFile(originalKey, tmpPath, { contentType: contentTypeFor(ext) });
  // Keep a local copy so the worker does not have to download it again.
  await fsp.rename(tmpPath, tmpOriginal(id));

  const song = await createSong(id, input, { originalKey, originalName, originalSize: size });

  if (meta.picture) {
    try {
      const prefix = await storeCover(id, meta.picture.data);
      await setSongFields(id, { coverKey: prefix });
      if (song.albumId) await albums.updateOne({ _id: song.albumId, coverKey: null }, { $set: { coverKey: prefix } });
    } catch {
      /* broken embedded art is not fatal */
    }
  }

  enqueueTranscode(id);
  return id;
}

/* ------------------------------------------------------------------ */
/* Transcode queue                                                      */
/* ------------------------------------------------------------------ */

const queue: string[] = [];
const active = new Set<string>();

export function queueState() {
  return { queued: queue.length, active: active.size };
}

export function enqueueTranscode(songId: string) {
  if (queue.includes(songId) || active.has(songId)) return;
  queue.push(songId);
  pump();
}

function pump() {
  while (active.size < config.transcodeConcurrency && queue.length) {
    const id = queue.shift()!;
    active.add(id);
    processSong(id)
      .catch((err) => {
        console.error(`[transcode] ${id} failed:`, err.message);
        return setSongFields(id, { status: "failed", error: String(err.message).slice(0, 1000) });
      })
      .finally(() => {
        active.delete(id);
        pump();
      });
  }
}

async function uploadDir(localDir: string, keyPrefix: string) {
  const entries = await fsp.readdir(localDir, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
  // Upload in small parallel batches.
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(
      files.slice(i, i + 8).map((f) => {
        const rel = path.relative(localDir, f).split(path.sep).join("/");
        return storage.putFile(`${keyPrefix}/${rel}`, f, { contentType: contentTypeFor(f), cacheControl: IMMUTABLE });
      }),
    );
  }
}

async function processSong(id: string) {
  const row = await getSong(id);
  if (!row) return;
  if (!row.originalKey) throw new Error("Song has no original file");
  await setSongFields(id, { status: "processing", error: null });

  const work = await fsp.mkdtemp(path.join(config.tmpDir, `hls-${id}-`));
  const local = tmpOriginal(id);
  try {
    if (!fs.existsSync(local)) await storage.download(row.originalKey, local);
    await transcodeToHls(local, work);
    await fsp.writeFile(path.join(work, "master.m3u8"), masterPlaylist());

    // Versioned prefix so re-transcodes never collide with cached segments.
    const hlsKey = `songs/${id}/hls/${newId().slice(0, 8)}`;
    await uploadDir(work, hlsKey);

    let duration = row.duration;
    if (!duration) {
      const pl = await fsp.readFile(path.join(work, "48k", "index.m3u8"), "utf8");
      duration = [...pl.matchAll(/#EXTINF:([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0) || null;
    }

    const old = row.hlsKey;
    await setSongFields(id, { status: "ready", hlsKey, duration, error: null });
    if (old && old !== hlsKey) await storage.deletePrefix(old + "/").catch(() => {});
    await fsp.rm(local, { force: true });
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

/** Resume work interrupted by a restart. */
export async function resumePendingJobs() {
  const rows = await songs
    .find({ status: { $in: ["pending", "processing"] } }, { projection: { _id: 1 } })
    .sort({ createdAt: 1 })
    .toArray();
  rows.forEach((r) => enqueueTranscode(r._id));
  if (rows.length) console.log(`[transcode] resumed ${rows.length} job(s)`);
}

export async function deleteSongMedia(id: string) {
  await storage.deletePrefix(`songs/${id}/`).catch(() => {});
  await fsp.rm(tmpOriginal(id), { force: true });
}
