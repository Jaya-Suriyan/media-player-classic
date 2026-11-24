import React from "react";
import { NavLink } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { historyStore, likedStore } from "../lib/library";
import { ErrorBox, Loading, PlayButton, SongList } from "../components/Media";

function SongsFromIds({ ids, empty }: { ids: string[]; empty: string }) {
  const key = ids.join(",");
  const { data, error, reload } = useAsync(() => api.songsByIds(ids.slice(0, 300)), [key]);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <>
      {data.items.length > 0 && (
        <div className="hero-actions">
          <PlayButton songs={data.items} />
          <span className="muted">{data.items.length} songs</span>
        </div>
      )}
      <SongList songs={data.items} emptyText={empty} />
    </>
  );
}

export default function Library({ tab }: { tab: "all" | "liked" | "history" }) {
  const liked = likedStore.use();
  const history = historyStore.use();
  const active = tab === "history" ? "history" : "liked";

  return (
    <div>
      <h1 className="page-title">Your library</h1>
      <p className="muted small">Saved on this device.</p>
      <div className="tabs" role="tablist">
        <NavLink to="/library/liked" className={() => (active === "liked" ? "active" : "")} role="tab" aria-selected={active === "liked"}>
          Liked songs ({liked.length})
        </NavLink>
        <NavLink to="/library/history" className={() => (active === "history" ? "active" : "")} role="tab" aria-selected={active === "history"}>
          Recently played
        </NavLink>
      </div>
      {active === "liked" ? (
        <SongsFromIds ids={liked} empty="Tap the heart on any song to save it here." />
      ) : (
        <SongsFromIds ids={history} empty="Songs you play will show up here." />
      )}
    </div>
  );
}
