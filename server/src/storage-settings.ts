/**
 * Admin-editable storage settings, saved in MongoDB.
 * Secret keys are encrypted (AES-256-GCM) with a key derived from
 * SETTINGS_SECRET (or JWT_SECRET) and are never sent back to the browser.
 */
import crypto from "node:crypto";
import { config } from "./config.js";
import { now, settings } from "./db.js";
import { configureRemote, isConfigured, type BackendName } from "./storage/index.js";
import type { S3Options } from "./storage/s3.js";

export interface R2Settings {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string; // encrypted at rest
  /** Public bucket URL (r2.dev or custom domain). Empty = private bucket with signed URLs. */
  publicUrl: string;
  /** "" (default) or "eu" for EU-jurisdiction buckets. */
  jurisdiction: "" | "eu";
}

export interface S3Settings {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string; // encrypted at rest
  publicUrl: string;
  /** Only for S3-compatible services (MinIO, Wasabi, B2…). Empty for AWS. */
  endpoint: string;
  forcePathStyle: boolean;
}

export interface StorageSettings {
  /** Where new uploads go. */
  target: BackendName;
  r2: R2Settings | null;
  s3: S3Settings | null;
  updatedAt: number;
}

const ID = "storage";

/* ------------------------------ secrets ------------------------------ */

const keyMaterial = crypto
  .createHash("sha256")
  .update(`${process.env.SETTINGS_SECRET || config.jwtSecret}:storage-settings`)
  .digest();

export function encrypt(plain: string) {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyMaterial, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

export function decrypt(blob: string) {
  if (!blob) return "";
  const [v, iv, tag, data] = blob.split(":");
  if (v !== "v1") return "";
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", keyMaterial, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    // Secret key changed (JWT_SECRET / SETTINGS_SECRET): credentials must be re-entered.
    return "";
  }
}

/* --------------------------- client options -------------------------- */

export const r2Endpoint = (r: Pick<R2Settings, "accountId" | "jurisdiction">) =>
  `https://${r.accountId}.${r.jurisdiction ? `${r.jurisdiction}.` : ""}r2.cloudflarestorage.com`;

export function r2Options(r: R2Settings, secret: string): S3Options {
  return {
    bucket: r.bucket,
    region: "auto",
    endpoint: r2Endpoint(r),
    accessKeyId: r.accessKeyId,
    secretAccessKey: secret,
    forcePathStyle: false,
    publicBaseUrl: r.publicUrl.replace(/\/$/, ""),
  };
}

export function s3Options(s: S3Settings, secret: string): S3Options {
  return {
    bucket: s.bucket,
    region: s.region || "us-east-1",
    endpoint: s.endpoint || undefined,
    accessKeyId: s.accessKeyId,
    secretAccessKey: secret,
    forcePathStyle: s.forcePathStyle,
    publicBaseUrl: s.publicUrl.replace(/\/$/, ""),
  };
}

const complete = (o: { bucket: string; accessKeyId: string }, secret: string) => !!(o.bucket && o.accessKeyId && secret);

/* ------------------------------ load/save ---------------------------- */

let current: StorageSettings = { target: "local", r2: null, s3: null, updatedAt: 0 };

export const getStorageSettings = () => current;
export const uploadTarget = (): BackendName => (isConfigured(current.target) ? current.target : "local");

function apply(s: StorageSettings) {
  current = s;
  const r2Secret = s.r2 ? decrypt(s.r2.secretAccessKey) : "";
  const s3Secret = s.s3 ? decrypt(s.s3.secretAccessKey) : "";
  configureRemote("r2", s.r2 && s.r2.accountId && complete(s.r2, r2Secret) ? r2Options(s.r2, r2Secret) : null);
  configureRemote("s3", s.s3 && complete(s.s3, s3Secret) ? s3Options(s.s3, s3Secret) : null);
}

/** Load settings at startup. First run: seed from the STORAGE_DRIVER / S3_* env vars, if any. */
export async function loadStorageSettings() {
  const doc = (await settings.findOne({ _id: ID })) as (StorageSettings & { _id: string }) | null;
  if (doc) {
    apply({ target: doc.target, r2: doc.r2, s3: doc.s3, updatedAt: doc.updatedAt });
    return;
  }
  const env = config.storage;
  let seeded: StorageSettings = { target: "local", r2: null, s3: null, updatedAt: now() };
  if (env.driver === "s3" && env.s3.bucket) {
    const isR2 = env.s3.endpoint?.includes("r2.cloudflarestorage.com");
    if (isR2) {
      const m = env.s3.endpoint!.match(/https?:\/\/([^.]+)\.(?:(eu)\.)?r2\.cloudflarestorage\.com/);
      seeded.r2 = {
        accountId: m?.[1] ?? "",
        jurisdiction: (m?.[2] as "eu" | undefined) ?? "",
        bucket: env.s3.bucket,
        accessKeyId: env.s3.accessKeyId,
        secretAccessKey: encrypt(env.s3.secretAccessKey),
        publicUrl: env.s3.publicBaseUrl,
      };
      seeded.target = "r2";
    } else {
      seeded.s3 = {
        region: env.s3.region,
        bucket: env.s3.bucket,
        accessKeyId: env.s3.accessKeyId,
        secretAccessKey: encrypt(env.s3.secretAccessKey),
        publicUrl: env.s3.publicBaseUrl,
        endpoint: env.s3.endpoint ?? "",
        forcePathStyle: env.s3.forcePathStyle,
      };
      seeded.target = "s3";
    }
  }
  await settings.updateOne({ _id: ID }, { $set: { ...seeded } as Record<string, unknown> }, { upsert: true });
  apply(seeded);
}

export async function saveStorageSettings(next: StorageSettings) {
  next.updatedAt = now();
  await settings.updateOne({ _id: ID }, { $set: { ...next } as Record<string, unknown> }, { upsert: true });
  apply(next);
}

/** Settings as shown to the admin: secrets replaced by a "set / not set" flag. */
export function publicStorageSettings() {
  const s = current;
  const mask = <T extends { secretAccessKey: string }>(x: T | null) =>
    x ? { ...x, secretAccessKey: undefined, hasSecret: !!decrypt(x.secretAccessKey) } : null;
  return {
    target: s.target,
    effectiveTarget: uploadTarget(),
    configured: { local: true, r2: isConfigured("r2"), s3: isConfigured("s3") },
    r2: mask(s.r2),
    s3: mask(s.s3),
    localDir: config.storage.localDir,
  };
}
