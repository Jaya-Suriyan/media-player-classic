import React from "react";
import { NavLink } from "react-router-dom";
import { DownloadIcon, HeartIcon, HomeIcon, LibraryIcon, MusicIcon, SearchIcon, UploadIcon } from "./Icons";

const nav = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");

export default function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  return (
    <nav className="sidebar" aria-label="Main">
      <NavLink to="/" className="logo">
        <span className="logo-mark">
          <MusicIcon size={18} />
        </span>
        Media Player Classic
      </NavLink>
      <div className="nav-group">
        <NavLink to="/" end className={nav}>
          <HomeIcon /> Home
        </NavLink>
        <NavLink to="/search" className={nav}>
          <SearchIcon /> Search
        </NavLink>
      </div>
      <div className="nav-label">Your library</div>
      <div className="nav-group">
        <NavLink to="/library" end className={nav}>
          <LibraryIcon /> Library
        </NavLink>
        <NavLink to="/library/liked" className={nav}>
          <HeartIcon /> Liked songs
        </NavLink>
        <NavLink to="/library/downloads" className={nav}>
          <DownloadIcon /> Downloads
        </NavLink>
      </div>
      <div className="nav-label">Browse</div>
      <div className="nav-group">
        <NavLink to="/browse/new" className={nav}>New releases</NavLink>
        <NavLink to="/browse/popular" className={nav}>Top charts</NavLink>
        <NavLink to="/browse/artists" className={nav}>Artists</NavLink>
        <NavLink to="/browse/albums" className={nav}>Albums</NavLink>
      </div>
      <div className="nav-spacer" />
      <NavLink to="/admin" className={({ isActive }) => `admin-link ${isActive ? "active" : ""}`}>
        <UploadIcon size={18} /> {isAdmin ? "Admin" : "Admin login"}
      </NavLink>
    </nav>
  );
}

export function MobileNav() {
  return (
    <nav className="mobile-nav" aria-label="Main">
      <NavLink to="/" end className={nav}>
        <HomeIcon size={22} />
        <span>Home</span>
      </NavLink>
      <NavLink to="/search" className={nav}>
        <SearchIcon size={22} />
        <span>Search</span>
      </NavLink>
      <NavLink to="/library" className={nav}>
        <LibraryIcon size={22} />
        <span>Library</span>
      </NavLink>
    </nav>
  );
}
