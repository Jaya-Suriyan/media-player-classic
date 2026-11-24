import React, { useEffect, useRef, useState } from "react";
import { api, formatBytes, formatTime, type AdminSong, type SongPatch, type SongStatus } from "../../lib/api";
import { useAsync, useDebounced } from "../../lib/hooks";
import { Cover, ErrorBox, Loading } from "../../components/Media";
import { CloseIcon, SearchIcon } from "../../components/Icons";
import FindReplace from "./FindReplace";

const PAGE = 50;

export function StatusBadge({ status }: { status: SongStatus }) {
  const label = { pending: "Queued", processing: "Processing", ready: "Ready", failed: "Failed" }[status];
  return <span className={`badge ${status}`}>{label}</span>;
}

const toNum = (v: string) => (v.trim() === "" ? null : Number(v));

/* ------------------------------------------------------------------ */
/* Single song editor                                                   */
/* ------------------------------------------------------------------ */

function EditDrawer({ song, onClose, onSaved }: { song: AdminSong; onClose: () => void; onSaved: (s: AdminSong | null) => void }) {
  const [f, setF] = useState({
    title: song.title,
    artistName: song.artists.map((a) => a.name).join(", "),
    albumTitle: song.album?.title ?? "",
    genre: song.genre ?? "",
    year: song.year?.toString() ?? "",
    trackNo: song.trackNo?.toString() ?? "",
    discNo: song.discNo?.toString() ?? "",
    lyrics: song.lyrics ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cur, setCur] = useState(song);
  const [applyToAlbum, setApplyToAlbum] = useState(true);
  const coverInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const patch: SongPatch = {
        title: f.title,
        artistName: f.artistName,
        albumTitle: f.albumTitle || null,
        genre: f.genre || null,
        year: toNum(f.year),
        trackNo: toNum(f.trackNo),
        discNo: toNum(f.discNo),
        lyrics: f.lyrics || null,
      };
      const { song: saved } = await api.admin.update(song.id, patch);
      onSaved(saved);
      onClose();
    });

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Edit ${song.title}`}>
        <header className="drawer-head">
          <h2>Edit song</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        <div className="drawer-cover">
          <Cover cover={cur.cover} size={120} large />
          <div>
            <button className="btn" disabled={busy} onClick={() => coverInput.current?.click()}>
              Change cover
            </button>
            {cur.album && (
              <label className="check">
                <input type="checkbox" checked={applyToAlbum} onChange={(e) => setApplyToAlbum(e.target.checked)} />
                Use for the whole album
              </label>
            )}
            <input
              ref={coverInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  run(async () => {
                    const { song: s } = await api.admin.setCover(song.id, file, applyToAlbum);
                    setCur(s);
                    onSaved(s);
                  });
              }}
            />
            <div className="muted small">
              {cur.originalName} · {formatBytes(cur.originalSize)} · {formatTime(cur.duration)}
            </div>
            <div className="row-gap">
              <StatusBadge status={cur.status} />
              {cur.status === "failed" && <span className="form-error small">{cur.error}</span>}
            </div>
          </div>
        </div>

        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label>
            Title
            <input value={f.title} onChange={set("title")} required />
          </label>
          <label>
            Artist(s) <span className="muted small">separate with commas</span>
            <input value={f.artistName} onChange={set("artistName")} required />
          </label>
          <label>
            Album
            <input value={f.albumTitle} onChange={set("albumTitle")} />
          </label>
          <div className="form-grid cols">
            <label>
              Genre
              <input value={f.genre} onChange={set("genre")} />
            </label>
            <label>
              Year
              <input value={f.year} onChange={set("year")} inputMode="numeric" pattern="\d{4}" />
            </label>
            <label>
              Track #
              <input value={f.trackNo} onChange={set("trackNo")} inputMode="numeric" pattern="\d*" />
            </label>
            <label>
              Disc #
              <input value={f.discNo} onChange={set("discNo")} inputMode="numeric" pattern="\d*" />
            </label>
          </div>
          <label>
            Lyrics
            <textarea rows={8} value={f.lyrics} onChange={set("lyrics")} />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="drawer-actions">
            <button className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const { song: s } = await api.admin.retranscode(song.id);
                  setCur(s);
                  onSaved(s);
                })
              }
            >
              Re-process audio
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => {
                if (!confirm(`Delete “${song.title}”? This removes the audio files too.`)) return;
                run(async () => {
                  await api.admin.bulkDelete([song.id]);
                  onSaved(null);
                  onClose();
                });
              }}
            >
              Delete
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bulk editor                                                          */
/* ------------------------------------------------------------------ */

function BulkEdit({ ids, onDone, onCancel }: { ids: string[]; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ artistName: "", albumTitle: "", albumArtist: "", genre: "", year: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="card bulk-edit"
      onSubmit={async (e) => {
        e.preventDefault();
        const patch: SongPatch = {};
        if (f.artistName.trim()) patch.artistName = f.artistName;
        if (f.albumTitle.trim()) patch.albumTitle = f.albumTitle;
        if (f.albumArtist.trim()) patch.albumArtist = f.albumArtist;
        if (f.genre.trim()) patch.genre = f.genre;
        if (f.year.trim()) patch.year = Number(f.year);
        if (!Object.keys(patch).length) return setError("Fill at least one field.");
        setBusy(true);
        try {
          await api.admin.bulkUpdate(ids, patch);
          onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Edit {ids.length} songs</h3>
      <p className="muted small">Only filled-in fields are changed.</p>
      <div className="form-grid cols">
        <label>
          Artist(s)
          <input value={f.artistName} onChange={set("artistName")} />
        </label>
        <label>
          Album
          <input value={f.albumTitle} onChange={set("albumTitle")} />
        </label>
        <label>
          Album artist
          <input value={f.albumArtist} onChange={set("albumArtist")} />
        </label>
        <label>
          Genre
          <input value={f.genre} onChange={set("genre")} />
        </label>
        <label>
          Year
          <input value={f.year} onChange={set("year")} inputMode="numeric" pattern="\d{4}" />
        </label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="row-gap">
        <button className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Apply"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Fix titles (preview + apply)                                         */
/* ------------------------------------------------------------------ */

type FixPlan = Awaited<ReturnType<typeof api.admin.fixTitles<false>>>;

function FixTitles({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<FixPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.admin.fixTitles(ids, false).then(setPlan, (e: Error) => setError(e.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = plan ? plan.changes.length + plan.albums.length : 0;
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Fix titles">
        <header className="drawer-head">
          <h2>Fix titles</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <p className="muted small">
          Removes track numbers, movie names, bitrate tags and site names from {ids.length ? `${ids.length} selected` : "all"} songs,
          and download-site spam from artist names. Titles that are only a number are rebuilt from the file name. Review the
          changes before applying them.
        </p>
        {error && <div className="form-error">{error}</div>}
        {!plan && !error && <Loading />}
        {plan && total === 0 && <div className="empty">All titles already look clean.</div>}
        {plan && total > 0 && (
          <>
            <div className="drawer-actions sticky-actions">
              <button
                className="btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.admin.fixTitles(ids, true);
                    onDone();
                    onClose();
                  } catch (e) {
                    setError((e as Error).message);
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Applying…" : `Apply ${total} change${total === 1 ? "" : "s"}`}
              </button>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
            </div>
            {plan.albums.length > 0 && (
              <>
                <h3 className="fix-head">Albums</h3>
                <ul className="fix-list">
                  {plan.albums.map((a) => (
                    <li key={a.id}>
                      <span className="from">{a.from}</span>
                      <span className="to">{a.to}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {plan.changes.length > 0 && (
              <>
                <h3 className="fix-head">Songs ({plan.changes.length}): title, then artist when it changes</h3>
                <ul className="fix-list">
                  {plan.changes.map((c) => (
                    <li key={c.id}>
                      <span className="from">{c.from}</span>
                      <span className="to">
                        {c.to}
                        {c.track != null && <span className="muted small"> · track {c.track}</span>}
                      </span>
                      {c.artistTo && (
                        <>
                          <span className="from">{c.artistFrom}</span>
                          <span className="to small">{c.artistTo}</span>
                        </>
                      )}
                      {c.file && <span className="file">{c.file}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table                                                                */
/* ------------------------------------------------------------------ */

export default function SongManager({ onChange }: { onChange: () => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("new");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminSong | null>(null);
  const [bulk, setBulk] = useState(false);
  const [fixing, setFixing] = useState<string[] | null>(null);
  const [replacing, setReplacing] = useState<string[] | null>(null);
  const dq = useDebounced(q, 250);

  const { data, error, loading, reload } = useAsync(
    () => api.admin.songs({ q: dq, status, sort, limit: PAGE, offset: page * PAGE }),
    [dq, status, sort, page],
  );

  useEffect(() => setPage(0), [dq, status, sort]);
  useEffect(() => setSelected(new Set()), [dq, status, sort, page]);

  // Auto-refresh while anything on screen is still processing.
  const processing = data?.items.some((s) => s.status === "pending" || s.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const t = setTimeout(reload, 3000);
    return () => clearTimeout(t);
  }, [processing, data, reload]);

  const refresh = () => {
    reload();
    onChange();
  };

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((s) => selected.has(s.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="song-manager">
      <div className="toolbar">
        <div className="field-icon">
          <SearchIcon size={16} />
          <input
            type="search"
            placeholder="Filter by title, artist, album, genre, file name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Filter songs"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="pending">Queued</option>
          <option value="failed">Failed</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="new">Newest</option>
          <option value="title">Title</option>
          <option value="artist">Artist / album</option>
          <option value="plays">Most played</option>
        </select>
        <button className="btn" onClick={() => setReplacing([])} title="Replace an artist, album, title or genre across songs">
          Find &amp; replace
        </button>
        <button className="btn" onClick={() => setFixing([])} title="Clean up messy titles of all songs">
          Fix titles
        </button>
      </div>

      {selected.size > 0 && !bulk && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <button className="btn" onClick={() => setBulk(true)}>
            Edit details
          </button>
          <button className="btn" onClick={() => setReplacing([...selected])}>
            Find &amp; replace
          </button>
          <button className="btn" onClick={() => setFixing([...selected])}>
            Fix titles
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm(`Delete ${selected.size} songs and their audio files?`)) return;
              await api.admin.bulkDelete([...selected]);
              setSelected(new Set());
              refresh();
            }}
          >
            Delete
          </button>
          <button className="link-btn" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}
      {bulk && (
        <BulkEdit
          ids={[...selected]}
          onCancel={() => setBulk(false)}
          onDone={() => {
            setBulk(false);
            setSelected(new Set());
            refresh();
          }}
        />
      )}

      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <div className="table-wrap">
            <table className="songs-table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((s) => s.id)))}
                    />
                  </th>
                  <th>Title</th>
                  <th className="hide-sm">Album</th>
                  <th className="hide-md">Genre</th>
                  <th className="hide-md">Year</th>
                  <th className="hide-sm">Plays</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className={selected.has(s.id) ? "selected" : ""} onClick={() => setEditing(s)}>
                    <td className="col-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${s.title}`} checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                    </td>
                    <td>
                      <div className="cell-song">
                        <Cover cover={s.cover} size={36} />
                        <div>
                          <div className="cell-title">{s.title}</div>
                          <div className="muted small">{s.artists.map((a) => a.name).join(", ")}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hide-sm">{s.album?.title ?? <span className="muted">—</span>}</td>
                    <td className="hide-md">{s.genre ?? <span className="muted">—</span>}</td>
                    <td className="hide-md">{s.year ?? <span className="muted">—</span>}</td>
                    <td className="hide-sm">{s.playCount}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <div className="empty">No songs match.</div>}
          </div>
          <div className="pager">
            <span className="muted small">
              {data.total ? `${page * PAGE + 1}–${Math.min(data.total, (page + 1) * PAGE)} of ${data.total}` : ""}
              {loading ? " · refreshing…" : ""}
            </span>
            <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button className="btn" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </>
      )}

      {replacing && <FindReplace ids={replacing} onClose={() => setReplacing(null)} onDone={refresh} />}

      {fixing && (
        <FixTitles
          ids={fixing}
          onClose={() => setFixing(null)}
          onDone={() => {
            setSelected(new Set());
            refresh();
          }}
        />
      )}

      {editing && (
        <EditDrawer
          song={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            refresh();
          }}
        />
      )}
    </div>
  );
}
