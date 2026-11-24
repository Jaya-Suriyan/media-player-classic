import React from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatTime } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { Cover, ErrorBox, Loading, PlayButton, SongList } from "../components/Media";
import { ShuffleIcon } from "../components/Icons";
import { usePlayer } from "../player/PlayerContext";

export default function Album() {
  const { id = "" } = useParams();
  const { data, error, reload } = useAsync(() => api.album(id), [id]);
  const p = usePlayer();

  if (error) return <ErrorBox error={error} onRetry={error.message.includes("not found") ? undefined : reload} />;
  if (!data || data.album.id !== id) return <Loading />;
  const { album, songs } = data;
  const total = songs.reduce((t, s) => t + (s.duration ?? 0), 0);

  return (
    <div>
      <header className="hero">
        <Cover cover={album.cover} large className="hero-art" />
        <div className="hero-meta">
          <div className="eyebrow">Album</div>
          <h1>{album.title}</h1>
          <div className="muted">
            <Link to={`/artist/${album.artist.id}`}>{album.artist.name}</Link>
            {album.year ? ` · ${album.year}` : ""} · {songs.length} songs · {formatTime(total)}
          </div>
          <div className="hero-actions">
            <PlayButton songs={songs} />
            <button
              className="icon-btn"
              aria-label="Shuffle play"
              onClick={() => {
                const shuffled = songs.slice().sort(() => Math.random() - 0.5);
                p.playList(shuffled, 0);
              }}
            >
              <ShuffleIcon size={22} />
            </button>
          </div>
        </div>
      </header>
      <SongList songs={songs} numbered showCover={false} showAlbum={false} />
    </div>
  );
}
