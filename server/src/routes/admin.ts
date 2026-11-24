import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import type { Filter, Sort } from "mongodb";
import { z } from "zod";
import {
  authenticate,
  changePassword,
  COOKIE_NAME,
  requireAdmin,
  setAuthCookie,
  signToken,
  verifyLogin,
} from "../auth.js";
import { adminSong, adminSongs, deleteSongDoc, getSong, setSongFields, songsByIds, updateSong } from "../catalog.js";
import { config } from "../config.js";
import { albums, artists, escapeRegex, newId, songs, type SongDoc } from "../db.js";
import {
  AUDIO_EXTENSIONS,
  deleteCover,
  deleteSongMedia,
  enqueueTranscode,
  ingestAudioFile,
  queueState,
  storeCover,
} from "../media/pipeline.js";
import { BACKENDS, backendOf, isConfigured, type BackendName } from "../storage/index.js";
import { uploadTarget } from "../storage-settings.js";
import { applyTitleFixes, planTitleFixes } from "../media/fix-titles.js";
import { applyReplace, previewReplace } from "../media/replace.js";

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim())
    .nullable()
    .optional();

const songPatch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  artistName: z.string().trim().min(1).max(300).optional(),
  albumTitle: optionalText(300),
  albumArtist: optionalText(300),
  genre: optionalText(100),
  year: z.number().int().min(1000).max(3000).nullable().optional(),
  trackNo: z.number().int().min(0).max(9999).nullable().optional(),
  discNo: z.number().int().min(0).max(999).nullable().optional(),
  lyrics: z.string().max(50_000).nullable().optional(),
});

const idList = z.array(z.string().min(1).max(40)).min(1).max(1000);

/** Remove a cover prefix only if no song or album still points at it. */
async function deleteCoverIfUnused(prefix: string | null) {
  if (!prefix) return;
  const used =
    (await songs.countDocuments({ coverKey: prefix }, { limit: 1 })) ||
    (await albums.countDocuments({ coverKey: prefix }, { limit: 1 }));
  if (!used) await deleteCover(prefix);
}

async function removeSong(doc: SongDoc) {
  await deleteSongDoc(doc);
  await deleteSongMedia(doc._id, doc.originalKey);
  await deleteCoverIfUnused(doc.coverKey);
}

