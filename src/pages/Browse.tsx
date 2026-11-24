import React, { useState } from "react";
import { useParams } from "react-router-dom";
import { api, type Album, type Artist, type Song } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { AlbumCard, ArtistCard, ErrorBox, Loading, PlayButton, SongList } from "../components/Media";

const PAGE = 50;

type Kind = "new" | "popular" | "artists" | "albums" | "genre";

const TITLES: Record<Kind, string> = {
  new: "New releases",
  popular: "Top charts",
  artists: "Artists",
  albums: "Albums",
  genre: "",
};

/** Paged lists: new / popular songs, a genre, all artists, all albums. */
export default function Browse() {
  const params = useParams();
  const genre = params.genre;
  const kind: Kind = genre ? "genre" : ((params.kind as Kind) ?? "new");
  const [pages, setPages] = useState(1);
  const limit = PAGE * pages;

  const { data, error, loading, reload } = useAsync(async (): Promise<
    { songs: Song[] } | { artists: Artist[] } | { albums: Album[] }
  > => {
    if (kind === "artists") return { artists: (await api.artists({ limit })).items };
    if (kind === "albums") return { albums: (await api.albums({ limit })).items };
    const sort = kind === "popular" ? "popular" : "new";
    return { songs: (await api.songs({ sort, genre, limit })).items };
  }, [kind, genre, limit]);

  const title = kind === "genre" ? genre : TITLES[kind];
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const count = "songs" in data ? data.songs.length : "artists" in data ? data.artists.length : data.albums.length;
  return (
    <div>
      <h1 className="page-title">{title}</h1>
      {"songs" in data && (
        <>
          {data.songs.length > 0 && (
            <div className="hero-actions">
              <PlayButton songs={data.songs} />
            </div>
          )}
          <SongList songs={data.songs} />
        </>
      )}
      {"artists" in data && (
        <div className="tile-grid">
          {data.artists.map((a) => (
            <ArtistCard key={a.id} artist={a} />
          ))}
        </div>
      )}
      {"albums" in data && (
        <div className="tile-grid">
          {data.albums.map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </div>
      )}
      {count >= limit && (
        <button className="btn load-more" disabled={loading} onClick={() => setPages((n) => n + 1)}>
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
