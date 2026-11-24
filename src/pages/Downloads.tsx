import React, { useEffect, useState } from "react";
import { formatBytes } from "../lib/api";
import {
  downloadQualityStore,
  downloadsStore,
  removeAllDownloads,
  supportsDownloads,
  type DownloadQuality,
} from "../lib/downloads";
import { PlayButton, SongList } from "../components/Media";

const QUALITY: Record<DownloadQuality, string> = {
  "48k": "Data saver: 48 kbps (~1.5 MB per song)",
  "96k": "Normal: 96 kbps (~3 MB per song)",
  "160k": "High: 160 kbps (~5 MB per song)",
};

/** Songs saved on this device. Works with no internet (reads only local data). */
export default function Downloads() {
  const downloads = downloadsStore.use();
  const quality = downloadQualityStore.use();
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const list = Object.values(downloads).sort((a, b) => b.at - a.at);
  const songs = list.map((d) => d.song);
  const total = list.reduce((t, d) => t + d.size, 0);

  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }))
      .catch(() => {});
  }, [list.length]);

  if (!supportsDownloads()) {
    return <div className="empty">This browser can't store songs for offline use.</div>;
  }

  return (
    <div>
      <div className="hero-actions">
        {songs.length > 0 && <PlayButton songs={songs} />}
        <span className="muted small">
          {songs.length} songs · {formatBytes(total)}
          {usage && usage.quota > 0 && ` · ${formatBytes(usage.quota - usage.used)} free on device`}
        </span>
      </div>
      <SongList songs={songs} emptyText="Tap the download button on any song, album or artist to play it without internet." />

      <div className="card dl-settings">
        <label>
          Download quality
          <select value={quality} onChange={(e) => downloadQualityStore.set(e.target.value as DownloadQuality)}>
            {(Object.keys(QUALITY) as DownloadQuality[]).map((q) => (
              <option key={q} value={q}>
                {QUALITY[q]}
              </option>
            ))}
          </select>
        </label>
        <span className="muted small">Applies to new downloads.</span>
        {songs.length > 0 && (
          <button
            className="btn danger"
            onClick={() => {
              if (confirm(`Remove all ${songs.length} downloaded songs from this device?`)) removeAllDownloads();
            }}
          >
            Remove all downloads
          </button>
        )}
      </div>
    </div>
  );
}
