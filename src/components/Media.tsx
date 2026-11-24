import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { absUrl, formatTime, type Album, type Artist, type ArtistRef, type Cover as CoverT, type Song } from "../lib/api";
import { toggleLike, useIsLiked } from "../lib/library";
import { usePlayer } from "../player/PlayerContext";
import { HeartFillIcon, HeartIcon, MoreIcon, MusicIcon, PauseIcon, PlayIcon } from "./Icons";

/** Lazy-loaded square artwork with a placeholder. Uses the small image unless `large`. */
export function Cover({
  cover,
  size,
  large,
  round,
  className = "",
}: {
  cover: CoverT | null | undefined;
  size?: number | string;
  large?: boolean;
  round?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = cover ? absUrl(large ? cover.lg : cover.sm) : null;
  return (
    <div
      className={`cover ${round ? "round" : ""} ${className}`}
      style={size !== undefined ? { width: size, height: size } : undefined}
    >
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <MusicIcon size={typeof size === "number" ? Math.max(14, size * 0.35) : 28} />
      )}
    </div>
  );
}

export function ArtistLinks({ artists, className }: { artists: ArtistRef[]; className?: string }) {
  return (
    <span className={className}>
      {artists.map((a, i) => (
        <React.Fragment key={a.id}>
          {i > 0 && ", "}
          <Link to={`/artist/${a.id}`} onClick={(e) => e.stopPropagation()}>
            {a.name}
          </Link>
        </React.Fragment>
      ))}
    </span>
  );
}

export function LikeButton({ id, size = 18 }: { id: string; size?: number }) {
  const liked = useIsLiked(id);
  return (
    <button
      className={`icon-btn like ${liked ? "on" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        toggleLike(id);
      }}
      aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
      aria-pressed={liked}
    >
      {liked ? <HeartFillIcon size={size} /> : <HeartIcon size={size} />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Song context menu                                                    */
/* ------------------------------------------------------------------ */

function SongMenu({ song, onClose }: { song: Song; onClose: () => void }) {
  const p = usePlayer();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("click", onDoc));
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
    onClose();
  };
  const share = async () => {
    const url = `${location.origin}/song/${song.id}`;
    if (navigator.share) await navigator.share({ title: song.title, text: `${song.title} · ${song.artist.name}`, url }).catch(() => {});
    else await navigator.clipboard?.writeText(url);
  };
  return (
    <div className="menu" ref={ref} role="menu" onClick={(e) => e.stopPropagation()}>
      <button role="menuitem" onClick={act(() => p.playNext(song))}>Play next</button>
      <button role="menuitem" onClick={act(() => p.addToQueue(song))}>Add to queue</button>
      <button role="menuitem" onClick={act(() => toggleLike(song.id))}>Like / Unlike</button>
      <Link role="menuitem" to={`/song/${song.id}`} onClick={onClose}>Song details</Link>
      <Link role="menuitem" to={`/artist/${song.artist.id}`} onClick={onClose}>Go to artist</Link>
      {song.album && (
        <Link role="menuitem" to={`/album/${song.album.id}`} onClick={onClose}>Go to album</Link>
      )}
      <button role="menuitem" onClick={act(share)}>Share</button>
    </div>
  );
}

export function SongMenuButton({ song }: { song: Song }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-wrap">
      <button
        className="icon-btn"
        aria-label={`More options for ${song.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <MoreIcon size={18} />
      </button>
      {open && <SongMenu song={song} onClose={() => setOpen(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Track list                                                           */
/* ------------------------------------------------------------------ */

export function SongList({
  songs,
  showCover = true,
  showAlbum = true,
  numbered = false,
  emptyText = "No songs yet.",
}: {
  songs: Song[];
  showCover?: boolean;
  showAlbum?: boolean;
  numbered?: boolean;
  emptyText?: string;
}) {
  const p = usePlayer();
  if (!songs.length) return <div className="empty">{emptyText}</div>;
  return (
    <ol className="track-list">
      {songs.map((s, i) => {
        const isCurrent = p.current?.id === s.id;
        return (
          <li
            key={s.id + i}
            className={`track ${isCurrent ? "current" : ""}`}
            onClick={() => (isCurrent ? p.toggle() : p.playList(songs, i))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target === e.currentTarget) isCurrent ? p.toggle() : p.playList(songs, i);
            }}
            tabIndex={0}
            aria-current={isCurrent || undefined}
          >
            <div className="track-num">
              {isCurrent && p.playing ? (
                <span className="eq" aria-label="Playing">
                  <i />
                  <i />
                  <i />
                </span>
              ) : numbered ? (
                <span className="n">{s.trackNo ?? i + 1}</span>
              ) : null}
              <span className="hover-play">{isCurrent && p.playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}</span>
            </div>
            {showCover && <Cover cover={s.cover} size={44} />}
            <div className="track-main">
              <div className="track-title">{s.title}</div>
              <div className="track-sub">
                <ArtistLinks artists={s.artists} />
                {showAlbum && s.album && (
                  <span className="hide-sm">
                    {" · "}
                    <Link to={`/album/${s.album.id}`} onClick={(e) => e.stopPropagation()}>
                      {s.album.title}
                    </Link>
                  </span>
                )}
              </div>
            </div>
            <LikeButton id={s.id} />
            <div className="track-time hide-sm">{formatTime(s.duration)}</div>
            <SongMenuButton song={s} />
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Cards & shelves                                                      */
/* ------------------------------------------------------------------ */

export function Shelf({ title, to, children }: { title: string; to?: string; children: React.ReactNode }) {
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>{title}</h2>
        {to && (
          <Link to={to} className="see-all">
            See all
          </Link>
        )}
      </div>
      <div className="shelf-row">{children}</div>
    </section>
  );
}

export function SongCard({ song, list }: { song: Song; list: Song[] }) {
  const p = usePlayer();
  const isCurrent = p.current?.id === song.id;
  return (
    <div className="card-tile">
      <div className="tile-art">
        <Cover cover={song.cover} large />
        <button
          className="tile-play"
          aria-label={`Play ${song.title}`}
          onClick={() => (isCurrent ? p.toggle() : p.playList(list, list.indexOf(song)))}
        >
          {isCurrent && p.playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
        </button>
      </div>
      <Link to={`/song/${song.id}`} className="tile-title">
        {song.title}
      </Link>
      <div className="tile-sub">
        <ArtistLinks artists={song.artists} />
      </div>
    </div>
  );
}

export function AlbumCard({ album }: { album: Album }) {
  return (
    <Link to={`/album/${album.id}`} className="card-tile">
      <div className="tile-art">
        <Cover cover={album.cover} large />
      </div>
      <div className="tile-title">{album.title}</div>
      <div className="tile-sub">
        {album.year ? `${album.year} · ` : ""}
        {album.artist.name}
      </div>
    </Link>
  );
}

export function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <Link to={`/artist/${artist.id}`} className="card-tile artist-tile">
      <div className="tile-art">
        <Cover cover={artist.image} round large />
      </div>
      <div className="tile-title">{artist.name}</div>
      <div className="tile-sub">Artist</div>
    </Link>
  );
}

export function PlayButton({ songs, label = "Play" }: { songs: Song[]; label?: string }) {
  const p = usePlayer();
  const isThis = !!p.current && songs.some((s) => s.id === p.current!.id) && p.queue.length === songs.length;
  return (
    <button
      className="btn-primary play-big"
      disabled={!songs.length}
      onClick={() => (isThis ? p.toggle() : p.playList(songs, 0))}
      aria-label={isThis && p.playing ? "Pause" : label}
    >
      {isThis && p.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
    </button>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <p>{error.message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
