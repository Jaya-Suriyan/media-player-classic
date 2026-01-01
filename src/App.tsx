import React from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import Home from './pages/Home'
import Search from './pages/Search'
import Upload from './pages/Upload'
import Album from './pages/Album'
import SongDetails from './pages/SongDetails'
import AudioPlayer from './components/AudioPlayer'

export default function App() {
  return (
    <div className="app-root">
      <header className="topbar">
        <div className="brand">MPC UI</div>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/search">Search</Link>
          <Link to="/upload">Upload</Link>
        </nav>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/album/:id" element={<Album />} />
          <Route path="/song/:id" element={<SongDetails />} />
        </Routes>
      </main>

      <footer className="player-footer">
        <AudioPlayer />
      </footer>
    </div>
  )
}
