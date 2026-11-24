import React from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatTime } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { ArtistLinks, Cover, ErrorBox, LikeButton, Loading, SongList } from "../components/Media";
import { PauseIcon, PlayIcon } from "../components/Icons";
import { usePlayer } from "../player/PlayerContext";
import { DownloadButton } from "../components/Downloads";

export default function SongDetails() {
  const { id = "" } = useParams();
  const { data, error, reload } = useAsync(() => api.song(id), [id]);
  const p = usePlayer();

  if (error) return <ErrorBox error={error} onRetry={error.message.includes("not found") ? undefined : reload} />;
  if (!data || data.song.id !== id) return <Loading />;
  const { song, lyrics, related } = data;
  const isCurrent = p.current?.id === song.id;

  return (
    <div>
      <header className="hero">
        <Cover cover={song.cover} large className="hero-art" />
        <div className="hero-meta">
          <div className="eyebrow">Song</div>
          <h1>{song.title}</h1>
          <div className="muted">
            <ArtistLinks artists={song.artists} />
            {song.album && (
              <>
                {" · "}
                <Link to={`/album/${song.album.id}`}>{song.album.title}</Link>
              </>
            )}
            {song.year ? ` · ${song.year}` : ""} · {formatTime(song.duration)}
          </div>
          {song.genre && (
            <Link to={`/genre/${encodeURIComponent(song.genre)}`} className="chip small-chip">
              {song.genre}
            </Link>
          )}
          <div className="hero-actions">
            <button
              className="btn-primary play-big"
              aria-label={isCurrent && p.playing ? "Pause" : "Play"}
              onClick={() => (isCurrent ? p.toggle() : p.playList([song, ...related], 0))}
            >
              {isCurrent && p.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
            </button>
            <LikeButton id={song.id} size={24} />
            <DownloadButton song={song} size={24} />
            <button className="btn" onClick={() => p.addToQueue(song)}>
              Add to queue
            </button>
          </div>
        </div>
      </header>

      {lyrics && (
        <section className="shelf">
          <div className="shelf-head">
            <h2>Lyrics</h2>
          </div>
          <pre className="lyrics">{lyrics}</pre>
        </section>
      )}

      {related.length > 0 && (
        <section className="shelf">
          <div className="shelf-head">
            <h2>More from {song.artist.name}</h2>
          </div>
          <SongList songs={related} />
        </section>
      )}
    </div>
  );
}