export async function adminRoutes(app: FastifyInstance) {
  /* ---------------------------- Auth ---------------------------- */

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).parse(req.body);
      const user = await verifyLogin(body.email, body.password);
      if (!user) return reply.code(401).send({ error: "Invalid email or password" });
      const token = signToken(user);
      setAuthCookie(reply, token);
      // Token is also returned for non-browser clients (mobile apps) to send as Bearer.
      return { user, token };
    },
  );

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return { user: await authenticate(req) };
  });

  /* ----------------------- Admin (protected) -------------------- */

  await app.register(async (admin) => {
    admin.addHook("preHandler", requireAdmin);
    admin.addHook("onSend", async (_req, reply) => {
      reply.header("cache-control", "no-store");
    });

    admin.post("/api/admin/password", async (req, reply) => {
      const body = z.object({ current: z.string().min(1), next: z.string().min(8).max(200) }).parse(req.body);
      if (!(await changePassword(req.user!.id, body.current, body.next))) {
        return reply.code(400).send({ error: "Current password is incorrect" });
      }
      return { ok: true };
    });

    admin.get("/api/admin/stats", async () => {
      const [byStatus, totals, artistCount, albumCount] = await Promise.all([
        songs.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
        songs
          .aggregate<{ songs: number; plays: number; bytes: number }>([
            { $group: { _id: null, songs: { $sum: 1 }, plays: { $sum: "$playCount" }, bytes: { $sum: "$originalSize" } } },
          ])
          .toArray(),
        artists.estimatedDocumentCount(),
        albums.estimatedDocumentCount(),
      ]);
      const t = totals[0] ?? { songs: 0, plays: 0, bytes: 0 };
      return {
        songs: t.songs,
        artists: artistCount,
        albums: albumCount,
        plays: t.plays,
        bytes: t.bytes,
        byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.n])),
        queue: queueState(),
        storage: uploadTarget(),
      };
    });

    admin.get("/api/admin/songs", async (req) => {
      const q = z
        .object({
          q: z.string().max(200).default(""),
          status: z.enum(["all", "pending", "processing", "ready", "failed"]).default("all"),
          sort: z.enum(["new", "title", "artist", "plays"]).default("new"),
          limit: z.coerce.number().int().min(1).max(500).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);
      const filter: Filter<SongDoc> = {};
      if (q.status !== "all") filter.status = q.status;
      const words = q.q.trim().split(/\s+/).filter(Boolean).slice(0, 8);
      if (words.length) {
        filter.$and = words.map((w) => {
          const re = new RegExp(escapeRegex(w), "i");
          return { $or: [{ title: re }, { artistName: re }, { albumTitle: re }, { genre: re }, { originalName: re }] };
        });
      }
      const sort: Sort = {
        new: { createdAt: -1 },
        title: { title: 1 },
        artist: { artistName: 1, albumTitle: 1, discNo: 1, trackNo: 1 },
        plays: { playCount: -1 },
      }[q.sort] as Sort;
      const [total, docs] = await Promise.all([
        songs.countDocuments(filter),
        songs
          .find(filter, { projection: { search: 0 }, collation: { locale: "en", strength: 2 } })
          .sort(sort)
          .skip(q.offset)
          .limit(q.limit)
          .toArray(),
      ]);
      return { total, items: await adminSongs(docs as SongDoc[]) };
    });

    admin.get("/api/admin/songs/:id", async (req, reply) => {
      const doc = await getSong((req.params as { id: string }).id);
      if (!doc) return reply.code(404).send({ error: "Not found" });
      return { song: await adminSong(doc) };
    });

    /**
     * Upload one or more audio files (multipart). Optional text fields sent
     * *before* the files override tags for every file: artistName, albumTitle,
     * albumArtist, genre, year.
     */
    admin.post("/api/admin/upload", async (req, reply) => {
      const overrides: Record<string, string | number> = {};
      // Optional "storage" field (local | r2 | s3) before the files: where this batch is saved.
      let backend: BackendName = uploadTarget();
      const created: string[] = [];
      const errors: { file: string; error: string }[] = [];

      for await (const part of req.parts()) {
        if (part.type === "field") {
          const v = String(part.value ?? "").trim();
          if (!v) continue;
          if (["artistName", "albumTitle", "albumArtist", "genre"].includes(part.fieldname)) overrides[part.fieldname] = v.slice(0, 300);
          if (part.fieldname === "year" && /^\d{4}$/.test(v)) overrides.year = Number(v);
          if (part.fieldname === "storage") {
            if (!BACKENDS.includes(v as BackendName)) return reply.code(400).send({ error: `Unknown storage "${v}"` });
            if (!isConfigured(v as BackendName)) return reply.code(400).send({ error: `Storage "${v}" is not set up yet. Configure it in Admin → Storage.` });
            backend = v as BackendName;
          }
          continue;
        }
        const name = path.basename(part.filename || "upload");
        const ext = path.extname(name).toLowerCase();
        if (!AUDIO_EXTENSIONS.has(ext)) {
          part.file.resume();
          errors.push({ file: name, error: `Unsupported file type ${ext || "(none)"}` });
          continue;
        }
        const tmp = path.join(config.tmpDir, `upload-${newId()}${ext}`);
        try {
          await pipeline(part.file, fs.createWriteStream(tmp));
          if (part.file.truncated) throw new Error(`File is larger than ${config.maxUploadBytes / 1024 / 1024} MB`);
          created.push(await ingestAudioFile(tmp, name, overrides, backend));
        } catch (err) {
          errors.push({ file: name, error: (err as Error).message });
          await fsp.rm(tmp, { force: true });
        }
      }

      reply.code(created.length ? 201 : 400);
      return { songs: await adminSongs(await songsByIds(created, false)), errors };
    });

    admin.patch("/api/admin/songs/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const doc = await updateSong(id, songPatch.parse(req.body));
      if (!doc) return reply.code(404).send({ error: "Not found" });
      return { song: await adminSong(doc) };
    });

    /** Apply the same changes to many songs, e.g. set album / artist / genre for a batch. */
    admin.post("/api/admin/songs/bulk-update", async (req) => {
      const body = z
        .object({ ids: idList, patch: songPatch.omit({ title: true, trackNo: true, lyrics: true }) })
        .parse(req.body);
      let updated = 0;
      for (const id of body.ids) if (await updateSong(id, body.patch)) updated++;
      return { updated };
    });

    /**
     * Clean up titles of songs already uploaded ("008" → "Neruppu", "01 - Movie - Song" → "Song").
     * `apply: false` returns a preview; `ids` limits it to selected songs.
     */
    admin.post("/api/admin/songs/fix-titles", async (req) => {
      const body = z.object({ ids: z.array(z.string().max(40)).max(20_000).optional(), apply: z.boolean().default(false) }).parse(req.body ?? {});
      if (!body.apply) return planTitleFixes(body.ids);
      return { applied: await applyTitleFixes(body.ids) };
    });

    /**
     * Find & replace in song details (case-insensitive). Artists are matched one by one,
     * so a single artist can be replaced inside "A, B, C". `apply: false` previews.
     */
    admin.post("/api/admin/songs/replace", async (req, reply) => {
      const body = z
        .object({
          field: z.enum(["artist", "title", "album", "albumArtist", "genre"]),
          find: z.string().trim().min(1).max(300),
          replace: z.string().max(300).default(""),
          mode: z.enum(["exact", "contains"]).default("exact"),
          ids: z.array(z.string().max(40)).max(20_000).optional(),
          apply: z.boolean().default(false),
        })
        .parse(req.body);
      if (body.field === "title" && !body.replace.trim() && body.mode === "exact") {
        return reply.code(400).send({ error: "A song title can't be empty." });
      }
      return body.apply ? applyReplace(body) : previewReplace(body);
    });

    admin.post("/api/admin/songs/bulk-delete", async (req) => {
      const body = z.object({ ids: idList }).parse(req.body);
      let deleted = 0;
      for (const doc of await songsByIds(body.ids, false)) {
        await removeSong(doc);
        deleted++;
      }
      return { deleted };
    });

    admin.delete("/api/admin/songs/:id", async (req, reply) => {
      const doc = await getSong((req.params as { id: string }).id);
      if (!doc) return reply.code(404).send({ error: "Not found" });
      await removeSong(doc);
      return { ok: true };
    });

    admin.post("/api/admin/songs/:id/retranscode", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!(await getSong(id))) return reply.code(404).send({ error: "Not found" });
      await setSongFields(id, { status: "pending", error: null });
      enqueueTranscode(id);
      return { song: await adminSong((await getSong(id))!) };
    });

    /** Replace artwork. `?applyToAlbum=1` also sets it as the album cover. */
    admin.post("/api/admin/songs/:id/cover", async (req, reply) => {
      const { id } = req.params as { id: string };
      const { applyToAlbum } = z.object({ applyToAlbum: z.string().optional() }).parse(req.query);
      const doc = await getSong(id);
      if (!doc) return reply.code(404).send({ error: "Not found" });
      const file = await req.file({ limits: { fileSize: 15 * 1024 * 1024 } });
      if (!file) return reply.code(400).send({ error: "No image uploaded" });
      if (!file.mimetype.startsWith("image/")) {
        file.file.resume();
        return reply.code(400).send({ error: "File must be an image" });
      }
      const buf = await file.toBuffer();
      const prefix = await storeCover(id, buf, backendOf(doc.originalKey));
      await setSongFields(id, { coverKey: prefix });
      if (applyToAlbum && doc.albumId) {
        const album = await albums.findOneAndUpdate({ _id: doc.albumId }, { $set: { coverKey: prefix } });
        await deleteCoverIfUnused(album?.coverKey ?? null);
      }
      await deleteCoverIfUnused(doc.coverKey);
      return { song: await adminSong((await getSong(id))!) };
    });
  });
}
