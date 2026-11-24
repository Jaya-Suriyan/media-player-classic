import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { absUrl, api, formatTime } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { settingsStore, type Quality } from "../lib/library";
import { ArtistLinks, Cover, LikeButton } from "../components/Media";
import {
  ChevronDownIcon,
  CloseIcon,
  LyricsIcon,
  MoonIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SignalIcon,
  VolumeIcon,
} from "../components/Icons";
import { usePlayer, useProgress } from "./PlayerContext";
import { DownloadButton } from "../components/Downloads";

/* ------------------------------------------------------------------ */
/* Seek bar (pointer + keyboard accessible)                             */
/* ------------------------------------------------------------------ */

export function SeekBar({ compact = false }: { compact?: boolean }) {
  const p = usePlayer();
  const { time, duration, buffered } = useProgress();
  const [drag, setDrag] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const d = duration || p.current?.duration || 0;
  const shown = drag ?? time;
  const pct = d ? (shown / d) * 100 : 0;
  const bufPct = d ? Math.min(100, (buffered / d) * 100) : 0;

  const ratioAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const onDown = (e: React.PointerEvent) => {
    if (!d) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag(ratioAt(e.clientX) * d);
  };
  const onMove = (e: React.PointerEvent) => drag !== null && setDrag(ratioAt(e.clientX) * d);
  const onUp = (e: React.PointerEvent) => {
    if (drag === null) return;
    p.seek(ratioAt(e.clientX) * d);
    setDrag(null);
  };

  return (
    <div className={`seek ${compact ? "compact" : ""}`}>
      {!compact && <span className="time">{formatTime(shown)}</span>}
      <div
        ref={ref}
        className={`seek-track ${drag !== null ? "dragging" : ""}`}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(d)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${formatTime(shown)} of ${formatTime(d)}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") p.seekBy(5);
          else if (e.key === "ArrowLeft") p.seekBy(-5);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="seek-buffer" style={{ width: `${bufPct}%` }} />
        <div className="seek-fill" style={{ width: `${pct}%` }} />
        <div className="seek-thumb" style={{ left: `${pct}%` }} />
      </div>
      {!compact && <span className="time">{formatTime(d)}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small controls                                                       */
/* ------------------------------------------------------------------ */

function PlayPause({ size = 22, className = "play-btn" }: { size?: number; className?: string }) {
  const p = usePlayer();
  return (
    <button
      className={`${className} ${p.buffering && p.playing ? "busy" : ""}`}
      onClick={p.toggle}
      disabled={!p.current}
      aria-label={p.playing ? "Pause" : "Play"}
    >
      {p.playing ? <PauseIcon size={size} /> : <PlayIcon size={size} />}
    </button>
  );
}

function TransportControls({ big = false }: { big?: boolean }) {
  const p = usePlayer();
  const s = big ? 26 : 18;
  return (
    <div className={`transport ${big ? "big" : ""}`}>
      <button
        className={`icon-btn ${p.shuffle ? "on" : ""}`}
        onClick={p.toggleShuffle}
        aria-label="Shuffle"
        aria-pressed={p.shuffle}
      >
        <ShuffleIcon size={big ? 22 : 16} />
      </button>
      <button className="icon-btn" onClick={p.prev} disabled={!p.current} aria-label="Previous">
        <PrevIcon size={s} />
      </button>
      <PlayPause size={big ? 30 : 20} />
      <button className="icon-btn" onClick={p.next} disabled={!p.current} aria-label="Next">
        <NextIcon size={s} />
      </button>
      <button
        className={`icon-btn ${p.repeat !== "off" ? "on" : ""}`}
        onClick={p.cycleRepeat}
        aria-label={`Repeat: ${p.repeat}`}
      >
        {p.repeat === "one" ? <RepeatOneIcon size={big ? 22 : 16} /> : <RepeatIcon size={big ? 22 : 16} />}
      </button>
    </div>
  );
}

function VolumeControl() {
  const p = usePlayer();
  const { volume, muted } = settingsStore.use();
  return (
    <div className="volume">
      <button className="icon-btn" onClick={p.toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
        {muted || volume === 0 ? <MuteIcon size={18} /> : <VolumeIcon size={18} />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(e) => p.setVolume(Number(e.target.value))}
        aria-label="Volume"
        style={{ ["--v" as string]: `${(muted ? 0 : volume) * 100}%` }}
      />
    </div>
  );
}

const QUALITY_LABEL: Record<Quality, string> = {
  auto: "Auto (adapts to your network)",
  saver: "Data saver (48 kbps)",
  high: "High (160 kbps)",
};

function Popover({
  label,
  icon,
  active,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button
        className={`icon-btn ${active ? "on" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && (
        <div className="menu up" role="menu">
          <div className="menu-title">{label}</div>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function QualityMenu() {
  const p = usePlayer();
  const { quality } = settingsStore.use();
  return (
    <Popover label="Streaming quality" icon={<SignalIcon size={18} />} active={quality === "saver"}>
      {(close) => (
        <>
          {(Object.keys(QUALITY_LABEL) as Quality[]).map((q) => (
            <button
              key={q}
              role="menuitemradio"
              aria-checked={quality === q}
              className={quality === q ? "checked" : ""}
              onClick={() => {
                p.setQuality(q);
                close();
              }}
            >
              {QUALITY_LABEL[q]}
            </button>
          ))}
          {p.bitrate && <div className="menu-note">Now streaming at {Math.round(p.bitrate / 1000)} kbps</div>}
        </>
      )}
    </Popover>
  );
}

function SleepLabel() {
  const { sleep } = usePlayer();
  const [, tick] = useState(0);
  useEffect(() => {
    if (sleep.mode !== "time") return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [sleep]);
  if (sleep.mode === "off") return null;
  if (sleep.mode === "end") return <div className="menu-note">Stopping after this song</div>;
  return <div className="menu-note">Stopping in {Math.max(1, Math.ceil((sleep.endsAt - Date.now()) / 60000))} min</div>;
}

export function SleepMenu() {
  const p = usePlayer();
  return (
    <Popover label="Sleep timer" icon={<MoonIcon size={18} />} active={p.sleep.mode !== "off"}>
      {(close) => (
        <>
          <SleepLabel />
          {[15, 30, 45, 60].map((m) => (
            <button key={m} role="menuitem" onClick={() => (p.setSleep(m), close())}>
              {m} minutes
            </button>
          ))}
          <button role="menuitem" onClick={() => (p.setSleep("end"), close())}>
            End of song
          </button>
          {p.sleep.mode !== "off" && (
            <button role="menuitem" onClick={() => (p.setSleep("off"), close())}>
              Turn off
            </button>
          )}
        </>
      )}
    </Popover>
  );
}

function StatusLine() {
  const p = usePlayer();
  if (p.error) return <div className="status-line err">{p.error}</div>;
  if (p.stalled) return <div className="status-line">Weak connection, reconnecting…</div>;
  if (p.offlineSource && !navigator.onLine) return <div className="status-line ok">Playing downloaded copy</div>;
  return null;
}

/* ------------------------------------------------------------------ */
/* Bottom bar (desktop) + mini player (mobile)                          */
/* ------------------------------------------------------------------ */

export function PlayerBar({ onOpenNowPlaying, onToggleQueue }: { onOpenNowPlaying: () => void; onToggleQueue: () => void }) {
  const p = usePlayer();
  const c = p.current;
  if (!c) return null;
  return (
    <div className="player-bar" aria-label="Player">
      <SeekBar compact />
      <div className="pb-left" onClick={onOpenNowPlaying}>
        <Cover cover={c.cover} size={52} />
        <div className="pb-meta">
          <div className="pb-title">{c.title}</div>
          <div className="pb-sub">
            <span className="desk-only">
              <ArtistLinks artists={c.artists} />
            </span>
            <span className="mob-only">{c.artists.map((a) => a.name).join(", ")}</span>
          </div>
          <StatusLine />
        </div>
        <span className="desk-only">
          <LikeButton id={c.id} />
        </span>
      </div>

      <div className="pb-center desk-only">
        <TransportControls />
        <SeekBar />
      </div>

      <div className="pb-right">
        <span className="mob-only">
          <LikeButton id={c.id} size={20} />
        </span>
        <span className="mob-only">
          <PlayPause size={22} className="icon-btn mini-play" />
        </span>
        <span className="desk-only right-tools">
          <QualityMenu />
          <DownloadButton song={c} size={18} />
          <SleepMenu />
          <button className="icon-btn" onClick={onToggleQueue} aria-label="Queue">
            <QueueIcon size={18} />
          </button>
          <VolumeControl />
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Queue                                                                */
/* ------------------------------------------------------------------ */

export function QueueList({ onNavigate }: { onNavigate?: () => void }) {
  const p = usePlayer();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  if (!p.current) return <div className="empty small">Play something to fill your queue.</div>;
  const upcoming = p.queue.slice(p.index + 1);
  return (
    <div className="queue">
      <div className="queue-section">Now playing</div>
      <QueueRow i={p.index} onNavigate={onNavigate} />
      <div className="queue-section">
        Next up
        {upcoming.length > 0 && (
          <button className="link-btn" onClick={p.clearUpcoming}>
            Clear
          </button>
        )}
      </div>
      {upcoming.length === 0 && (
        <div className="small muted pad">
          {p.autoplay ? "Similar songs will play when the queue ends." : "Nothing queued."}
        </div>
      )}
      <ul>
        {upcoming.map((s, k) => {
          const i = p.index + 1 + k;
          return (
            <li
              key={s.id + i}
              draggable
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragFrom !== null) p.moveInQueue(dragFrom, i);
                setDragFrom(null);
              }}
            >
              <QueueRow i={i} onNavigate={onNavigate} />
            </li>
          );
        })}
      </ul>
      <label className="autoplay-toggle">
        <input type="checkbox" checked={p.autoplay} onChange={(e) => p.setAutoplay(e.target.checked)} />
        Autoplay similar songs
      </label>
    </div>
  );
}

function QueueRow({ i, onNavigate }: { i: number; onNavigate?: () => void }) {
  const p = usePlayer();
  const s = p.queue[i];
  const isCurrent = i === p.index;
  return (
    <div className={`q-row ${isCurrent ? "current" : ""}`} onClick={() => !isCurrent && p.jumpTo(i)}>
      <Cover cover={s.cover} size={40} />
      <div className="q-meta">
        <div className="q-title">{s.title}</div>
        <div className="q-sub" onClick={onNavigate}>
          <ArtistLinks artists={s.artists} />
        </div>
      </div>
      {!isCurrent && (
        <button
          className="icon-btn"
          aria-label={`Remove ${s.title} from queue`}
          onClick={(e) => {
            e.stopPropagation();
            p.removeAt(i);
          }}
        >
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Full-screen Now Playing (mobile, or expanded on desktop)             */
/* ------------------------------------------------------------------ */

export function NowPlaying({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = usePlayer();
  const [tab, setTab] = useState<"art" | "queue" | "lyrics">("art");
  const c = p.current;
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, [open, onClose]);

  if (!open || !c) return null;
  return (
    <div
      className="now-playing"
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      onTouchStart={(e) => (startY.current = e.touches[0].clientY)}
      onTouchEnd={(e) => {
        // Swipe down to close.
        if (startY.current !== null && e.changedTouches[0].clientY - startY.current > 120 && tab === "art") onClose();
        startY.current = null;
      }}
    >
      <div className="np-bg" style={c.cover ? { backgroundImage: `url(${absUrl(c.cover.sm)})` } : undefined} />
      <header className="np-head">
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <ChevronDownIcon size={26} />
        </button>
        <div className="np-from">
          {c.album ? (
            <Link to={`/album/${c.album.id}`} onClick={onClose}>
              {c.album.title}
            </Link>
          ) : (
            "Now playing"
          )}
        </div>
        <div className="np-tabs">
          <button className={`icon-btn ${tab === "lyrics" ? "on" : ""}`} onClick={() => setTab(tab === "lyrics" ? "art" : "lyrics")} aria-label="Lyrics" aria-pressed={tab === "lyrics"}>
            <LyricsIcon size={20} />
          </button>
          <button className={`icon-btn ${tab === "queue" ? "on" : ""}`} onClick={() => setTab(tab === "queue" ? "art" : "queue")} aria-label="Queue" aria-pressed={tab === "queue"}>
            <QueueIcon size={20} />
          </button>
        </div>
      </header>

      <div className="np-body">
        {tab === "art" && (
          <div className="np-art">
            <Cover cover={c.cover} large />
          </div>
        )}
        {tab === "queue" && (
          <div className="np-panel">
            <QueueList onNavigate={onClose} />
          </div>
        )}
        {tab === "lyrics" && (
          <div className="np-panel">
            <Lyrics songId={c.id} />
          </div>
        )}
      </div>

      <div className="np-controls">
        <div className="np-meta">
          <div>
            <div className="np-title">{c.title}</div>
            <div className="np-artist" onClick={onClose}>
              <ArtistLinks artists={c.artists} />
            </div>
          </div>
          <LikeButton id={c.id} size={24} />
        </div>
        <StatusLine />
        <SeekBar />
        <TransportControls big />
        <div className="np-tools">
          <QualityMenu />
          <DownloadButton song={c} size={22} />
          <SleepMenu />
        </div>
      </div>
    </div>
  );
}

function Lyrics({ songId }: { songId: string }) {
  const { data, loading } = useAsync(() => api.song(songId), [songId]);
  if (loading && !data) return <div className="empty">Loading lyrics…</div>;
  if (!data?.lyrics) return <div className="empty">No lyrics for this song yet.</div>;
  return <pre className="lyrics">{data.lyrics}</pre>;
}
