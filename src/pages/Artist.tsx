import React from "react";
import { useParams, Link } from "react-router-dom";
import { MOCK_SONGS } from "../data/mockSongs";

export default function Artist() {
  const { id } = useParams();
  const songs = MOCK_SONGS.filter((s) => s.artistId === id);
  if (songs.length === 0) return <div>Artist not found</div>;

  const artist = songs[0].artist;
  return (
    <div>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div
          style={{
            width: 160,
            height: 160,
            background: "#08101b",
            borderRadius: 8,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundImage: `url(${songs[0].cover})`,
          }}
        />
        <div>
          <h2 style={{ margin: 0 }}>{artist}</h2>
          <div className="small">{songs.length} songs</div>
          <div style={{ marginTop: 12 }}>
            <button
              className="btn"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("play-artist", { detail: { artistId: id } })
                )
              }
            >
              Play
            </button>
            <button className="btn">Follow</button>
          </div>
        </div>
      </div>

      <section style={{ marginTop: 20 }}>
        <h3>Top tracks</h3>
        <div className="grid">
          {songs.map((s) => (
            <div key={s.id} className="song card">
              <div
                style={{
                  width: 56,
                  height: 56,
                  background: "#08101b",
                  borderRadius: 6,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundImage: `url(${s.cover})`,
                }}
              />
              <div className="meta">
                <div style={{ fontWeight: 700 }}>
                  <Link to={`/song/${s.id}`}>{s.title}</Link>
                </div>
                <div className="small">
                  <Link to={`/album/${s.albumId}`}>{s.album}</Link>
                </div>
              </div>
              <div className="small">
                {s.duration
                  ? Math.floor(s.duration / 60) +
                    ":" +
                    (s.duration % 60).toString().padStart(2, "0")
                  : "—"}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
