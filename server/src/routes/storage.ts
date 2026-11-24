import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { config } from "../config.js";
import { newId } from "../db.js";
import { cancelMove, countByBackend, moveStatus, startMove } from "../media/move.js";
import { isConfigured, remote, type BackendName } from "../storage/index.js";
import { S3Storage } from "../storage/s3.js";
import {
  decrypt,
  encrypt,
  getStorageSettings,
  publicStorageSettings,
  r2Options,
  s3Options,
  saveStorageSettings,
  type R2Settings,
  type S3Settings,
} from "../storage-settings.js";

const backend = z.enum(["local", "r2", "s3"]);
const text = (max = 300) => z.string().trim().max(max);

const r2Input = z.object({
  accountId: text(64).regex(/^(?:[a-f0-9]{32})?$/i, "Account ID is the 32-character ID shown on the Cloudflare R2 overview page"),
  bucket: text(63),
  accessKeyId: text(128),
  /** Empty = keep the saved secret. */
  secretAccessKey: z.string().max(256).optional(),
  publicUrl: z.union([z.literal(""), z.string().trim().url()]).default(""),
  jurisdiction: z.enum(["", "eu"]).default(""),
});

const s3Input = z.object({
  region: text(40),
  bucket: text(63),
  accessKeyId: text(128),
  secretAccessKey: z.string().max(256).optional(),
  publicUrl: z.union([z.literal(""), z.string().trim().url()]).default(""),
  endpoint: z.union([z.literal(""), z.string().trim().url()]).default(""),
  forcePathStyle: z.boolean().default(false),
});

function mergeR2(input: z.infer<typeof r2Input>, saved: R2Settings | null): R2Settings {
  return {
    ...input,
    secretAccessKey: input.secretAccessKey ? encrypt(input.secretAccessKey) : (saved?.secretAccessKey ?? ""),
  };
}
function mergeS3(input: z.infer<typeof s3Input>, saved: S3Settings | null): S3Settings {
  return {
    ...input,
    secretAccessKey: input.secretAccessKey ? encrypt(input.secretAccessKey) : (saved?.secretAccessKey ?? ""),
  };
}

/** Origins that should be allowed to fetch media straight from the bucket. */
function siteOrigins(clientOrigin?: string) {
  return [...new Set([clientOrigin, config.publicBaseUrl, ...config.corsOrigins].filter((o): o is string => !!o))];
}

