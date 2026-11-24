/**
 * Offline downloads.
 *
 * Each song is fetched as one .m4a file (built by the server from its HLS
 * segments) and kept in Cache Storage. Playback reads it back as a Blob, so
 * downloaded songs play with no network on every browser, including iOS.
 * The list of downloads (with song details) lives in localStorage so the
 * Downloads page works offline too.
 */
import { absUrl, api, type Song } from "./api";
import { createStore } from "./hooks";

const CACHE = "mpc-offline-v1";
const fileKey = (id: string) => `/__offline__/${id}.m4a`;

export type DownloadQuality = "48k" | "96k" | "160k";

export interface DownloadMeta {
  song: Song;
  size: number;
  quality: DownloadQuality;
  at: number;
}

export interface DownloadProgress {
  state: "queued" | "downloading" | "error";
  /** 0..1 */
  progress: number;
  error?: string;
}

export const downloadsStore = createStore<Record<string, DownloadMeta>>("mpc.downloads", {});
export const downloadProgressStore = createStore<Record<string, DownloadProgress>>(null, {});
export const downloadQualityStore = createStore<DownloadQuality>("mpc.downloadQuality", "96k");

export const isDownloaded = (id: string) => !!downloadsStore.get()[id];

export function useDownloadState(id: string | undefined) {
  const downloads = downloadsStore.use();
  const progress = downloadProgressStore.use();
  if (!id) return { downloaded: false, progress: undefined };
  return { downloaded: !!downloads[id], progress: progress[id] };
}

export const supportsDownloads = () => typeof caches !== "undefined";

const setProgress = (id: string, p: DownloadProgress | null) =>
  downloadProgressStore.set((all) => {
    const next = { ...all };
    if (p) next[id] = p;
    else delete next[id];
    return next;
  });

/* ------------------------------------------------------------------ */
/* Queue                                                                */
/* ------------------------------------------------------------------ */

const queue: Song[] = [];
let running = false;
let persistAsked = false;

export function downloadSongs(songs: Song[]) {
  if (!supportsDownloads()) return;
  if (!persistAsked) {
    persistAsked = true;
    // Ask the browser not to evict downloads under storage pressure.
    navigator.storage?.persist?.().catch(() => {});
  }
  for (const s of songs) {
    if (isDownloaded(s.id) || queue.some((q) => q.id === s.id)) continue;
    const p = downloadProgressStore.get()[s.id];
    if (p && p.state !== "error") continue;
    queue.push(s);
    setProgress(s.id, { state: "queued", progress: 0 });
  }
  void run();
}

export const downloadSong = (song: Song) => downloadSongs([song]);

export function cancelDownload(id: string) {
  const i = queue.findIndex((s) => s.id === id);
  if (i >= 0) queue.splice(i, 1);
  setProgress(id, null);
}

async function run() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const song = queue.shift()!;
      try {
        await fetchAndStore(song);
        setProgress(song.id, null);
      } catch (err) {
        setProgress(song.id, { state: "error", progress: 0, error: (err as Error).message });
      }
    }
  } finally {
    running = false;
  }
}

async function fetchAndStore(song: Song) {
  const quality = downloadQualityStore.get();
  setProgress(song.id, { state: "downloading", progress: 0 });
  const { url } = await api.offlineFile(song.id, quality);
  const res = await fetch(absUrl(url));
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);

  // Read with progress.
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastTick = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const now = Date.now();
    if (total && now - lastTick > 150) {
      lastTick = now;
      setProgress(song.id, { state: "downloading", progress: received / total });
    }
  }
  if (!downloadProgressStore.get()[song.id]) return; // cancelled meanwhile
  const blob = new Blob(chunks as BlobPart[], { type: "audio/mp4" });

  const cache = await caches.open(CACHE);
  await cache.put(
    fileKey(song.id),
    new Response(blob, { headers: { "content-type": "audio/mp4", "content-length": String(blob.size) } }),
  );
  // Artwork too, so the offline service worker can show it.
  if (song.cover) {
    await Promise.all(
      [song.cover.sm, song.cover.lg].map(async (u) => {
        try {
          const url = absUrl(u);
          // Cross-origin artwork (R2 / S3): an opaque response is fine for <img> and needs no CORS.
          const crossOrigin = new URL(url, location.href).origin !== location.origin;
          const r = await fetch(url, crossOrigin ? { mode: "no-cors" } : {});
          if (r.ok || r.type === "opaque") await cache.put(url, r);
        } catch {
          /* artwork is optional */
        }
      }),
    );
  }
  downloadsStore.set((all) => ({ ...all, [song.id]: { song, size: blob.size, quality, at: Date.now() } }));
}

/* ------------------------------------------------------------------ */
/* Playback & removal                                                   */
/* ------------------------------------------------------------------ */

/** Object URL for a downloaded song, or null when it is not (or no longer) stored. */
export async function offlineObjectUrl(id: string): Promise<string | null> {
  if (!supportsDownloads() || !isDownloaded(id)) return null;
  try {
    const res = await (await caches.open(CACHE)).match(fileKey(id));
    if (!res) {
      // Browser evicted it: forget the entry.
      downloadsStore.set((all) => {
        const next = { ...all };
        delete next[id];
        return next;
      });
      return null;
    }
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

export async function removeDownload(id: string) {
  const meta = downloadsStore.get()[id];
  downloadsStore.set((all) => {
    const next = { ...all };
    delete next[id];
    return next;
  });
  if (!supportsDownloads()) return;
  const cache = await caches.open(CACHE);
  await cache.delete(fileKey(id));
  if (meta?.song.cover) {
    const stillUsed = Object.values(downloadsStore.get()).some((d) => d.song.cover?.sm === meta.song.cover?.sm);
    if (!stillUsed) await Promise.all([cache.delete(absUrl(meta.song.cover.sm)), cache.delete(absUrl(meta.song.cover.lg))]);
  }
}

export async function removeAllDownloads() {
  downloadsStore.set({});
  if (supportsDownloads()) await caches.delete(CACHE);
}

/** Downloaded songs, newest first. */
export const downloadedSongs = () =>
  Object.values(downloadsStore.get())
    .sort((a, b) => b.at - a.at)
    .map((d) => d.song);
