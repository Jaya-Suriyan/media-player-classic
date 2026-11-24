import React, { useCallback, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, formatBytes } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useAsync } from "../../lib/hooks";
import { Loading } from "../../components/Media";
import UploadPanel from "./UploadPanel";
import SongManager from "./SongManager";

function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-wrap">
      <form
        className="login card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await login(email, password);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Admin login</h1>
        <p className="muted small">Sign in to upload music and edit song details.</p>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="btn-primary wide" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function Stats() {
  const { data } = useAsync(() => api.admin.stats(), []);
  if (!data) return null;
  const busy = (data.byStatus.pending ?? 0) + (data.byStatus.processing ?? 0);
  return (
    <div className="stats">
      <div className="stat">
        <b>{data.songs}</b>
        <span>Songs</span>
      </div>
      <div className="stat">
        <b>{data.artists}</b>
        <span>Artists</span>
      </div>
      <div className="stat">
        <b>{data.albums}</b>
        <span>Albums</span>
      </div>
      <div className="stat">
        <b>{data.plays}</b>
        <span>Plays</span>
      </div>
      <div className="stat">
        <b>{formatBytes(data.bytes)}</b>
        <span>Originals ({data.storage})</span>
      </div>
      {busy > 0 && (
        <div className="stat warn">
          <b>{busy}</b>
          <span>Processing</span>
        </div>
      )}
      {(data.byStatus.failed ?? 0) > 0 && (
        <div className="stat bad">
          <b>{data.byStatus.failed}</b>
          <span>Failed</span>
        </div>
      )}
    </div>
  );
}

function Account() {
  const { user, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="account">
      <p>
        Signed in as <b>{user?.email}</b>
      </p>
      <form
        className="card form-grid narrow"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.admin.changePassword(current, next);
            setMsg({ ok: true, text: "Password changed." });
            setCurrent("");
            setNext("");
          } catch (err) {
            setMsg({ ok: false, text: (err as Error).message });
          }
        }}
      >
        <h3>Change password</h3>
        <label>
          Current password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label>
          New password (min 8 characters)
          <input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        {msg && <div className={msg.ok ? "form-ok" : "form-error"}>{msg.text}</div>}
        <button className="btn-primary">Update password</button>
      </form>
      <button className="btn" onClick={logout}>
        Sign out
      </button>
    </div>
  );
}

export default function Admin() {
  const { user, checked } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  if (!checked) return <Loading />;
  if (!user) return <Login />;
  return (
    <div className="admin">
      <div className="admin-head">
        <h1 className="page-title">Admin</h1>
        <nav className="tabs">
          <NavLink to="/admin/upload">Upload</NavLink>
          <NavLink to="/admin/songs">Songs</NavLink>
          <NavLink to="/admin/account">Account</NavLink>
        </nav>
      </div>
      <Stats key={refreshKey} />
      <Routes>
        <Route index element={<Navigate to="upload" replace />} />
        <Route path="upload" element={<UploadPanel onChange={bump} />} />
        <Route path="songs" element={<SongManager onChange={bump} />} />
        <Route path="account" element={<Account />} />
      </Routes>
    </div>
  );
}
