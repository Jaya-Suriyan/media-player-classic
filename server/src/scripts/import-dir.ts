/**
 * Bulk import a folder of audio files that already lives on the server
 * (faster than uploading through the browser for big libraries).
 *
 *   npm run import -- /path/to/music [--album "Album"] [--artist "Artist"] [--genre "Genre"]
 *
 * Folders are scanned recursively. Files are copied (originals are left untouched)
 * and transcoded one after another.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { config } from "../config.js";
import { client, connectDb, newId, songs } from "../db.js";
import { loadStorageSettings, uploadTarget } from "../storage-settings.js";
import { AUDIO_EXTENSIONS, ingestAudioFile, queueState } from "../media/pipeline.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { album: { type: "string" }, artist: { type: "string" }, genre: { type: "string" } },
});

async function main() {
  const dir = positionals[0];
  if (!dir) {
    console.error("Usage: npm run import -- <folder> [--album A] [--artist B] [--genre C]");
    process.exit(1);
  }
  await connectDb();
  await loadStorageSettings();
  console.log(`Saving to: ${uploadTarget()}`);
  const entries = await fsp.readdir(path.resolve(dir), { recursive: true, withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && AUDIO_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
  console.log(`Found ${files.length} audio file(s)`);

  const ids: string[] = [];
  for (const [i, file] of files.entries()) {
    const tmp = path.join(config.tmpDir, `import-${newId()}${path.extname(file)}`);
    try {
      await fsp.copyFile(file, tmp);
      ids.push(
        await ingestAudioFile(tmp, path.basename(file), {
          albumTitle: values.album,
          artistName: values.artist,
          genre: values.genre,
        }),
      );
      console.log(`[${i + 1}/${files.length}] queued ${path.basename(file)}`);
    } catch (err) {
      console.error(`[${i + 1}/${files.length}] FAILED ${file}: ${(err as Error).message}`);
      await fsp.rm(tmp, { force: true });
    }
  }

  // Wait for transcoding to finish.
  for (;;) {
    const { queued, active } = queueState();
    if (!queued && !active) break;
    process.stdout.write(`\rTranscoding... ${queued + active} left   `);
    await new Promise((r) => setTimeout(r, 1000));
  }
  const failed = await songs.countDocuments({ _id: { $in: ids }, status: "failed" });
  console.log(`\nDone: ${ids.length - failed} ready, ${failed} failed.`);
  await client.close();
}

main().catch(async (err) => {
  console.error(err);
  await client.close();
  process.exit(1);
});
