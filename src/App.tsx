import React from "react";
import { Routes, Route, Link } from "react-router-dom";
import Home from "./pages/Home";
import Search from "./pages/Search";
import Upload from "./pages/Upload";
import Album from "./pages/Album";
import Artist from "./pages/Artist";
import SongDetails from "./pages/SongDetails";
import AudioPlayer from "./components/AudioPlayer";
import Sidebar from "./components/Sidebar";
import TopSearch from "./components/TopSearch";
import RightQueue from "./components/RightQueue";

export default function App() {
  return (
    <div className="app-root">
      <header className="topbar">
        <div className="brand">Media Player Classic</div>
        <nav className="topnav">
          <Link to="/">Browse</Link>
          <Link to="/">Chart</Link>
          <Link to="/upload">Upload</Link>
        </nav>
        <div style={{ flex: 1 }} />
        <div className="auth-links small">Log In • Sign Up</div>
      </header>

      <div className="content-wrap">
        <aside className="left-col">
          <Sidebar />
        </aside>

        <main className="main center-col">
          <TopSearch />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/album/:id" element={<Album />} />
            <Route path="/artist/:id" element={<Artist />} />
            <Route path="/song/:id" element={<SongDetails />} />
          </Routes>
        </main>

        <aside className="right-col">
          <RightQueue />
        </aside>
      </div>

      <footer className="player-footer">
        <AudioPlayer />
      </footer>
    </div>
  );
}
