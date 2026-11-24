import { config } from "../config.js";
import { LocalStorage } from "./local.js";
import { S3Storage } from "./s3.js";
import type { Storage } from "./types.js";

export type { Storage } from "./types.js";

export const storage: Storage =
  config.storage.driver === "s3"
    ? new S3Storage(config.storage.s3)
    : new LocalStorage(config.storage.localDir);

export const IMMUTABLE = "public, max-age=31536000, immutable";
