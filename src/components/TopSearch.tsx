import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useDebounced } from "../lib/hooks";
import { CloseIcon, SearchIcon } from "./Icons";

type Suggestion = { kind: "song" | "artist"; id: string; label: string; sub?: string };

/** Search box with instant suggestions. Press "/" anywhere to focus it. */
export default function TopSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const onSearchPage = location.pathname === "/search";
  const [q, setQ] = useState(onSearchPage ? params.get("q") ?? "" : "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(q.trim(), 150);

  // Keep the box in sync when navigating to /search?q=...
  useEffect(() => {
    if (onSearchPage) setQ(params.get("q") ?? "");
  }, [onSearchPage, params]);

  // On the search page, typing updates the results live.
  useEffect(() => {
    if (!onSearchPage) return;
    const current = params.get("q") ?? "";
    if (debounced !== current) navigate(`/search${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, onSearchPage]);

  useEffect(() => {
    if (onSearchPage || debounced.length < 2) {
      setItems([]);
      return;
    }
    const ctl = new AbortController();
    api
      .suggest(debounced, ctl.signal)
      .then((r) => {
        setItems([
          ...r.artists.slice(0, 3).map((a) => ({ kind: "artist" as const, id: a.id, label: a.name, sub: "Artist" })),
          ...r.songs.map((s) => ({ kind: "song" as const, id: s.id, label: s.title, sub: s.artist })),
        ]);
        setActive(-1);
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [debounced, onSearchPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !t.closest("input, textarea, select, [contenteditable=true]")) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (s?: Suggestion) => {
    setOpen(false);
    if (s) navigate(s.kind === "artist" ? `/artist/${s.id}` : `/song/${s.id}`);
    else if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
    inputRef.current?.blur();
  };

  const showList = open && !onSearchPage && items.length > 0;

  return (
    <div className="top-search" role="search">
      <SearchIcon size={18} className="ts-icon" />
      <input
        ref={inputRef}
        type="search"
        placeholder="Search songs, artists, albums"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(-1, a - 1));
          } else if (e.key === "Enter") {
            go(active >= 0 ? items[active] : undefined);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        aria-label="Search"
        aria-expanded={showList}
        aria-controls="search-suggestions"
        aria-autocomplete="list"
        role="combobox"
        enterKeyHint="search"
        autoComplete="off"
      />
      {q && (
        <button className="icon-btn ts-clear" aria-label="Clear search" onClick={() => (setQ(""), inputRef.current?.focus())}>
          <CloseIcon size={16} />
        </button>
      )}
      {showList && (
        <ul className="suggestions" id="search-suggestions" role="listbox">
          {items.map((s, i) => (
            <li
              key={s.kind + s.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                go(s);
              }}
            >
              <span className="sg-label">{s.label}</span>
              <span className="sg-sub">{s.sub}</span>
            </li>
          ))}
          <li
            className={`sg-all ${active === items.length ? "active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              go();
            }}
          >
            See all results for “{q.trim()}”
          </li>
        </ul>
      )}
    </div>
  );
}
