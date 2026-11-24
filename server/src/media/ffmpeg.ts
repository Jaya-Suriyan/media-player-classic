import { spawn } from "node:child_process";
import { config } from "../config.js";

export function runFfmpeg(args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], {
      cwd: opts.cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    const timer = setTimeout(() => proc.kill("SIGKILL"), opts.timeoutMs ?? 30 * 60 * 1000);
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not start ffmpeg (${config.ffmpegPath}): ${err.message}`));
    });
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${signal ?? code}): ${stderr.trim() || "no output"}`));
    });
  });
}

/**
 * Adaptive bitrate ladder. All variants share sample rate / channels so
 * players can switch seamlessly mid-song.
 *  - 48k:  ~6 KB/s  → plays on 2G/EDGE and congested networks
 *  - 96k:  ~12 KB/s → normal mobile data
 *  - 160k: ~20 KB/s → Wi-Fi / good 4G
 */
export const LADDER = [
  { name: "48k", bitrate: 48_000 },
  { name: "96k", bitrate: 96_000 },
  { name: "160k", bitrate: 160_000 },
] as const;

/** Segment length in seconds — short enough that playback starts fast on slow links. */
export const SEGMENT_SECONDS = 6;

/** Transcode `input` into fMP4 HLS variants under `outDir/<variant>/`. */
export async function transcodeToHls(input: string, outDir: string) {
  const args = ["-i", input];
  for (let i = 0; i < LADDER.length; i++) args.push("-map", "0:a:0");
  args.push("-vn", "-sn", "-dn", "-map_metadata", "-1", "-c:a", "aac", "-ar", "44100", "-ac", "2");
  LADDER.forEach((v, i) => args.push(`-b:a:${i}`, String(v.bitrate)));
  args.push(
    "-f", "hls",
    "-hls_time", String(SEGMENT_SECONDS),
    "-hls_playlist_type", "vod",
    // fMP4 has far less container overhead than MPEG-TS at low bitrates.
    "-hls_segment_type", "fmp4",
    "-hls_fmp4_init_filename", "init.mp4",
    "-hls_flags", "independent_segments",
    "-var_stream_map", LADDER.map((v, i) => `a:${i},name:${v.name}`).join(" "),
    "-hls_segment_filename", "%v/seg_%04d.m4s",
    "%v/index.m3u8",
  );
  await runFfmpeg(args, { cwd: outDir });
}

/** Master playlist listing each variant (lowest first). */
export function masterPlaylist() {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (const v of LADDER) {
    // ~8% container overhead on top of the audio bitrate.
    const bw = Math.round(v.bitrate * 1.08);
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bw},AVERAGE-BANDWIDTH=${bw},CODECS="mp4a.40.2"`, `${v.name}/index.m3u8`);
  }
  return lines.join("\n") + "\n";
}

/** Square-crop + resize an image to `size` px JPEG. */
export async function resizeCover(input: string, output: string, size: number, quality = 4) {
  await runFfmpeg([
    "-i", input,
    "-frames:v", "1",
    "-vf", `scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size}`,
    "-q:v", String(quality),
    output,
  ]);
}
