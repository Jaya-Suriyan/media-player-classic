import React from "react";
import { useParams, Link } from "react-router-dom";
import { MOCK_SONGS } from "../data/mockSongs";

export default function SongDetails() {
  const { id } = useParams();
  const song = MOCK_SONGS.find((s) => s.id === id);
  if (!song) return <div>Song not found</div>;
  return (
    <div>
      <h2>{song.title}</h2>
      <div className="small">
        <Link to={`/artist/${song.artistId}`}>{song.artist}</Link> •{" "}
        <Link to={`/album/${song.albumId}`}>{song.album}</Link>
      </div>
      <div style={{ marginTop: 12 }}>
        <button
          className="btn"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("play-song", { detail: { id: song.id } })
            )
          }
        >
          Play
        </button>
      </div>
      <p style={{ marginTop: 12 }}>
        Details page with metadata, lyrics and suggestions will go here.
      </p>
    </div>
  );
}
