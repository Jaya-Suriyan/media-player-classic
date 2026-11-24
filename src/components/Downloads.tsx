import React from "react";
import type { Song } from "../lib/api";
import {
  cancelDownload,
  downloadsStore,
  downloadProgressStore,
  downloadSong,
  downloadSongs,
  removeDownload,
  supportsDownloads,
  useDownloadState,
} from "../lib/downloads";
import { DownloadedIcon, DownloadIcon } from "./Icons";

/** Small ring showing download progress. */
function Ring({ progress, size }: { progress: number; size: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="ring">
      <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.04, progress))}
        strokeLinecap="round"
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

/** Download / downloading / downloaded toggle for one song. */
export function DownloadButton({ song, size = 20 }: { song: Song; size?: number }) {
  const { downloaded, progress } = useDownloadState(song.id);
  if (!supportsDownloads()) return null;
  if (downloaded) {
    return (
      <button
        className="icon-btn on"
        aria-label={`Remove download of ${song.title}`}
        title="Downloaded: tap to remove"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Remove “${song.title}” from this device?`)) removeDownload(song.id);
        }}
      >
        <DownloadedIcon size={size} />
      </button>
    );
  }
  if (progress && progress.state !== "error") {
    return (
      <button
        className="icon-btn"
        aria-label={`Cancel download of ${song.title}`}
        title={progress.state === "queued" ? "Waiting to download" : `Downloading ${Math.round(progress.progress * 100)}%`}
        onClick={(e) => {
          e.stopPropagation();
          cancelDownload(song.id);
        }}
      >
        <Ring progress={progress.state === "queued" ? 0 : progress.progress} size={size} />
      </button>
    );
  }
  return (
    <button
      className={`icon-btn ${progress?.state === "error" ? "err" : ""}`}
      aria-label={`Download ${song.title} for offline`}
      title={progress?.state === "error" ? `Download failed: ${progress.error}. Tap to retry.` : "Download for offline"}
      onClick={(e) => {
        e.stopPropagation();
        downloadSong(song);
      }}
    >
      <DownloadIcon size={size} />
    </button>
  );
}

/** "Download all" for an album / list, with overall progress. */
export function DownloadAllButton({ songs, label = "Download" }: { songs: Song[]; label?: string }) {
  const downloads = downloadsStore.use();
  const progress = downloadProgressStore.use();
  if (!supportsDownloads() || !songs.length) return null;
  const done = songs.filter((s) => downloads[s.id]).length;
  const active = songs.filter((s) => progress[s.id] && progress[s.id].state !== "error").length;
  if (done === songs.length) {
    return (
      <button
        className="btn"
        onClick={() => {
          if (confirm(`Remove ${songs.length} downloaded songs from this device?`)) songs.forEach((s) => removeDownload(s.id));
        }}
      >
        <DownloadedIcon size={16} /> Downloaded
      </button>
    );
  }
  return (
    <button className="btn" disabled={active > 0} onClick={() => downloadSongs(songs)}>
      <DownloadIcon size={16} />
      {active > 0 ? `Downloading ${done}/${songs.length}` : done ? `${label} remaining ${songs.length - done}` : label}
    </button>
  );
}

/** Tiny marker shown next to downloaded songs in lists. */
export function DownloadedMark({ id }: { id: string }) {
  const { downloaded } = useDownloadState(id);
  if (!downloaded) return null;
  return (
    <span className="dl-mark" title="Downloaded" aria-label="Downloaded">
      <DownloadedIcon size={13} />
    </span>
  );
}
