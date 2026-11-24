import React, { useEffect, useMemo, useState } from "react";
import { api, type ReplaceField } from "../../lib/api";
import { useDebounced } from "../../lib/hooks";
import { CloseIcon } from "../../components/Icons";

const FIELDS: { value: ReplaceField; label: string; hint: string }[] = [
  { value: "artist", label: "Artist", hint: "Each artist in a song is matched on its own, so you can change one name in “A, B, C”." },
  { value: "title", label: "Title", hint: "" },
  { value: "album", label: "Album", hint: "Album changes apply to every song on the album." },
  { value: "albumArtist", label: "Album artist / composer", hint: "Applies to every song on the album." },
  { value: "genre", label: "Genre", hint: "" },
];

type Preview = { changes: { id: string; title: string; from: string; to: string }[]; total: number; albumWide: boolean };

/** Find & replace in song details: case-insensitive, preview before applying. */
export default function FindReplace({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const [field, setField] = useState<ReplaceField>("artist");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [partial, setPartial] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);

  const mode = partial ? "contains" : "exact";
  // Debounce a stable string (a fresh object each render would re-trigger forever).
  const reqKey = useDebounced(JSON.stringify({ field, find: find.trim(), replace, mode }), 300);
  const req = useMemo(() => ({ ...(JSON.parse(reqKey) as { field: ReplaceField; find: string; replace: string; mode: "exact" | "contains" }), ids }), [reqKey, ids]);

  // Suggestions for the Find box.
  useEffect(() => {
    const load =
      field === "artist" || field === "albumArtist"
        ? api.artists({ sort: "name", limit: 200 }).then((r) => r.items.map((a) => a.name))
        : field === "album"
          ? api.albums({ limit: 200 }).then((r) => r.items.map((a) => a.title))
          : Promise.resolve([] as string[]);
    load.then(setNames).catch(() => setNames([]));
  }, [field]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Live preview.
  useEffect(() => {
    setDone(null);
    if (!req.find) {
      setPreview(null);
      return;
    }
    let stale = false;
    setLoading(true);
    setError(null);
    api.admin
      .replace({ ...req, apply: false })
      .then((r) => !stale && setPreview({ changes: r.changes ?? [], total: r.total ?? 0, albumWide: !!r.albumWide }))
      .catch((e: Error) => !stale && setError(e.message))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [req]);

  const fieldInfo = FIELDS.find((f) => f.value === field)!;
  const emptyMeans = field === "artist" ? "removes that artist from the songs" : field === "title" ? "" : "clears the value";

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Find and replace">
        <header className="drawer-head">
          <h2>Find &amp; replace</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <p className="muted small">
          In {ids.length ? `${ids.length} selected songs` : "all songs"}. Upper and lower case are treated the same.
        </p>

        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <label>
            Field
            <select value={field} onChange={(e) => setField(e.target.value as ReplaceField)}>
              {FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {fieldInfo.hint && <div className="muted small">{fieldInfo.hint}</div>}
          <label>
            Find
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              list="replace-names"
              placeholder={field === "artist" ? "e.g. S.P.Bala" : ""}
              autoFocus
            />
            <datalist id="replace-names">
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <label>
            Replace with
            <input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder={field === "artist" ? "e.g. S.P. Balasubrahmanyam" : ""} />
            {emptyMeans && <span className="muted small">Leave empty: {emptyMeans}.{field === "artist" && " Use commas to replace one artist with several."}</span>}
          </label>
          <label className="check">
            <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />
            Match part of the text (otherwise the whole {field === "artist" ? "artist name" : "value"} must match)
          </label>
        </form>

        {error && <div className="form-error">{error}</div>}
        {done && <div className="form-ok">{done}</div>}

        {preview && (
          <>
            <div className="drawer-actions sticky-actions">
              <button
                className="btn-primary"
                disabled={busy || loading || preview.total === 0}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const r = await api.admin.replace({ ...req, apply: true });
                    setDone(`Updated ${r.updated} song${r.updated === 1 ? "" : "s"}.`);
                    setPreview(null);
                    setFind("");
                    setReplace("");
                    onDone();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Replacing…" : preview.total ? `Replace in ${preview.total} song${preview.total === 1 ? "" : "s"}` : "No matches"}
              </button>
              {loading && <span className="muted small">Checking…</span>}
            </div>
            {preview.albumWide && preview.total > 0 && (
              <p className="muted small">Includes every song on the matching albums.</p>
            )}
            <ul className="fix-list">
              {preview.changes.map((c) => (
                <li key={c.id}>
                  <span className="file" style={{ opacity: 1 }}>
                    {c.title}
                  </span>
                  <span className="from">{c.from || "—"}</span>
                  <span className="to">{c.to}</span>
                </li>
              ))}
            </ul>
            {preview.total > preview.changes.length && (
              <p className="muted small">…and {preview.total - preview.changes.length} more.</p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
