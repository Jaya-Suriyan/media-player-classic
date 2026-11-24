import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  albumSongs,
  artistOrAlbumArtistSongs,
  artistSongs,
  getAlbums,
  getArtists,
  getSong,
  incrementPlay,
  listAlbums,
  listArtists,
  listGenres,
  listSongs,
  publicSong,
  publicSongs,
  songsByIds,
} from "../catalog.js";
import { search } from "../search.js";

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function publicRoutes(app: FastifyInstance) {
  // Short shared cache for catalogue reads: cheap for CDNs, still fresh after uploads.
  app.addHook("onSend", async (req, reply) => {
    if (req.method === "GET" && reply.statusCode === 200 && !reply.hasHeader("cache-control")) {
      reply.header("cache-control", "public, max-age=30, stale-while-revalidate=300");
    }
  });

  app.get("/api/home", async () => {
    const [newReleases, trending, artists, albums, genres] = await Promise.all([
      listSongs({ sort: "new", limit: 12 }).then(publicSongs),
      listSongs({ sort: "popular", limit: 12 }).then(publicSongs),
      listArtists(12),
      listAlbums({ limit: 12 }),
      listGenres(),
    ]);
    return { newReleases, trending, artists, albums, genres };
  });

  app.get("/api/songs", async (req) => {
    const q = paging
      .extend({
        sort: z.enum(["new", "popular", "title"]).default("new"),
        genre: z.string().max(100).optional(),
      })
      .parse(req.query);
    return { items: await publicSongs(await listSongs(q)) };
  });

  /** Fetch many songs at once (used to restore liked songs / history / queue). */
  app.get("/api/songs/batch", async (req) => {
    const { ids } = z.object({ ids: z.string().max(5000) }).parse(req.query);
    const list = ids.split(",").filter(Boolean).slice(0, 300);
    return { items: await publicSongs(await songsByIds(list)) };
  });

  app.get("/api/songs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = await getSong(id);
    if (!doc || doc.status !== "ready") return reply.code(404).send({ error: "Song not found" });
    const related = (await artistSongs(doc.artistIds[0], 11)).filter((s) => s._id !== id).slice(0, 10);
    return { song: await publicSong(doc), lyrics: doc.lyrics, related: await publicSongs(related) };
  });

  app.post("/api/songs/:id/play", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await incrementPlay(id))) return reply.code(404).send({ error: "Song not found" });
    return { ok: true };
  });

  app.get("/api/artists", async (req) => {
    const q = paging.extend({ sort: z.enum(["popular", "name"]).default("popular") }).parse(req.query);
    return { items: await listArtists(q.limit, q.offset, q.sort) };
  });

  app.get("/api/artists/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [artist] = await getArtists([id]);
    if (!artist) return reply.code(404).send({ error: "Artist not found" });
    const [songs, albums] = await Promise.all([
      artistOrAlbumArtistSongs(id, 200).then(publicSongs),
      listAlbums({ artistId: id, limit: 100 }),
    ]);
    return { artist, songs, albums };
  });

  app.get("/api/albums", async (req) => ({ items: await listAlbums(paging.parse(req.query)) }));

  app.get("/api/albums/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [album] = await getAlbums([id]);
    if (!album) return reply.code(404).send({ error: "Album not found" });
    return { album, songs: await publicSongs(await albumSongs(id)) };
  });

  app.get("/api/genres", async () => ({ items: await listGenres() }));

  app.get("/api/search", async (req) => {
    const { q, limit } = z
      .object({ q: z.string().max(200).default(""), limit: z.coerce.number().int().min(1).max(100).default(30) })
      .parse(req.query);
    const res = await search(q, limit);
    const [songs, artists, albums] = await Promise.all([
      publicSongs(res.songs),
      getArtists(res.artistIds),
      getAlbums(res.albumIds),
    ]);
    return { query: q, fuzzy: res.fuzzy, songs, artists, albums };
  });

  /** Lightweight autocomplete: text only, no cover URLs. */
  app.get("/api/search/suggest", async (req) => {
    const { q } = z.object({ q: z.string().max(200).default("") }).parse(req.query);
    const res = await search(q, 6);
    const names = new Map(res.songs.flatMap((s) => s.artists.map((a) => [a.id, a.name] as const)));
    return {
      songs: res.songs.map((s) => ({ id: s._id, title: s.title, artist: s.artistName })),
      artists: res.artistIds.map((id) => ({ id, name: names.get(id)! })),
    };
  });
}
