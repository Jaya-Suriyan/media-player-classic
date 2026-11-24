import path from "node:path";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { getSong } from "../catalog.js";
import { config } from "../config.js";
import { LADDER, masterPlaylist } from "../media/ffmpeg.js";
import { storage } from "../storage/index.js";

const VARIANTS = new Set<string>(LADDER.map((v) => v.name));
const M3U8 = "application/vnd.apple.mpegurl";

/** Small in-memory cache of rewritten variant playlists (they are immutable per hls_key). */
const playlistCache = new Map<string, { body: string; expires: number }>();

/**
 * Rewrite a variant playlist so every segment / init URI points straight at
 * storage (CDN URL, signed S3/R2 URL, or this server's /media route). The API
 * only serves a few KB of text; audio bytes never pass through Node when
 * using S3/R2.
 */
async function rewritePlaylist(text: string, baseKey: string) {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#EXT-X-MAP:")) {
      const m = t.match(/URI="([^"]+)"/);
      if (m) {
        out.push(t.replace(m[0], `URI="${await storage.url(`${baseKey}/${m[1]}`)}"`));
        continue;
      }
    }
    if (!t.startsWith("#")) {
      out.push(await storage.url(`${baseKey}/${t}`));
      continue;
    }
    out.push(t);
  }
  return out.join("\n") + "\n";
}

export async function streamRoutes(app: FastifyInstance) {
  app.get("/api/stream/:id/master.m3u8", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await getSong(id);
    if (!row || row.status !== "ready" || !row.hlsKey) return reply.code(404).send({ error: "Not available" });
    return reply
      .type(M3U8)
      .header("cache-control", "public, max-age=300")
      .send(masterPlaylist());
  });

  app.get("/api/stream/:id/:variant/index.m3u8", async (req, reply) => {
    const { id, variant } = req.params as { id: string; variant: string };
    if (!VARIANTS.has(variant)) return reply.code(404).send({ error: "Unknown variant" });
    const row = await getSong(id);
    if (!row || row.status !== "ready" || !row.hlsKey) return reply.code(404).send({ error: "Not available" });

    const baseKey = `${row.hlsKey}/${variant}`;
    const cacheKey = baseKey;
    const now = Date.now();
    let cached = playlistCache.get(cacheKey);
    if (!cached || cached.expires < now) {
      const raw = (await storage.getBuffer(`${baseKey}/index.m3u8`)).toString("utf8");
      // Signed URLs are valid for 6h; refresh the rewritten list well before that.
      cached = { body: await rewritePlaylist(raw, baseKey), expires: now + 60 * 60 * 1000 };
      playlistCache.set(cacheKey, cached);
      if (playlistCache.size > 5000) playlistCache.clear();
    }
    return reply
      .type(M3U8)
      .header("cache-control", storage.driver === "local" ? "public, max-age=86400" : "private, max-age=600")
      .send(cached.body);
  });

  // Local storage driver: serve HLS segments + covers with range & caching support.
  if (storage.driver === "local") {
    await app.register(fastifyStatic, {
      root: config.storage.localDir,
      prefix: "/media/",
      decorateReply: false,
      index: false,
      list: false,
      dotfiles: "deny",
      acceptRanges: true,
      etag: true,
      cacheControl: true,
      maxAge: "365d",
      immutable: true,
      // Never expose uploaded originals, only transcoded streams and artwork.
      allowedPath: (pathName) => {
        const p = pathName.split(path.sep).join("/").replace(/^\/+/, "");
        return /^songs\/[a-z0-9]+\/hls\//.test(p) || p.startsWith("covers/");
      },
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".m4s") || filePath.endsWith(".mp4")) res.header("content-type", "audio/mp4");
        res.header("access-control-allow-origin", "*");
      },
    });
  }
}
