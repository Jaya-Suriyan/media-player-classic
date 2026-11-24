import React, { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Sidebar, { MobileNav } from "./components/Sidebar";
import TopSearch from "./components/TopSearch";
import { Loading } from "./components/Media";
import { WifiOffIcon, CloseIcon } from "./components/Icons";
import { AuthProvider, useAuth } from "./lib/auth";
import { useOnline } from "./lib/hooks";
import { PlayerProvider, usePlayer } from "./player/PlayerContext";
import { NowPlaying, PlayerBar, QueueList } from "./player/PlayerUI";
import Home from "./pages/Home";
import Search from "./pages/Search";
import Album from "./pages/Album";
import Artist from "./pages/Artist";
import SongDetails from "./pages/SongDetails";
import Library from "./pages/Library";
import Browse from "./pages/Browse";

// Admin code is only downloaded by admins.
const Admin = lazy(() => import("./pages/admin/Admin"));

function Shell() {
  const location = useLocation();
  const { user } = useAuth();
  const player = usePlayer();
  const online = useOnline();
  const [npOpen, setNpOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(() => localStorage.getItem("mpc.queueOpen") !== "0");

  useEffect(() => {
    localStorage.setItem("mpc.queueOpen", queueOpen ? "1" : "0");
  }, [queueOpen]);

  // Scroll to top and close the full-screen player on navigation.
  useEffect(() => {
    document.querySelector(".main")?.scrollTo({ top: 0 });
    setNpOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!player.current) document.title = "Media Player Classic";
  }, [player.current]);

  const isAdmin = location.pathname.startsWith("/admin");

  return (
    <div className={`app ${player.current ? "has-player" : ""} ${queueOpen && !isAdmin ? "queue-open" : ""}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="left-col">
        <Sidebar isAdmin={!!user} />
      </aside>

      <main className="main" id="main">
        {!online && (
          <div className="offline-banner" role="status">
            <WifiOffIcon size={16} /> You're offline. Playback continues from what's already buffered.
          </div>
        )}
        {!isAdmin && (
          <div className="main-top">
            <TopSearch />
          </div>
        )}
        <div className="page">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/album/:id" element={<Album />} />
            <Route path="/artist/:id" element={<Artist />} />
            <Route path="/song/:id" element={<SongDetails />} />
            <Route path="/library" element={<Library tab="all" />} />
            <Route path="/library/liked" element={<Library tab="liked" />} />
            <Route path="/library/history" element={<Library tab="history" />} />
            <Route path="/browse/:kind" element={<Browse />} />
            <Route path="/genre/:genre" element={<Browse />} />
            <Route
              path="/admin/*"
              element={
                <Suspense fallback={<Loading />}>
                  <Admin />
                </Suspense>
              }
            />
            <Route path="*" element={<div className="empty">Page not found.</div>} />
          </Routes>
        </div>
      </main>

      {queueOpen && !isAdmin && player.current && (
        <aside className="right-col" aria-label="Queue">
          <div className="right-head">
            <h2>Queue</h2>
            <button className="icon-btn" onClick={() => setQueueOpen(false)} aria-label="Close queue">
              <CloseIcon size={18} />
            </button>
          </div>
          <QueueList />
        </aside>
      )}

      <footer className="bottom">
        <PlayerBar onOpenNowPlaying={() => setNpOpen(true)} onToggleQueue={() => setQueueOpen((o) => !o)} />
        <MobileNav />
      </footer>

      <NowPlaying open={npOpen} onClose={() => setNpOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PlayerProvider>
        <Shell />
      </PlayerProvider>
    </AuthProvider>
  );
}
