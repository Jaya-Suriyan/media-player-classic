import React from "react";
import { Link } from "react-router-dom";

export default function Sidebar() {
  return (
    <aside className="sidebar card">
      <div className="logo">Media Player Classic</div>
      <nav className="browse">
        <div className="nav-section">Browse</div>
        <Link to="/">New Releases</Link>
        <Link to="/">Top Charts</Link>
        <Link to="/">Top Playlists</Link>
        <Link to="/">Podcasts</Link>
      </nav>

      <div className="library">
        <div className="nav-section">Library</div>
        <Link to="/">History</Link>
        <Link to="/">Liked Songs</Link>
        <Link to="/">Albums</Link>
        <Link to="/">Artists</Link>
      </div>

      <button className="btn new-playlist">+ New Playlist</button>
    </aside>
  );
}
