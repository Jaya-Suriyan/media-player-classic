/**
 * Single-file downloads for offline playback.
 *
 * Streaming uses many small HLS segments; offline playback wants one file
 * the device can store and play anywhere (including iOS Safari, whose native
 * HLS player cannot read app storage). We rebuild a normal .m4a from the
 * existing fMP4 segments with ffmpeg stream copy: no re-encoding, ~0.1 s.
 * Built once per song and quality, then kept in storage.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { storage, IMMUTABLE } from "../storage/index.js";
import { LADDER, runFfmpeg } from "./ffmpeg.js";
import type { SongDoc } from "../db.js";

export type Variant = (typeof LADDER)[number]["name"];
export const VARIANTS = LADDER.map((v) => v.name) as Variant[];
export const DEFAULT_DOWNLOAD: Variant = "96k";

export const offlineKey = (hlsKey: string, variant: Variant) => `${hlsKey}/offline-${variant}.m4a`;

/** Remux a local HLS variant folder (init + segments) into one faststart .m4a. */
export async function remuxVariantDir(variantDir: string, out: string) {
  const playlist = await fsp.readFile(path.join(variantDir, "index.m3u8"), "utf8");
  const init = playlist.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1];
  const segments = playlist.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!init || !segments.length) throw new Error("Variant playlist has no media");
  const joined = `${out}.fmp4`;
  const ws = fs.createWriteStream(joined);
  for (const f of [init, ...segments]) {
    await new Promise<void>((resolve, reject) => {
      const rs = fs.createReadStream(path.join(variantDir, f));
      rs.on("error", reject);
      rs.on("end", resolve);
      rs.pipe(ws, { end: false });
    });
  }
  await new Promise<void>((resolve, reject) => ws.end((err?: Error | null) => (err ? reject(err) : resolve())));
  try {
    await runFfmpeg(["-i", joined, "-map", "0:a", "-c", "copy", "-movflags", "+faststart", out]);
  } finally {
    await fsp.rm(joined, { force: true });
  }
}

const building = new Map<string, Promise<void>>();

/** Make sure the offline file exists in storage; build it from stored segments if not. */
export async function ensureOfflineFile(song: SongDoc, variant: Variant) {
  if (!song.hlsKey) throw new Error("Song is not ready");
  const key = offlineKey(song.hlsKey, variant);
  if (await storage.exists(key)) return key;

  let job = building.get(key);
  if (!job) {
    job = (async () => {
      const work = await fsp.mkdtemp(path.join(config.tmpDir, `offline-${song._id}-`));
      try {
        const base = `${song.hlsKey}/${variant}`;
        const playlist = (await storage.getBuffer(`${base}/index.m3u8`)).toString("utf8");
        await fsp.writeFile(path.join(work, "index.m3u8"), playlist);
        const init = playlist.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1];
        const files = [init, ...playlist.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))].filter(
          (f): f is string => !!f,
        );
        for (let i = 0; i < files.length; i += 8) {
          await Promise.all(files.slice(i, i + 8).map((f) => storage.download(`${base}/${f}`, path.join(work, f))));
        }
        const out = path.join(work, "offline.m4a");
        await remuxVariantDir(work, out);
        await storage.putFile(key, out, { contentType: "audio/mp4", cacheControl: IMMUTABLE });
      } finally {
        await fsp.rm(work, { recursive: true, force: true });
      }
    })().finally(() => building.delete(key));
    building.set(key, job);
  }
  await job;
  return key;
}
