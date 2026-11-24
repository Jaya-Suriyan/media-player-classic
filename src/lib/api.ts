/** Typed client for the Media Player Classic API. */

/** Base URL of the API. Empty = same origin (dev proxy / served by the API). */
export const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export interface Cover {
  sm: string;
  lg: string;
}

export interface ArtistRef {
  id: string;
  name: string;
}

export interface Song {
  id: string;
  title: string;
  artist: ArtistRef;
  artists: ArtistRef[];
  album: { id: string; title: string } | null;
  trackNo: number | null;
  discNo: number | null;
  genre: string | null;
  year: number | null;
  duration: number | null;
  cover: Cover | null;
  playCount: number;
  hasLyrics: boolean;
  createdAt: number;
}

export type SongStatus = "pending" | "processing" | "ready" | "failed";

export interface AdminSong extends Song {
  lyrics: string | null;
  status: SongStatus;
  error: string | null;
  originalName: string | null;
  originalSize: number | null;
  updatedAt: number;
}

export interface Artist {
  id: string;
  name: string;
  songCount: number;
  image: Cover | null;
}

export interface Album {
  id: string;
  title: string;
  artist: ArtistRef;
  year: number | null;
  songCount: number;
  cover: Cover | null;
}

export interface Genre {
  genre: string;
  count: number;
}

export interface User {
  id: string;
  email: string;
  role: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Resolve a server-relative URL (e.g. /media/...) against the API origin. */
export const absUrl = (u: string) => (/^https?:\/\//.test(u) ? u : API_BASE + u);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { credentials: "include", ...init, headers });
  } catch {
    throw new ApiError(0, navigator.onLine ? "Can't reach the server" : "You're offline");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  home: () =>
    request<{ newReleases: Song[]; trending: Song[]; artists: Artist[]; albums: Album[]; genres: Genre[] }>("/api/home"),
  songs: (p: { sort?: "new" | "popular" | "title"; genre?: string; limit?: number; offset?: number } = {}) =>
    request<{ items: Song[] }>(`/api/songs${qs(p)}`),
  songsByIds: (ids: string[]) =>
    ids.length ? request<{ items: Song[] }>(`/api/songs/batch${qs({ ids: ids.join(",") })}`) : Promise.resolve({ items: [] }),
  song: (id: string) => request<{ song: Song; lyrics: string | null; related: Song[] }>(`/api/songs/${id}`),
  reportPlay: (id: string) => request<{ ok: true }>(`/api/songs/${id}/play`, { method: "POST" }),
  artists: (p: { sort?: "popular" | "name"; limit?: number; offset?: number } = {}) =>
    request<{ items: Artist[] }>(`/api/artists${qs(p)}`),
  artist: (id: string) => request<{ artist: Artist; songs: Song[]; albums: Album[] }>(`/api/artists/${id}`),
  albums: (p: { limit?: number; offset?: number } = {}) => request<{ items: Album[] }>(`/api/albums${qs(p)}`),
  album: (id: string) => request<{ album: Album; songs: Song[] }>(`/api/albums/${id}`),
  search: (q: string, signal?: AbortSignal) =>
    request<{ query: string; fuzzy: boolean; songs: Song[]; artists: Artist[]; albums: Album[] }>(
      `/api/search${qs({ q })}`,
      { signal },
    ),
  suggest: (q: string, signal?: AbortSignal) =>
    request<{ songs: { id: string; title: string; artist: string }[]; artists: ArtistRef[] }>(
      `/api/search/suggest${qs({ q })}`,
      { signal },
    ),

  /** Where to fetch the single-file version of a song for offline use. */
  offlineFile: (id: string, quality: "48k" | "96k" | "160k") =>
    request<{ url: string; quality: string }>(`/api/songs/${id}/offline${qs({ quality })}`),

  /** HLS master playlist (adaptive) or a single fixed-bitrate variant. */
  streamUrl: (id: string, variant?: "48k" | "96k" | "160k") =>
    absUrl(variant ? `/api/stream/${id}/${variant}/index.m3u8` : `/api/stream/${id}/master.m3u8`),

  auth: {
    me: () => request<{ user: User | null }>("/api/auth/me"),
    login: (email: string, password: string) =>
      request<{ user: User; token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  },

  admin: {
    stats: () =>
      request<{
        songs: number;
        artists: number;
        albums: number;
        plays: number;
        bytes: number;
        byStatus: Partial<Record<SongStatus, number>>;
        queue: { queued: number; active: number };
        storage: string;
      }>("/api/admin/stats"),
    songs: (p: { q?: string; status?: string; sort?: string; limit?: number; offset?: number }) =>
      request<{ total: number; items: AdminSong[] }>(`/api/admin/songs${qs(p)}`),
    songsByIds: async (ids: string[]) => {
      const res = await Promise.all(ids.map((id) => request<{ song: AdminSong }>(`/api/admin/songs/${id}`).catch(() => null)));
      return res.filter((r): r is { song: AdminSong } => !!r).map((r) => r.song);
    },
    update: (id: string, patch: SongPatch) =>
      request<{ song: AdminSong }>(`/api/admin/songs/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    bulkUpdate: (ids: string[], patch: SongPatch) =>
      request<{ updated: number }>("/api/admin/songs/bulk-update", { method: "POST", body: JSON.stringify({ ids, patch }) }),
    bulkDelete: (ids: string[]) =>
      request<{ deleted: number }>("/api/admin/songs/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }),
    retranscode: (id: string) => request<{ song: AdminSong }>(`/api/admin/songs/${id}/retranscode`, { method: "POST" }),
    setCover: (id: string, file: File, applyToAlbum: boolean) => {
      const fd = new FormData();
      fd.append("file", file);
      return request<{ song: AdminSong }>(`/api/admin/songs/${id}/cover${applyToAlbum ? "?applyToAlbum=1" : ""}`, {
        method: "POST",
        body: fd,
      });
    },
    /** Preview (apply=false) or apply title clean-up for the given songs, or all when ids is empty. */
    fixTitles: <A extends boolean>(ids: string[], apply: A) =>
      request<
        A extends true
          ? { applied: { songs: number; albums: number } }
          : {
              changes: {
                id: string;
                from: string;
                to: string;
                track: number | null;
                file: string | null;
                artistFrom?: string;
                artistTo?: string;
              }[];
              albums: { id: string; from: string; to: string }[];
            }
      >("/api/admin/songs/fix-titles", { method: "POST", body: JSON.stringify({ ids: ids.length ? ids : undefined, apply }) }),
    /** Find & replace in song details (case-insensitive). apply=false returns a preview. */
    replace: (req: {
      field: ReplaceField;
      find: string;
      replace: string;
      mode: "exact" | "contains";
      ids?: string[];
      apply: boolean;
    }) =>
      request<{
        changes?: { id: string; title: string; from: string; to: string }[];
        total?: number;
        albumWide?: boolean;
        updated?: number;
      }>("/api/admin/songs/replace", { method: "POST", body: JSON.stringify({ ...req, ids: req.ids?.length ? req.ids : undefined }) }),
    storage: {
      get: () => request<StorageState>("/api/admin/storage"),
      save: (body: { target?: StorageBackend; r2?: R2Form | null; s3?: S3Form | null }) =>
        request<StorageState>("/api/admin/storage", { method: "PUT", body: JSON.stringify(body) }),
      test: (body: { backend: "r2" | "s3"; r2?: R2Form; s3?: S3Form }) =>
        request<StorageTest>("/api/admin/storage/test", {
          method: "POST",
          body: JSON.stringify({ ...body, origin: location.origin }),
        }),
      allowSite: (backend: "r2" | "s3") =>
        request<{ ok: true; origins: string[] }>("/api/admin/storage/cors", {
          method: "POST",
          body: JSON.stringify({ backend, origin: location.origin }),
        }),
      move: (from: StorageBackend, to: StorageBackend) =>
        request<{ move: MoveJob }>("/api/admin/storage/move", { method: "POST", body: JSON.stringify({ from, to }) }),
      cancelMove: () => request<{ move: MoveJob }>("/api/admin/storage/move/cancel", { method: "POST" }),
    },
    changePassword: (current: string, next: string) =>
      request<{ ok: true }>("/api/admin/password", { method: "POST", body: JSON.stringify({ current, next }) }),
    /** Upload a single file with progress (XHR, since fetch has no upload progress). */
    upload: (file: File, fields: Record<string, string>, onProgress: (ratio: number) => void) =>
      new Promise<{ songs: AdminSong[]; errors: { file: string; error: string }[] }>((resolve, reject) => {
        const fd = new FormData();
        for (const [k, v] of Object.entries(fields)) if (v.trim()) fd.append(k, v.trim());
        fd.append("file", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", API_BASE + "/api/admin/upload");
        xhr.withCredentials = true;
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
        xhr.onload = () => {
          let data: { songs?: AdminSong[]; errors?: { file: string; error: string }[]; error?: string } = {};
          try {
            data = JSON.parse(xhr.responseText);
          } catch {
            /* ignore */
          }
          if (xhr.status >= 200 && xhr.status < 300) resolve({ songs: data.songs ?? [], errors: data.errors ?? [] });
          else reject(new ApiError(xhr.status, data.errors?.[0]?.error ?? data.error ?? `Upload failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new ApiError(0, "Network error during upload"));
        xhr.send(fd);
      }),
  },
};

