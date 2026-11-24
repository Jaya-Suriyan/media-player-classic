import React from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { historyStore } from "../lib/library";
import { downloadsStore } from "../lib/downloads";
import { useOnline } from "../lib/hooks";
import { PlayButton } from "../components/Media";
import { AlbumCard, ArtistCard, ErrorBox, Loading, Shelf, SongCard, SongList } from "../components/Media";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function RecentlyPlayed() {
  const ids = historyStore.use();
  const top = ids.slice(0, 12);
  const { data } = useAsync(() => api.songsByIds(top), [top.join(",")]);
  if (!data?.items.length) return null;
  return (
    <Shelf title="Recently played" to="/library/history">
      {data.items.map((s) => (
        <SongCard key={s.id} song={s} list={data.items} />
      ))}
    </Shelf>
  );
}

/** Shown when the server can't be reached: what's on the device still plays. */
function OfflineHome({ onRetry }: { onRetry: () => void }) {
  const downloads = downloadsStore.use();
  const songs = Object.values(downloads)
    .sort((a, b) => b.at - a.at)
    .map((d) => d.song);
  return (
    <div className="home">
      <h1 className="page-title">You're offline</h1>
      {songs.length ? (
        <>
          <p className="muted">Your downloaded songs are ready to play.</p>
          <div className="hero-actions">
            <PlayButton songs={songs} />
            <Link to="/library/downloads" className="btn">
              All downloads
            </Link>
          </div>
          <SongList songs={songs.slice(0, 20)} />
        </>
      ) : (
        <div className="empty-hero">
          <h2>Nothing downloaded yet</h2>
          <p>When you're back online, tap the download button on songs or albums to play them without internet.</p>
          <button className="btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const online = useOnline();
  const { data, error, loading, reload } = useAsync(() => api.home(), [online]);

  if (error && !data && (!online || error.message.includes("offline") || error.message.includes("reach"))) {
    return <OfflineHome onRetry={reload} />;
  }
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const empty = !data.newReleases.length;
  return (
    <div className="home">
      <h1 className="page-title">{greeting()}</h1>

      {empty && (
        <div className="empty-hero">
          <h2>Your library is empty</h2>
          <p>Sign in as admin and upload some music to get started.</p>
          <Link className="btn-primary" to="/admin">
            Upload music
          </Link>
        </div>
      )}

      {data.genres.length > 0 && (
        <div className="chips" role="list">
          {data.genres.map((g) => (
            <Link role="listitem" key={g.genre} to={`/genre/${encodeURIComponent(g.genre)}`} className="chip">
              {g.genre}
            </Link>
          ))}
        </div>
      )}

      <RecentlyPlayed />

      {data.trending.length > 0 && (
        <section className="shelf">
          <div className="shelf-head">
            <h2>Trending now</h2>
            <Link to="/browse/popular" className="see-all">
              See all
            </Link>
          </div>
          <SongList songs={data.trending.slice(0, 6)} />
        </section>
      )}

      {data.newReleases.length > 0 && (
        <Shelf title="New releases" to="/browse/new">
          {data.newReleases.map((s) => (
            <SongCard key={s.id} song={s} list={data.newReleases} />
          ))}
        </Shelf>
      )}

      {data.albums.length > 0 && (
        <Shelf title="Albums" to="/browse/albums">
          {data.albums.map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </Shelf>
      )}

      {data.artists.length > 0 && (
        <Shelf title="Popular artists" to="/browse/artists">
          {data.artists.map((a) => (
            <ArtistCard key={a.id} artist={a} />
          ))}
        </Shelf>
      )}
    </div>
  );
}
