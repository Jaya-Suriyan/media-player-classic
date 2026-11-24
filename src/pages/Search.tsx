import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { AlbumCard, ArtistCard, ErrorBox, Loading, Shelf, SongList } from "../components/Media";

function BrowseAll() {
  const { data } = useAsync(() => api.home(), []);
  return (
    <div>
      <h1 className="page-title">Search</h1>
      <p className="muted">Find songs by title, artist, album or genre. Typos are fine.</p>
      {data && data.genres.length > 0 && (
        <>
          <h2 className="section-title">Browse genres</h2>
          <div className="genre-grid">
            {data.genres.map((g, i) => (
              <Link
                key={g.genre}
                to={`/genre/${encodeURIComponent(g.genre)}`}
                className="genre-card"
                style={{ ["--h" as string]: (i * 47) % 360 }}
              >
                {g.genre}
              </Link>
            ))}
          </div>
        </>
      )}
      <h2 className="section-title">Browse</h2>
      <div className="genre-grid">
        <Link to="/browse/new" className="genre-card" style={{ ["--h" as string]: 150 }}>
          New releases
        </Link>
        <Link to="/browse/popular" className="genre-card" style={{ ["--h" as string]: 20 }}>
          Top charts
        </Link>
        <Link to="/browse/artists" className="genre-card" style={{ ["--h" as string]: 260 }}>
          Artists
        </Link>
        <Link to="/browse/albums" className="genre-card" style={{ ["--h" as string]: 320 }}>
          Albums
        </Link>
      </div>
    </div>
  );
}

export default function Search() {
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const { data, error, loading, reload } = useAsync(
    () => (q ? api.search(q) : Promise.resolve(null)),
    [q],
  );

  if (!q) return <BrowseAll />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const nothing = !data.songs.length && !data.artists.length && !data.albums.length;
  return (
    <div className={loading ? "dim" : ""}>
      <h1 className="page-title">Results for “{q}”</h1>
      {data.fuzzy && <p className="muted">No exact matches. Showing the closest results.</p>}
      {nothing && <div className="empty">Nothing found. Try another spelling or fewer words.</div>}

      {data.artists.length > 0 && (
        <Shelf title="Artists">
          {data.artists.map((a) => (
            <ArtistCard key={a.id} artist={a} />
          ))}
        </Shelf>
      )}

      {data.songs.length > 0 && (
        <section className="shelf">
          <div className="shelf-head">
            <h2>Songs</h2>
          </div>
          <SongList songs={data.songs} />
        </section>
      )}

      {data.albums.length > 0 && (
        <Shelf title="Albums">
          {data.albums.map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </Shelf>
      )}
    </div>
  );
}
