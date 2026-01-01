import React from "react";
import { MOCK_SONGS } from "../data/mockSongs";
import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div>
      <section className="hero card" style={{ marginBottom: 18 }}>
        <h3 style={{ margin: 0 }}>Editorial Picks</h3>
        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          {MOCK_SONGS.slice(0, 6).map((s) => (
            <div key={s.id} style={{ width: 150 }} className="card">
              <div
                style={{
                  height: 90,
                  background: "#08101b",
                  borderRadius: 6,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundImage: `url(${s.cover})`,
                }}
              />
              <div className="small" style={{ marginTop: 8 }}>
                {s.title}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="row-section">
        <div className="row-title">Radio Stations</div>
        <div className="circular-row">
          {MOCK_SONGS.slice(0, 8).map((s) => (
            <div key={s.id} className="circle-item">
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg,#2b6bff,#5fb3ff)",
                }}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="row-section">
        <div className="row-title">Recommended Artist Stations</div>
        <div className="circular-row">
          {MOCK_SONGS.slice(0, 8).map((s) => (
            <div key={s.id} style={{ textAlign: "center" }}>
              <div className="circle-item">
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "50%",
                    background: "linear-gradient(135deg,#ff5f7a,#ffb86b)",
                  }}
                />
              </div>
              <div className="caption small">{s.artist}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="row-section">
        <h3 className="row-title">What's Hot</h3>
        <div className="grid">
          {MOCK_SONGS.map((s) => (
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
                <div style={{ fontWeight: 700 }}>{s.title}</div>
                <div className="small">
                  <Link to={`/artist/${s.artistId}`}>{s.artist}</Link> •{" "}
                  <Link to={`/album/${s.albumId}`}>{s.album}</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
