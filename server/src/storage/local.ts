import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { Storage, PutOptions } from "./types.js";
import { config } from "../config.js";

/** Stores objects on the server's disk. Served by the `/media/*` route. */
export class LocalStorage implements Storage {
  readonly driver = "local" as const;

  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  /** Resolve a key to an absolute path, refusing anything outside root. */
  resolve(key: string): string {
    const p = path.resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return p;
  }

  async putFile(key: string, filePath: string, _opts?: PutOptions) {
    const dest = this.resolve(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(filePath, dest);
  }

  async putBuffer(key: string, body: Buffer, _opts?: PutOptions) {
    const dest = this.resolve(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, body);
  }

  async getBuffer(key: string) {
    return fsp.readFile(this.resolve(key));
  }

  async download(key: string, destPath: string) {
    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    await pipeline(fs.createReadStream(this.resolve(key)), fs.createWriteStream(destPath));
  }

  async getStream(key: string, range?: { start: number; end?: number }): Promise<Readable> {
    return fs.createReadStream(this.resolve(key), range);
  }

  async exists(key: string) {
    try {
      await fsp.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string) {
    const base = this.resolve(prefix);
    const out: { key: string; size: number }[] = [];
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(base, { recursive: true, withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const abs = path.join(e.parentPath, e.name);
      out.push({ key: path.relative(this.root, abs).split(path.sep).join("/"), size: (await fsp.stat(abs)).size });
    }
    return out;
  }

  async deletePrefix(prefix: string) {
    if (!prefix || prefix === "/") throw new Error("Refusing to delete storage root");
    const target = this.resolve(prefix);
    await fsp.rm(target, { recursive: true, force: true });
    // Tidy up now-empty parent folders (e.g. covers/<songId>/), never the root.
    let dir = path.dirname(target);
    while (dir !== this.root && dir.startsWith(this.root + path.sep)) {
      try {
        await fsp.rmdir(dir);
      } catch {
        break; // not empty
      }
      dir = path.dirname(dir);
    }
  }

  async url(key: string) {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return `${config.publicBaseUrl}/media/${encoded}`;
  }
}
