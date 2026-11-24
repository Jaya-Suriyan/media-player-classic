import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatBytes, type AdminSong } from "../../lib/api";
import { UploadIcon } from "../../components/Icons";
import { Cover } from "../../components/Media";
import { StatusBadge } from "./SongManager";

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus|wma|aiff?|alac|webm)$/i;
const PARALLEL = 2;

type ItemState = "queued" | "uploading" | "done" | "error";
interface Item {
  key: string;
  file: File;
  state: ItemState;
  progress: number;
  error?: string;
  song?: AdminSong;
}

/** Read files from a drop, including whole folders. */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return [...dt.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

export default function UploadPanel({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [fields, setFields] = useState({ albumTitle: "", albumArtist: "", artistName: "", genre: "", year: "" });
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const active = useRef(0);
  /** Keys already handed to the uploader (guards against double-starts). */
  const started = useRef(new Set<string>());
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const update = (key: string, patch: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const addFiles = (files: File[]) => {
    const audio = files.filter((f) => AUDIO_EXT.test(f.name));
    const skipped = files.length - audio.length;
    const now = Date.now();
    setItems((list) => [
      ...list,
      ...audio.map((file, i) => ({ key: `${now}-${i}-${file.name}`, file, state: "queued" as const, progress: 0 })),
    ]);
    if (skipped) alert(`${skipped} file(s) skipped: not audio.`);
  };

  // Upload queue: a couple of files at a time.
  useEffect(() => {
    const queued = items.filter((i) => i.state === "queued" && !started.current.has(i.key));
    while (active.current < PARALLEL && queued.length) {
      const it = queued.shift()!;
      started.current.add(it.key);
      active.current++;
      update(it.key, { state: "uploading", progress: 0 });
      api.admin
        .upload(it.file, fieldsRef.current, (p) => update(it.key, { progress: p }))
        .then((r) => {
          if (r.songs[0]) update(it.key, { state: "done", progress: 1, song: r.songs[0] });
          else update(it.key, { state: "error", error: r.errors[0]?.error ?? "Upload failed" });
          onChange();
        })
        .catch((err: Error) => update(it.key, { state: "error", error: err.message }))
        .finally(() => {
          active.current--;
          setItems((l) => [...l]); // kick the queue
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Poll transcoding status of uploaded songs until ready / failed.
  useEffect(() => {
    const pending = items.filter((i) => i.song && (i.song.status === "pending" || i.song.status === "processing"));
    if (!pending.length) return;
    const t = setTimeout(async () => {
      const fresh = await api.admin.songsByIds(pending.map((i) => i.song!.id));
      const byId = new Map(fresh.map((s) => [s.id, s]));
      setItems((list) => list.map((it) => (it.song && byId.has(it.song.id) ? { ...it, song: byId.get(it.song.id) } : it)));
      if (fresh.some((s) => s.status === "ready" || s.status === "failed")) onChange();
    }, 2500);
    return () => clearTimeout(t);
  }, [items, onChange]);

  const counts = {
    total: items.length,
    ready: items.filter((i) => i.song?.status === "ready").length,
    failed: items.filter((i) => i.state === "error" || i.song?.status === "failed").length,
  };
  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="upload-panel">
      <div
        className={`dropzone ${dragOver ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(await filesFromDrop(e.dataTransfer));
        }}
      >
        <UploadIcon size={36} />
        <p>
          <b>Drop audio files or folders here</b>
        </p>
        <p className="muted small">MP3, M4A, FLAC, WAV, OGG, OPUS… Tags and cover art are read automatically.</p>
        <div className="row-gap">
          <button className="btn-primary" onClick={() => fileInput.current?.click()}>
            Choose files
          </button>
          <button className="btn" onClick={() => folderInput.current?.click()}>
            Choose folder
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="audio/*,.flac,.opus,.m4a"
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <input
          ref={folderInput}
          type="file"
          hidden
          // @ts-expect-error non-standard but widely supported
          webkitdirectory=""
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      <details className="card batch-fields">
        <summary>Apply to every file in this batch (optional)</summary>
        <p className="muted small">Leave blank to use each file's own tags. Values apply to files added after you fill them in.</p>
        <div className="form-grid cols">
          <label>
            Album
            <input value={fields.albumTitle} onChange={set("albumTitle")} placeholder="From tags" />
          </label>
          <label>
            Album artist / composer
            <input value={fields.albumArtist} onChange={set("albumArtist")} placeholder="From tags" />
          </label>
          <label>
            Artist(s)
            <input value={fields.artistName} onChange={set("artistName")} placeholder="From tags, e.g. A, B" />
          </label>
          <label>
            Genre
            <input value={fields.genre} onChange={set("genre")} placeholder="From tags" />
          </label>
          <label>
            Year
            <input value={fields.year} onChange={set("year")} inputMode="numeric" pattern="\d{4}" placeholder="From tags" />
          </label>
        </div>
      </details>

      {items.length > 0 && (
        <div className="card">
          <div className="upload-summary">
            <span>
              {counts.ready}/{counts.total} ready{counts.failed ? ` · ${counts.failed} failed` : ""}
            </span>
            <div className="row-gap">
              <Link to="/admin/songs" className="btn">
                Edit details
              </Link>
              <button
                className="btn"
                onClick={() => setItems((l) => l.filter((i) => i.state === "uploading" || i.state === "queued"))}
              >
                Clear finished
              </button>
            </div>
          </div>
          <ul className="upload-list">
            {items.map((it) => (
              <li key={it.key}>
                <Cover cover={it.song?.cover} size={40} />
                <div className="ul-main">
                  <div className="ul-name">
                    {it.song ? (
                      <>
                        <b>{it.song.title}</b> <span className="muted">· {it.song.artists.map((a) => a.name).join(", ")}</span>
                        {it.song.album && <span className="muted"> · {it.song.album.title}</span>}
                      </>
                    ) : (
                      it.file.name
                    )}
                  </div>
                  {it.state === "uploading" && (
                    <div className="bar">
                      <i style={{ width: `${it.progress * 100}%` }} />
                    </div>
                  )}
                  {it.error && <div className="form-error small">{it.error}</div>}
                  {it.song?.error && <div className="form-error small">{it.song.error}</div>}
                </div>
                <div className="ul-state">
                  {it.state === "queued" && <span className="badge">Waiting</span>}
                  {it.state === "uploading" && <span className="badge">{Math.round(it.progress * 100)}%</span>}
                  {it.state === "error" && (
                    <button
                      className="btn small"
                      onClick={() => {
                        started.current.delete(it.key);
                        update(it.key, { state: "queued", error: undefined });
                      }}
                    >
                      Retry
                    </button>
                  )}
                  {it.song && <StatusBadge status={it.song.status} />}
                  <span className="muted small hide-sm">{formatBytes(it.file.size)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
