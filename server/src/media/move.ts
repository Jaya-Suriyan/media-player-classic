/**
 * Move songs between storages (e.g. local disk → Cloudflare R2).
 *
 * Per song: copy every file (original, HLS streams, offline files, cover) to
 * the target, switch the song (and albums using its cover) to the new keys,
 * then delete the old copies. A failure leaves the song on its old storage,
 * still playable. Runs one song at a time in the background.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { albums, newId, songs, type SongDoc } from "../db.js";
import { config } from "../config.js";
import { backendOf, IMMUTABLE, moveKey, storage, type BackendName } from "../storage/index.js";
import { contentTypeFor } from "./pipeline.js";

export interface MoveJob {
  running: boolean;
  from: BackendName;
  to: BackendName;
  total: number;
  done: number;
  failed: { id: string; title: string; error: string }[];
  bytes: number;
  current: string | null;
  startedAt: number;
  finishedAt: number | null;
  cancelRequested: boolean;
}

let job: MoveJob | null = null;
export const moveStatus = () => job;

/** Mongo filter for songs whose files are on `backend`. */
export function onBackend(backend: BackendName) {
  return backend === "local"
    ? { originalKey: { $not: /^(?:r2|s3):/ } }
    : { originalKey: { $regex: `^${backend}:` } };
}

export async function countByBackend() {
  const [local, r2, s3] = await Promise.all(
    (["local", "r2", "s3"] as BackendName[]).map((b) => songs.countDocuments(onBackend(b) as never)),
  );
  return { local, r2, s3 };
}

async function copyKey(fromKey: string, to: BackendName, work: string) {
  const tmp = path.join(work, newId());
  try {
    await storage.download(fromKey, tmp);
    const isOriginal = /\/original\.[a-z0-9]+$/i.test(fromKey);
    await storage.putFile(moveKey(fromKey, to), tmp, {
      contentType: contentTypeFor(fromKey),
      cacheControl: isOriginal ? undefined : IMMUTABLE,
    });
    return (await fsp.stat(tmp)).size;
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

async function moveSong(d: SongDoc, to: BackendName) {
  const from = backendOf(d.originalKey);
  const songPrefix = `${d.originalKey!.replace(/\/original\.[^/]+$/, "")}/`; // "<backend:>songs/<id>/"
  const keys = (await storage.list(songPrefix)).map((o) => o.key);
  const coverKeys = d.coverKey && backendOf(d.coverKey) === from ? (await storage.list(`${d.coverKey}/`)).map((o) => o.key) : [];
  const work = await fsp.mkdtemp(path.join(config.tmpDir, `move-${d._id}-`));
  let bytes = 0;
  try {
    const all = [...keys, ...coverKeys];
    for (let i = 0; i < all.length; i += 6) {
      const sizes = await Promise.all(all.slice(i, i + 6).map((k) => copyKey(k, to, work)));
      bytes += sizes.reduce((a, b) => a + b, 0);
    }
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }

  // Switch over.
  const set: Partial<SongDoc> = { originalKey: moveKey(d.originalKey!, to) };
  if (d.hlsKey && backendOf(d.hlsKey) === from) set.hlsKey = moveKey(d.hlsKey, to);
  if (d.coverKey && coverKeys.length) set.coverKey = moveKey(d.coverKey, to);
  await songs.updateOne({ _id: d._id }, { $set: set });
  if (set.coverKey) await albums.updateMany({ coverKey: d.coverKey }, { $set: { coverKey: set.coverKey } });

  // Remove the old copies.
  await storage.deletePrefix(songPrefix).catch(() => {});
  if (coverKeys.length) await storage.deletePrefix(`${d.coverKey}/`).catch(() => {});
  return bytes;
}

export async function startMove(from: BackendName, to: BackendName, ids?: string[]) {
  if (job?.running) throw new Error("A move is already running");
  if (from === to) throw new Error("Choose a different storage to move to");
  // Songs still being processed are skipped; move them later.
  const filter = { ...onBackend(from), status: { $in: ["ready", "failed"] }, ...(ids?.length ? { _id: { $in: ids } } : {}) };
  const list = (await songs.find(filter as never, { projection: { search: 0, lyrics: 0 } }).toArray()) as SongDoc[];
  const state: MoveJob = {
    running: true,
    from,
    to,
    total: list.length,
    done: 0,
    failed: [],
    bytes: 0,
    current: null,
    startedAt: Date.now(),
    finishedAt: null,
    cancelRequested: false,
  };
  job = state;
  void (async () => {
    try {
      for (const d of list) {
        if (state.cancelRequested) break;
        state.current = d.title;
        try {
          state.bytes += await moveSong(d, to);
        } catch (err) {
          state.failed.push({ id: d._id, title: d.title, error: (err as Error).message });
        }
        state.done++;
      }
    } catch (err) {
      state.failed.push({ id: "-", title: "(job)", error: (err as Error).message });
    } finally {
      state.running = false;
      state.current = null;
      state.finishedAt = Date.now();
    }
  })();
  return state;
}

export function cancelMove() {
  if (job?.running) job.cancelRequested = true;
}
