import type { Readable } from "node:stream";

export interface PutOptions {
  contentType?: string;
  cacheControl?: string;
}

/**
 * Object storage abstraction. Keys are forward-slash paths like
 * `songs/<id>/hls/<ver>/96k/seg_001.m4s`.
 */
export interface Storage {
  readonly driver: "local" | "s3";
  putFile(key: string, filePath: string, opts?: PutOptions): Promise<void>;
  putBuffer(key: string, body: Buffer, opts?: PutOptions): Promise<void>;
  getBuffer(key: string): Promise<Buffer>;
  /** Download an object to a local file path. */
  download(key: string, destPath: string): Promise<void>;
  /** Readable stream (used for local serving). */
  getStream(key: string, range?: { start: number; end?: number }): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  /** All objects under a prefix (used when moving songs between storages). */
  list(prefix: string): Promise<{ key: string; size: number }[]>;
  deletePrefix(prefix: string): Promise<void>;
  /**
   * URL a client can fetch directly. For private S3 buckets this is a signed
   * URL valid for `ttlSeconds`.
   */
  url(key: string, ttlSeconds?: number): Promise<string>;
}
