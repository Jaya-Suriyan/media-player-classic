/**
 * Storage router. Three places files can live:
 *
 *   1. local  – this server's disk            keys: "songs/abc/…"      (no prefix)
 *   2. r2     – Cloudflare R2                  keys: "r2:songs/abc/…"
 *   3. s3     – Amazon S3 / S3-compatible      keys: "s3:songs/abc/…"
 *
 * Every stored key carries its backend, so songs on different storages can
 * coexist and changing the upload target never breaks existing songs.
 * R2 / S3 credentials come from the admin Storage settings (database) and
 * can be changed at runtime.
 */
import { config } from "../config.js";
import { LocalStorage } from "./local.js";
import { S3Storage, type S3Options } from "./s3.js";
import type { PutOptions, Storage } from "./types.js";

export type { Storage } from "./types.js";
export type BackendName = "local" | "r2" | "s3";
export const BACKENDS: BackendName[] = ["local", "r2", "s3"];

export const IMMUTABLE = "public, max-age=31536000, immutable";

export const localStorage = new LocalStorage(config.storage.localDir);
const remotes: Partial<Record<"r2" | "s3", S3Storage>> = {};

/** (Re)configure a remote backend; null removes it. */
export function configureRemote(name: "r2" | "s3", opts: S3Options | null) {
  if (opts) remotes[name] = new S3Storage(opts);
  else delete remotes[name];
}

export const isConfigured = (name: BackendName) => name === "local" || !!remotes[name];

export function remote(name: "r2" | "s3") {
  const r = remotes[name];
  if (!r) throw new Error(`${name === "r2" ? "Cloudflare R2" : "Amazon S3"} is not configured`);
  return r;
}

export function backendOf(key: string | null | undefined): BackendName {
  if (key?.startsWith("r2:")) return "r2";
  if (key?.startsWith("s3:")) return "s3";
  return "local";
}

/** Path inside the backend ("r2:songs/x" → "songs/x"). */
export const pathOf = (key: string) => key.replace(/^(?:r2|s3):/, "");

/** Build a full key for a backend. */
export const keyFor = (backend: BackendName, p: string) => (backend === "local" ? p : `${backend}:${p}`);

/** Re-target a key to another backend. */
export const moveKey = (key: string, to: BackendName) => keyFor(to, pathOf(key));

function route(key: string): { store: Storage; path: string } {
  const b = backendOf(key);
  return { store: b === "local" ? localStorage : remote(b), path: pathOf(key) };
}

/** Same interface as a single backend, routing each call by the key's prefix. */
export const storage = {
  putFile: (key: string, file: string, o?: PutOptions) => {
    const r = route(key);
    return r.store.putFile(r.path, file, o);
  },
  putBuffer: (key: string, body: Buffer, o?: PutOptions) => {
    const r = route(key);
    return r.store.putBuffer(r.path, body, o);
  },
  getBuffer: (key: string) => {
    const r = route(key);
    return r.store.getBuffer(r.path);
  },
  download: (key: string, dest: string) => {
    const r = route(key);
    return r.store.download(r.path, dest);
  },
  getStream: (key: string, range?: { start: number; end?: number }) => {
    const r = route(key);
    return r.store.getStream(r.path, range);
  },
  exists: (key: string) => {
    const r = route(key);
    return r.store.exists(r.path);
  },
  /** Keys returned include the backend prefix. */
  list: async (key: string) => {
    const b = backendOf(key);
    const r = route(key);
    return (await r.store.list(r.path)).map((o) => ({ ...o, key: keyFor(b, o.key) }));
  },
  deletePrefix: (key: string) => {
    const r = route(key);
    return r.store.deletePrefix(r.path);
  },
  url: (key: string, ttlSeconds?: number) => {
    const r = route(key);
    return r.store.url(r.path, ttlSeconds);
  },
};
