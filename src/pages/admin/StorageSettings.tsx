import React, { useEffect, useState } from "react";
import { api, formatBytes, type R2Form, type S3Form, type StorageBackend, type StorageState, type StorageTest } from "../../lib/api";
import { ErrorBox, Loading } from "../../components/Media";

const NAMES: Record<StorageBackend, string> = { local: "Local (this server)", r2: "Cloudflare R2", s3: "Amazon S3" };
const SHORT: Record<StorageBackend, string> = { local: "Local", r2: "Cloudflare R2", s3: "Amazon S3" };

const emptyR2: R2Form = { accountId: "", bucket: "", accessKeyId: "", secretAccessKey: "", publicUrl: "", jurisdiction: "" };
const emptyS3: S3Form = {
  region: "us-east-1",
  bucket: "",
  accessKeyId: "",
  secretAccessKey: "",
  publicUrl: "",
  endpoint: "",
  forcePathStyle: false,
};

function TestResult({ result, backend, onAllowed }: { result: StorageTest; backend: "r2" | "s3"; onAllowed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className={`test-result ${result.ok ? "ok" : "bad"}`}>
      <ul>
        {result.steps.map((s) => (
          <li key={s.name}>
            <span className={s.ok ? "tick" : "cross"}>{s.ok ? "✓" : "✗"}</span>
            <div>
              <b>{s.name}</b>
              {s.detail && <div className="small muted">{s.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
      {result.ok && result.cors !== "ok" && (
        <div className="row-gap">
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.admin.storage.allowSite(backend);
                setMsg({ ok: true, text: `Allowed: ${r.origins.join(", ")}` });
                onAllowed();
              } catch (e) {
                setMsg({ ok: false, text: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            Allow this site to play files
          </button>
          <span className="muted small">Browsers need this (CORS) to stream from the bucket. Save settings first.</span>
        </div>
      )}
      {msg && <div className={msg.ok ? "form-ok" : "form-error"}>{msg.text}</div>}
    </div>
  );
}

function R2Fields({ form, set, hasSecret }: { form: R2Form; set: (f: R2Form) => void; hasSecret: boolean }) {
  const f = (k: keyof R2Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set({ ...form, [k]: e.target.value });
  return (
    <>
      <details className="help">
        <summary>Where do I find these?</summary>
        <ol>
          <li>Cloudflare dashboard → <b>R2</b> → create a bucket (e.g. <code>music</code>).</li>
          <li><b>Account ID</b>: shown on the R2 overview page (32 characters).</li>
          <li>R2 → <b>Manage API tokens</b> → Create token with <b>Object Read &amp; Write</b> for this bucket. Copy the Access Key ID and Secret Access Key.</li>
          <li>Optional, recommended: bucket → Settings → <b>Public access</b> → enable the r2.dev URL or connect a custom domain, and paste it as Public URL. Songs then stream through Cloudflare's CDN with free bandwidth.</li>
        </ol>
      </details>
      <div className="form-grid cols">
        <label>
          Account ID
          <input value={form.accountId} onChange={f("accountId")} placeholder="32-character hex ID" autoComplete="off" />
        </label>
        <label>
          Bucket
          <input value={form.bucket} onChange={f("bucket")} placeholder="music" autoComplete="off" />
        </label>
        <label>
          Location
          <select value={form.jurisdiction} onChange={f("jurisdiction")}>
            <option value="">Default</option>
            <option value="eu">EU jurisdiction</option>
          </select>
        </label>
      </div>
      <div className="form-grid cols">
        <label>
          Access Key ID
          <input value={form.accessKeyId} onChange={f("accessKeyId")} autoComplete="off" />
        </label>
        <label>
          Secret Access Key
          <input
            type="password"
            value={form.secretAccessKey ?? ""}
            onChange={f("secretAccessKey")}
            placeholder={hasSecret ? "Saved. Leave empty to keep." : ""}
            autoComplete="new-password"
          />
        </label>
      </div>
      <label>
        Public URL <span className="muted small">(optional: r2.dev or custom domain)</span>
        <input value={form.publicUrl} onChange={f("publicUrl")} placeholder="https://music.example.com" autoComplete="off" />
      </label>
    </>
  );
}

function S3Fields({ form, set, hasSecret }: { form: S3Form; set: (f: S3Form) => void; hasSecret: boolean }) {
  const f = (k: keyof S3Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <>
      <details className="help">
        <summary>Where do I find these?</summary>
        <ol>
          <li>AWS console → <b>S3</b> → create a bucket and note its <b>region</b> (e.g. <code>ap-south-1</code> for Mumbai).</li>
          <li>IAM → create a user with access to this bucket (<code>s3:GetObject</code>, <code>PutObject</code>, <code>DeleteObject</code>, <code>ListBucket</code>, and <code>PutBucketCORS</code> for the CORS button). Create an access key.</li>
          <li>Optional: a CloudFront distribution or public bucket URL as Public URL. Otherwise private signed links are used.</li>
          <li>Other S3-compatible services (Wasabi, Backblaze B2, MinIO…): fill in Endpoint too.</li>
        </ol>
      </details>
      <div className="form-grid cols">
        <label>
          Region
          <input value={form.region} onChange={f("region")} placeholder="ap-south-1" autoComplete="off" />
        </label>
        <label>
          Bucket
          <input value={form.bucket} onChange={f("bucket")} autoComplete="off" />
        </label>
        <label>
          Access Key ID
          <input value={form.accessKeyId} onChange={f("accessKeyId")} autoComplete="off" />
        </label>
        <label>
          Secret Access Key
          <input
            type="password"
            value={form.secretAccessKey ?? ""}
            onChange={f("secretAccessKey")}
            placeholder={hasSecret ? "Saved. Leave empty to keep." : ""}
            autoComplete="new-password"
          />
        </label>
      </div>
      <label>
        Public URL <span className="muted small">(optional: CloudFront / public bucket URL)</span>
        <input value={form.publicUrl} onChange={f("publicUrl")} placeholder="https://d1234.cloudfront.net" autoComplete="off" />
      </label>
      <details className="help">
        <summary>S3-compatible service (not AWS)?</summary>
        <div className="form-grid">
          <label>
            Endpoint
            <input value={form.endpoint} onChange={f("endpoint")} placeholder="https://s3.wasabisys.com" autoComplete="off" />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.forcePathStyle} onChange={f("forcePathStyle")} />
            Path-style URLs (MinIO and some others need this)
          </label>
        </div>
      </details>
    </>
  );
}

function MoveSongs({ state, reload }: { state: StorageState; reload: () => void }) {
  const configured = (Object.keys(state.configured) as StorageBackend[]).filter((b) => state.configured[b]);
  const [from, setFrom] = useState<StorageBackend>("local");
  const [to, setTo] = useState<StorageBackend>(state.effectiveTarget === "local" ? (configured.find((b) => b !== "local") ?? "local") : state.effectiveTarget);
  const [error, setError] = useState<string | null>(null);
  const m = state.move;

  useEffect(() => {
    if (!m?.running) return;
    const t = setInterval(reload, 1500);
    return () => clearInterval(t);
  }, [m?.running, reload]);

  if (configured.length < 2) {
    return <p className="muted small">Set up R2 or S3 to move songs between storages.</p>;
  }
  return (
    <div>
      <div className="move-row">
        <label>
          From
          <select value={from} onChange={(e) => setFrom(e.target.value as StorageBackend)} disabled={m?.running}>
            {configured.map((b) => (
              <option key={b} value={b}>
                {SHORT[b]} ({state.counts[b]} songs)
              </option>
            ))}
          </select>
        </label>
        <span className="arrow">→</span>
        <label>
          To
          <select value={to} onChange={(e) => setTo(e.target.value as StorageBackend)} disabled={m?.running}>
            {configured.map((b) => (
              <option key={b} value={b}>
                {SHORT[b]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn-primary"
          disabled={m?.running || from === to || !state.counts[from]}
          onClick={async () => {
            if (!confirm(`Move ${state.counts[from]} songs from ${SHORT[from]} to ${SHORT[to]}? Songs keep playing while they move.`)) return;
            setError(null);
            try {
              await api.admin.storage.move(from, to);
              reload();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Move {state.counts[from] || ""} songs
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
      {m && (m.running || m.total > 0) && (
        <div className="move-status">
          <div className="bar">
            <i style={{ width: `${m.total ? (m.done / m.total) * 100 : 0}%` }} />
          </div>
          <div className="small">
            {m.running ? "Moving" : "Moved"} {m.done}/{m.total} songs from {SHORT[m.from]} to {SHORT[m.to]} · {formatBytes(m.bytes)}
            {m.current && <span className="muted"> · now: {m.current}</span>}
            {m.running && (
              <button className="link-btn" onClick={() => api.admin.storage.cancelMove().then(reload)}>
                {" "}
                Stop
              </button>
            )}
          </div>
          {m.failed.length > 0 && (
            <ul className="form-error small">
              {m.failed.slice(0, 10).map((f) => (
                <li key={f.id}>
                  {f.title}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function StorageSettings() {
  const [state, setState] = useState<StorageState | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [open, setOpen] = useState<StorageBackend>("local");
  const [r2, setR2] = useState<R2Form>(emptyR2);
  const [s3, setS3] = useState<S3Form>(emptyS3);
  const [test, setTest] = useState<{ backend: "r2" | "s3"; result: StorageTest } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = React.useCallback(() => {
    api.admin.storage.get().then(
      (s) => {
        setState(s);
        setError(null);
      },
      setError,
    );
  }, []);

  // First load: fill forms from saved settings.
  useEffect(() => {
    api.admin.storage.get().then((s) => {
      setState(s);
      setOpen(s.effectiveTarget);
      if (s.r2) setR2({ ...emptyR2, ...s.r2, secretAccessKey: "" });
      if (s.s3) setS3({ ...emptyS3, ...s.s3, secretAccessKey: "" });
    }, setError);
  }, []);

  if (error && !state) return <ErrorBox error={error} onRetry={load} />;
  if (!state) return <Loading />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const save = (andUse: boolean) =>
    run(async () => {
      const body =
        open === "r2"
          ? { r2: { ...r2, secretAccessKey: r2.secretAccessKey || undefined } }
          : open === "s3"
            ? { s3: { ...s3, secretAccessKey: s3.secretAccessKey || undefined } }
            : {};
      const next = await api.admin.storage.save({ ...body, ...(andUse ? { target: open } : {}) });
      setState({ ...state, ...next });
      setR2((f) => ({ ...f, secretAccessKey: "" }));
      setS3((f) => ({ ...f, secretAccessKey: "" }));
      setMsg({ ok: true, text: andUse ? `New uploads now go to ${NAMES[open]}.` : "Saved." });
    });

  return (
    <div className="storage-settings">
      <h2 className="section-title">Where new uploads are saved</h2>
      <div className="storage-cards" role="radiogroup" aria-label="Storage">
        {(["local", "r2", "s3"] as StorageBackend[]).map((b, i) => (
          <button
            key={b}
            role="radio"
            aria-checked={open === b}
            className={`storage-card ${open === b ? "open" : ""}`}
            onClick={() => {
              setOpen(b);
              setTest(null);
              setMsg(null);
            }}
          >
            <span className="num">{i + 1}</span>
            <span className="name">{NAMES[b]}</span>
            <span className="meta">
              {state.effectiveTarget === b ? (
                <span className="badge ready">Uploads go here</span>
              ) : state.configured[b] ? (
                <span className="badge">Ready</span>
              ) : (
                <span className="badge">Not set up</span>
              )}
              <span className="muted small">{state.counts[b]} songs</span>
            </span>
          </button>
        ))}
      </div>

      <div className="card storage-form">
        {open === "local" && (
          <>
            <p>
              Files are kept on this server's disk at <code>{state.localDir}</code> and streamed by this server. Simple and free,
              but limited by the server's disk and bandwidth.
            </p>
          </>
        )}
        {open === "r2" && <R2Fields form={r2} set={setR2} hasSecret={!!state.r2?.hasSecret} />}
        {open === "s3" && <S3Fields form={s3} set={setS3} hasSecret={!!state.s3?.hasSecret} />}

        <div className="row-gap storage-actions">
          {open !== "local" && (
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  setTest(null);
                  const result =
                    open === "r2"
                      ? await api.admin.storage.test({ backend: "r2", r2: { ...r2, secretAccessKey: r2.secretAccessKey || undefined } })
                      : await api.admin.storage.test({ backend: "s3", s3: { ...s3, secretAccessKey: s3.secretAccessKey || undefined } });
                  setTest({ backend: open, result });
                })
              }
            >
              {busy ? "Working…" : "Test connection"}
            </button>
          )}
          {open !== "local" && (
            <button className="btn" disabled={busy} onClick={() => save(false)}>
              Save
            </button>
          )}
          {state.effectiveTarget !== open && (
            <button className="btn-primary" disabled={busy} onClick={() => save(true)}>
              {open === "local" ? "Use local storage for new uploads" : "Save & use for new uploads"}
            </button>
          )}
        </div>
        {msg && <div className={msg.ok ? "form-ok" : "form-error"}>{msg.text}</div>}
        {test && test.backend === open && <TestResult result={test.result} backend={test.backend} onAllowed={load} />}
      </div>

      <h2 className="section-title">Move songs</h2>
      <p className="muted small">
        Each song remembers where it's stored, so you can switch storage any time. Move existing songs here, e.g. from Local to
        Cloudflare R2. Songs keep playing while they move.
      </p>
      <MoveSongs state={state} reload={load} />
    </div>
  );
}
