import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { config } from "./config.js";
import { client, connectDb } from "./db.js";
import { reindexOutdatedSongs } from "./catalog.js";
import { seedAdmin } from "./auth.js";
import { resumePendingJobs } from "./media/pipeline.js";
import { publicRoutes } from "./routes/public.js";
import { streamRoutes } from "./routes/stream.js";
import { adminRoutes } from "./routes/admin.js";
import { storageRoutes } from "./routes/storage.js";
import { loadStorageSettings, uploadTarget } from "./storage-settings.js";

async function main() {
  await connectDb();
  await loadStorageSettings();
  await seedAdmin();
  await reindexOutdatedSongs();

  const app = Fastify({
    logger: { level: config.isProd ? "info" : "warn" },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 200, fields: 20 },
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "Invalid request", issues: err.issues });
    }
    const e = err as { statusCode?: number; message: string };
    const status = e.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? "Internal server error" : e.message });
  });

  app.get("/api/health", async () => ({ ok: true, storage: uploadTarget() }));

  await app.register(publicRoutes);
  await app.register(streamRoutes);
  await app.register(adminRoutes);
  await app.register(storageRoutes);

  // Serve the built web app (npm run build at repo root) with SPA fallback.
  if (fs.existsSync(config.webDistDir)) {
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      prefix: "/",
      wildcard: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes("/assets/")) res.header("cache-control", "public, max-age=31536000, immutable");
        else res.header("cache-control", "no-cache");
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    const isPage = req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/media/");
    if (isPage && fs.existsSync(`${config.webDistDir}/index.html`)) {
      return reply.header("cache-control", "no-cache").sendFile("index.html", config.webDistDir);
    }
    return reply.code(404).send({ error: "Not found" });
  });

  await app.listen({ port: config.port, host: config.host });
  console.log(`Media Player Classic API on http://localhost:${config.port}  (uploads go to: ${uploadTarget()})`);

  await resumePendingJobs();

  const shutdown = async () => {
    await app.close();
    await client.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
