import React from "react";
import { useParams, Link } from "react-router-dom";
import { MOCK_SONGS } from "../data/mockSongs";

export default function Album() {
  const { id } = useParams();
  const songs = MOCK_SONGS.filter((s) => s.albumId === id);
  if (songs.length === 0) return <div>Album not found</div>;
  const album = songs[0].album;
  return (
    <div>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div
          style={{
            width: 200,
            height: 200,
            background: "#08101b",
            borderRadius: 8,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundImage: `url(${songs[0].cover})`,
          }}
        />
        <div>
          <h2 style={{ margin: 0 }}>{album}</h2>
          <div className="small">{songs.length} songs</div>
          <div style={{ marginTop: 12 }}>
            <button
              className="btn"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("play-album", { detail: { albumId: id } })
                )
              }
            >
              Play
            </button>
            <button className="btn">♡</button>
          </div>
        </div>
      </div>

      <section style={{ marginTop: 20 }}>
        <div className="card">
          {songs.map((s, idx) => (
            <div key={s.id} className="track-row">
              <div className="track-left">
                <div className="track-num">{idx + 1}</div>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    background: "#08101b",
                    borderRadius: 6,
                  }}
                />
                <div>
                  <div className="track-title">
                    <Link to={`/song/${s.id}`}>{s.title}</Link>
                  </div>
                  <div className="small">
                    <Link to={`/artist/${s.artistId}`}>{s.artist}</Link>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  className="btn"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("play-album", {
                        detail: { albumId: id, startId: s.id },
                      })
                    )
                  }
                >
                  ▶
                </button>
                <div className="small">
                  {s.duration
                    ? Math.floor(s.duration / 60) +
                      ":" +
                      (s.duration % 60).toString().padStart(2, "0")
                    : "—"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
