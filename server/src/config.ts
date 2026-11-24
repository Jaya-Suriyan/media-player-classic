import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const dataDir = path.resolve(str("DATA_DIR", "./data"));
const isProd = process.env.NODE_ENV === "production";

const jwtSecret = str("JWT_SECRET");
if (!jwtSecret || (isProd && jwtSecret.startsWith("change-me"))) {
  throw new Error("JWT_SECRET must be set (and changed from the example) — see server/.env.example");
}

function resolveFfmpeg(): string {
  const override = str("FFMPEG_PATH");
  if (override) return override;
  try {
    const p = require("ffmpeg-static") as string | null;
    if (p) return p;
  } catch {
    /* fall through */
  }
  return "ffmpeg";
}

export const config = {
  isProd,
  port: num("PORT", 3000),
  host: str("HOST", "0.0.0.0"),
  publicBaseUrl: str("PUBLIC_BASE_URL").replace(/\/$/, ""),
  corsOrigins: str("CORS_ORIGINS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  dataDir,
  mongoUrl: str("MONGODB_URI", "mongodb://127.0.0.1:27017"),
  mongoDb: str("MONGODB_DB", "media_player_classic"),
  tmpDir: path.join(dataDir, "tmp"),
  webDistDir: path.resolve(str("WEB_DIST_DIR", "../dist")),

  jwtSecret,
  adminEmail: str("ADMIN_EMAIL"),
  adminPassword: str("ADMIN_PASSWORD"),

  storage: {
    driver: str("STORAGE_DRIVER", "local") as "local" | "s3",
    localDir: path.resolve(str("LOCAL_STORAGE_DIR", path.join(dataDir, "media"))),
    s3: {
      bucket: str("S3_BUCKET"),
      region: str("S3_REGION", "auto"),
      endpoint: str("S3_ENDPOINT") || undefined,
      accessKeyId: str("S3_ACCESS_KEY_ID"),
      secretAccessKey: str("S3_SECRET_ACCESS_KEY"),
      forcePathStyle: str("S3_FORCE_PATH_STYLE") === "true",
      publicBaseUrl: str("S3_PUBLIC_BASE_URL").replace(/\/$/, ""),
    },
  },

  ffmpegPath: resolveFfmpeg(),
  transcodeConcurrency: num("TRANSCODE_CONCURRENCY", 1),
  maxUploadBytes: num("MAX_UPLOAD_MB", 300) * 1024 * 1024,
};