interface Step {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Write, read, fetch through the playback URL (checking CORS) and delete a small test file. */
async function testBucket(store: S3Storage, origin: string | undefined) {
  const steps: Step[] = [];
  const key = `__mpc_test__/${newId()}.txt`;
  const body = Buffer.from(`media-player-classic test ${new Date().toISOString()}`);
  let cors: "ok" | "missing" | "unknown" = "unknown";
  const step = async (name: string, fn: () => Promise<string | void>) => {
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail: detail || undefined });
      return true;
    } catch (err) {
      const e = err as { name?: string; message?: string; code?: string; $metadata?: { httpStatusCode?: number } };
      const code = e.$metadata?.httpStatusCode;
      const network = /EPROTO|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|handshake/i.test(`${e.code} ${e.message}`);
      if (network) {
        steps.push({
          name,
          ok: false,
          detail: "Couldn't connect to the storage service. Check the Account ID / endpoint and region, and that this server has internet access.",
        });
        return false;
      }
      const hint =
        e.name === "InvalidAccessKeyId" || e.name === "SignatureDoesNotMatch"
          ? "Check the access key ID and secret."
          : e.name === "NoSuchBucket"
            ? "The bucket name doesn't exist on this account."
            : e.name === "AccessDenied" || code === 403
              ? "The key doesn't have permission for this bucket (needs Object Read & Write)."
              : "";
      steps.push({ name, ok: false, detail: [e.message ?? String(err), hint].filter(Boolean).join(" ") });
      return false;
    }
  };

  if (!(await step("Upload a test file", () => store.putBuffer(key, body, { contentType: "text/plain" })))) {
    return { ok: false, steps, cors };
  }
  await step("Read it back", async () => {
    const got = await store.getBuffer(key);
    if (!got.equals(body)) throw new Error("Content did not match");
  });
  await step("Fetch it the way the player will", async () => {
    const url = await store.url(key, 300);
    const res = await fetch(url, { headers: origin ? { Origin: origin } : {} });
    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status} from ${new URL(url).host}.` +
          (res.status === 401 || res.status === 403 || res.status === 404
            ? " If you set a public URL, make sure public access is enabled for the bucket (r2.dev or custom domain)."
            : ""),
      );
    }
    const allow = res.headers.get("access-control-allow-origin");
    cors = allow && (allow === "*" || allow === origin) ? "ok" : "missing";
    return cors === "ok" ? "Browser access (CORS) is allowed." : "Works, but browsers are not yet allowed to load files (CORS). Use “Allow this site”.";
  });
  await step("Delete the test file", () => store.deleteObject(key));
  return { ok: steps.every((s) => s.ok), steps, cors };
}

export async function storageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);
  app.addHook("onSend", async (_req, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.get("/api/admin/storage", async () => ({
    ...publicStorageSettings(),
    counts: await countByBackend(),
    move: moveStatus(),
  }));

  /** Save credentials and/or choose where new uploads go. */
  app.put("/api/admin/storage", async (req, reply) => {
    const body = z
      .object({
        target: backend.optional(),
        r2: r2Input.nullable().optional(),
        s3: s3Input.nullable().optional(),
      })
      .parse(req.body);
    const cur = getStorageSettings();
    const next = {
      ...cur,
      r2: body.r2 === undefined ? cur.r2 : body.r2 === null ? null : mergeR2(body.r2, cur.r2),
      s3: body.s3 === undefined ? cur.s3 : body.s3 === null ? null : mergeS3(body.s3, cur.s3),
      target: body.target ?? cur.target,
    };
    const counts = await countByBackend();
    if (body.r2 === null && counts.r2) return reply.code(400).send({ error: `${counts.r2} songs are stored on R2. Move them first.` });
    if (body.s3 === null && counts.s3) return reply.code(400).send({ error: `${counts.s3} songs are stored on S3. Move them first.` });
    await saveStorageSettings(next);
    if (!isConfigured(next.target)) {
      await saveStorageSettings({ ...next, target: cur.target });
      return reply.code(400).send({ error: "Fill in all details for that storage before using it for uploads." });
    }
    return { ...publicStorageSettings(), counts };
  });

  /** Test R2 / S3 with the form values (unsaved) or the saved settings. */
  app.post("/api/admin/storage/test", async (req, reply) => {
    const body = z
      .object({ backend: z.enum(["r2", "s3"]), r2: r2Input.optional(), s3: s3Input.optional(), origin: z.string().max(200).optional() })
      .parse(req.body);
    const cur = getStorageSettings();
    let store: S3Storage;
    if (body.backend === "r2") {
      const r2 = body.r2 ? mergeR2(body.r2, cur.r2) : cur.r2;
      const secret = r2 ? decrypt(r2.secretAccessKey) : "";
      if (!r2?.accountId || !r2.bucket || !r2.accessKeyId || !secret) {
        return reply.code(400).send({ error: "Fill in account ID, bucket, access key ID and secret access key." });
      }
      store = new S3Storage(r2Options(r2, secret));
    } else {
      const s3 = body.s3 ? mergeS3(body.s3, cur.s3) : cur.s3;
      const secret = s3 ? decrypt(s3.secretAccessKey) : "";
      if (!s3?.bucket || !s3.accessKeyId || !secret) {
        return reply.code(400).send({ error: "Fill in bucket, access key ID and secret access key." });
      }
      store = new S3Storage(s3Options(s3, secret));
    }
    return testBucket(store, body.origin);
  });

  /** Allow this site's origins to load media straight from the bucket. */
  app.post("/api/admin/storage/cors", async (req, reply) => {
    const body = z.object({ backend: z.enum(["r2", "s3"]), origin: z.string().max(200).optional() }).parse(req.body);
    const origins = siteOrigins(body.origin);
    try {
      await remote(body.backend).setCors(origins);
      return { ok: true, origins };
    } catch (err) {
      const e = err as { name?: string; message?: string };
      return reply.code(400).send({
        error:
          (e.message ?? "Could not update CORS") +
          (e.name === "AccessDenied"
            ? body.backend === "r2"
              ? " This R2 token can't change bucket settings. Add the rule in Cloudflare → R2 → your bucket → Settings → CORS policy."
              : " This key can't change bucket settings (needs s3:PutBucketCORS)."
            : ""),
        origins,
      });
    }
  });

  app.post("/api/admin/storage/move", async (req, reply) => {
    const body = z.object({ from: backend, to: backend, ids: z.array(z.string().max(40)).max(20_000).optional() }).parse(req.body);
    if (!isConfigured(body.to)) return reply.code(400).send({ error: "Set up that storage first." });
    if (!isConfigured(body.from)) return reply.code(400).send({ error: "The storage to move from is not configured." });
    try {
      return { move: await startMove(body.from as BackendName, body.to as BackendName, body.ids) };
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/storage/move/cancel", async () => {
    cancelMove();
    return { move: moveStatus() };
  });
}
