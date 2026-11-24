import React, { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { AlbumCard, Cover, ErrorBox, Loading, PlayButton, Shelf, SongList } from "../components/Media";
import { DownloadAllButton } from "../components/Downloads";

export default function Artist() {
  const { id = "" } = useParams();
  const { data, error, reload } = useAsync(() => api.artist(id), [id]);
  const [showAll, setShowAll] = useState(false);

  if (error) return <ErrorBox error={error} onRetry={error.message.includes("not found") ? undefined : reload} />;
  if (!data || data.artist.id !== id) return <Loading />;
  const { artist, songs, albums } = data;

  return (
    <div>
      <header className="hero">
        <Cover cover={artist.image} large round className="hero-art" />
        <div className="hero-meta">
          <div className="eyebrow">Artist</div>
          <h1>{artist.name}</h1>
          <div className="muted">{artist.songCount} songs</div>
          <div className="hero-actions">
            <PlayButton songs={songs} />
            <DownloadAllButton songs={songs} label="Download all" />
          </div>
        </div>
      </header>

      <section className="shelf">
        <div className="shelf-head">
          <h2>Popular</h2>
        </div>
        <SongList songs={showAll ? songs : songs.slice(0, 10)} />
        {songs.length > 10 && (
          <button className="link-btn" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show less" : `Show all ${songs.length}`}
          </button>
        )}
      </section>

      {albums.length > 0 && (
        <Shelf title="Albums">
          {albums.map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </Shelf>
      )}
    </div>
  );
}
