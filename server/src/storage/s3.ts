import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Storage, PutOptions } from "./types.js";

export interface S3Options {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBaseUrl: string;
}

/**
 * Works with AWS S3 and any S3-compatible store: Cloudflare R2, MinIO,
 * Backblaze B2, Wasabi, DigitalOcean Spaces...
 */
export class S3Storage implements Storage {
  readonly driver = "s3" as const;
  private client: S3Client;
  /** Signed URLs are cached so playlists stay byte-identical (CDN/HTTP cache friendly). */
  private signedCache = new Map<string, { url: string; expires: number }>();

  constructor(private readonly opts: S3Options) {
    if (!opts.bucket) throw new Error("S3_BUCKET is required for the s3 storage driver");
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials:
        opts.accessKeyId && opts.secretAccessKey
          ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey }
          : undefined,
    });
  }

  async putFile(key: string, filePath: string, o?: PutOptions) {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.opts.bucket,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentType: o?.contentType,
        CacheControl: o?.cacheControl,
      },
    });
    await upload.done();
  }

  async putBuffer(key: string, body: Buffer, o?: PutOptions) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        Body: body,
        ContentType: o?.contentType,
        CacheControl: o?.cacheControl,
      }),
    );
  }

  async getBuffer(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async download(key: string, destPath: string) {
    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    await pipeline(res.Body as Readable, fs.createWriteStream(destPath));
  }

  async getStream(key: string, range?: { start: number; end?: number }) {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined,
      }),
    );
    return res.Body as Readable;
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string) {
    const out: { key: string; size: number }[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.opts.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) out.push({ key: o.Key!, size: o.Size ?? 0 });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }

  /** Allow browsers on these origins to fetch media directly (needed for streaming from the bucket). */
  async setCors(origins: string[]) {
    await this.client.send(
      new PutBucketCorsCommand({
        Bucket: this.opts.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: origins.length ? origins : ["*"],
              AllowedMethods: ["GET", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["Content-Length", "Content-Range", "ETag"],
              MaxAgeSeconds: 86400,
            },
          ],
        },
      }),
    );
  }

  async deletePrefix(prefix: string) {
    if (!prefix || prefix === "/") throw new Error("Refusing to delete storage root");
    let token: string | undefined;
    do {
      const list = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.opts.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const objects = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (objects.length) {
        await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.opts.bucket, Delete: { Objects: objects } }),
        );
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }

  async url(key: string, ttlSeconds = 6 * 3600) {
    if (this.opts.publicBaseUrl) {
      return `${this.opts.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
    }
    const now = Date.now();
    const cached = this.signedCache.get(key);
    // Reuse while at least half the lifetime is left.
    if (cached && cached.expires - now > (ttlSeconds * 1000) / 2) return cached.url;
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
    this.signedCache.set(key, { url, expires: now + ttlSeconds * 1000 });
    if (this.signedCache.size > 50_000) this.signedCache.clear();
    return url;
  }
}