export type StorageBackend = "local" | "r2" | "s3";

export interface R2Form {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  /** Empty = keep saved secret. */
  secretAccessKey?: string;
  publicUrl: string;
  jurisdiction: "" | "eu";
}

export interface S3Form {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey?: string;
  publicUrl: string;
  endpoint: string;
  forcePathStyle: boolean;
}

export interface MoveJob {
  running: boolean;
  from: StorageBackend;
  to: StorageBackend;
  total: number;
  done: number;
  failed: { id: string; title: string; error: string }[];
  bytes: number;
  current: string | null;
}

export interface StorageState {
  target: StorageBackend;
  effectiveTarget: StorageBackend;
  configured: Record<StorageBackend, boolean>;
  r2: (Omit<R2Form, "secretAccessKey"> & { hasSecret: boolean }) | null;
  s3: (Omit<S3Form, "secretAccessKey"> & { hasSecret: boolean }) | null;
  localDir: string;
  counts: Record<StorageBackend, number>;
  move: MoveJob | null;
}

export interface StorageTest {
  ok: boolean;
  steps: { name: string; ok: boolean; detail?: string }[];
  cors: "ok" | "missing" | "unknown";
}

export type ReplaceField = "artist" | "title" | "album" | "albumArtist" | "genre";

export interface SongPatch {
  title?: string;
  artistName?: string;
  albumTitle?: string | null;
  albumArtist?: string | null;
  genre?: string | null;
  year?: number | null;
  trackNo?: number | null;
  discNo?: number | null;
  lyrics?: string | null;
}

export const formatTime = (s: number | null | undefined) => {
  if (!s || !isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

export const formatBytes = (n: number | null | undefined) => {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
};
