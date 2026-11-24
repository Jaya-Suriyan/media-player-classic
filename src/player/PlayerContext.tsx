import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type Hls from "hls.js";
import type { HlsConfig } from "hls.js";
import { api, absUrl, type Song } from "../lib/api";
import { createStore } from "../lib/hooks";
import { pushHistory, settingsStore, suggestedQuality, type Quality } from "../lib/library";
import { downloadsStore, isDownloaded, offlineObjectUrl } from "../lib/downloads";

/** HLS variants, lowest first (must match the server ladder). */
const VARIANTS = ["48k", "96k", "160k"] as const;
const variantForBitrate = (bps: number | null | undefined) =>
  !bps ? null : bps <= 64_000 ? "48k" : bps <= 128_000 ? "96k" : "160k";
const saveData = () =>
  !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

/* ------------------------------------------------------------------ */
/* Progress lives in its own store so only the seek bar re-renders      */
/* several times per second, not the whole app.                         */
/* ------------------------------------------------------------------ */

export interface Progress {
  time: number;
  duration: number;
  buffered: number;
}
export const progressStore = createStore<Progress>(null, { time: 0, duration: 0, buffered: 0 });
const setProgress = (p: Partial<Progress>) => progressStore.set((prev) => ({ ...prev, ...p }));
export const useProgress = () => progressStore.use();

type Repeat = "off" | "all" | "one";
type SleepTimer = { mode: "off" } | { mode: "time"; endsAt: number } | { mode: "end" };

interface SessionState {
  ids: string[];
  index: number;
  time: number;
}
const sessionStore = createStore<SessionState>("mpc.session", { ids: [], index: 0, time: 0 });

export interface PlayerState {
  queue: Song[];
  index: number;
  current: Song | null;
  playing: boolean;
  buffering: boolean;
  /** Network trouble: trying to reconnect. */
  stalled: boolean;
  error: string | null;
  shuffle: boolean;
  repeat: Repeat;
  autoplay: boolean;
  sleep: SleepTimer;
  /** Bitrate currently streaming (bps), when known. */
  bitrate: number | null;
  /** Playing a downloaded copy (works offline). */
  offlineSource: boolean;
}

export interface PlayerActions {
  playList(songs: Song[], startIndex?: number): void;
  playSong(song: Song): void;
  playNext(song: Song): void;
  addToQueue(song: Song): void;
  removeAt(index: number): void;
  moveInQueue(from: number, to: number): void;
  clearUpcoming(): void;
  jumpTo(index: number): void;
  toggle(): void;
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(seconds: number): void;
  seekBy(delta: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  setAutoplay(on: boolean): void;
  setQuality(q: Quality): void;
  setSleep(minutes: number | "end" | "off"): void;
}

const PlayerCtx = createContext<(PlayerState & PlayerActions) | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Engine selection                                                     */
/* ------------------------------------------------------------------ */

const isAppleWebKit = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
  /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);

/** hls.js tuned for slow & flaky mobile networks. */
function hlsConfig(quality: Quality, lastEstimate: number | null, startLevel?: number): Partial<HlsConfig> {
  const retry = {
    maxNumRetry: 8,
    retryDelayMs: 1000,
    maxRetryDelayMs: 8000,
  };
  const policy = (ttfb: number, load: number) => ({
    default: { maxTimeToFirstByteMs: ttfb, maxLoadTimeMs: load, timeoutRetry: retry, errorRetry: retry },
  });
  return {
    enableWorker: true,
    // Start on the lowest bitrate so playback begins fast; ABR climbs when the network allows.
    startLevel: startLevel ?? (quality === "high" ? 2 : 0),
    abrEwmaDefaultEstimate: lastEstimate ?? 120_000,
    abrBandWidthFactor: 0.8,
    abrBandWidthUpFactor: 0.6,
    // Audio is tiny (a whole song is 2–6 MB): buffer the entire song ahead so
    // tunnels and dead zones don't interrupt it, and keep what was played for instant seeking back.
    maxBufferLength: 900,
    maxMaxBufferLength: 1800,
    maxBufferSize: 120 * 1000 * 1000,
    backBufferLength: 900,
    manifestLoadPolicy: policy(10_000, 20_000),
    playlistLoadPolicy: policy(10_000, 20_000),
    fragLoadPolicy: policy(15_000, 60_000),
  };
}

const shuffled = <T,>(arr: T[]) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ------------------------------------------------------------------ */
/* Provider                                                             */
/* ------------------------------------------------------------------ */

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsModule = useRef<typeof import("hls.js/light") | null>(null);
  const lastEstimate = useRef<number | null>(null);
  /** id of the song whose source is attached to <audio>. */
  const loadedId = useRef<string | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);
  const listened = useRef({ id: "", seconds: 0, lastTime: 0, reported: false });
  const unshuffledRef = useRef<Song[] | null>(null);
  /** Blob URL of the downloaded file currently playing (revoked on change). */
  const objectUrl = useRef<string | null>(null);
  /** Next song whose segments were pre-loaded, and at which variant. */
  const prefetched = useRef<{ id: string; variant: (typeof VARIANTS)[number] } | null>(null);
  const prefetchCtl = useRef<{ forId: string; ctl: AbortController } | null>(null);

  const [queue, setQueue] = useState<Song[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>("off");
  const [autoplay, setAutoplay] = useState(true);
  const [sleep, setSleepState] = useState<SleepTimer>({ mode: "off" });
  const [bitrate, setBitrate] = useState<number | null>(null);
  /** Playing from a downloaded file (no network needed). */
  const [offlineSource, setOfflineSource] = useState(false);

  const current = queue[index] ?? null;

  // Keep latest values reachable from event handlers without re-binding them.
  const live = useRef({ queue, index, current, repeat, autoplay, sleep });
  live.current = { queue, index, current, repeat, autoplay, sleep };

  /* ------------------------------ loading ----------------------------- */

  const destroyEngine = () => {
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    if (hlsRef.current) {
      lastEstimate.current = hlsRef.current.bandwidthEstimate || lastEstimate.current;
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  };

  const load = useCallback(async (song: Song, autoPlay: boolean, startAt = 0) => {
    const audio = audioRef.current!;
    destroyEngine();
    if (prefetchCtl.current && live.current.queue[live.current.index + 1]?.id !== song.id) {
      prefetchCtl.current.ctl.abort();
    }
    prefetchCtl.current = null;
    loadedId.current = song.id;
    listened.current = { id: song.id, seconds: 0, lastTime: startAt, reported: false };
    pendingSeek.current = startAt > 0 ? startAt : null;
    setError(null);
    setStalled(false);
    setBitrate(null);
    setProgress({ time: startAt, duration: song.duration ?? 0, buffered: 0 });
    setOfflineSource(false);
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }

    // Downloaded: play the stored file. Works with no network, on every browser.
    if (isDownloaded(song.id)) {
      const url = await offlineObjectUrl(song.id);
      if (loadedId.current !== song.id) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (url) {
        objectUrl.current = url;
        setOfflineSource(true);
        audio.src = url;
        if (autoPlay) audio.play().catch(() => setPlaying(false));
        return;
      }
    }
    if (!navigator.onLine) {
      // Stop whatever was playing before; this song can't load without a network.
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      setPlaying(false);
      setError("Not downloaded. Connect to the internet to play this song.");
      return;
    }

    const quality = settingsStore.get().quality;
    const native = audio.canPlayType("application/vnd.apple.mpegurl") !== "";

    // Safari / iOS: native HLS (best background + lock-screen behaviour).
    if (native && isAppleWebKit()) {
      audio.src = quality === "saver" ? api.streamUrl(song.id, "48k") : api.streamUrl(song.id);
    } else {
      const mod = hlsModule.current ?? (hlsModule.current = await import("hls.js/light"));
      const HlsClass = mod.default;
      if (loadedId.current !== song.id) return; // user skipped while loading the module
      if (!HlsClass.isSupported()) {
        if (!native) {
          setError("This browser cannot play streaming audio.");
          return;
        }
        audio.src = api.streamUrl(song.id);
      } else {
        // If this song was pre-loaded, start on that variant so the cached segments are used.
        const pre = prefetched.current?.id === song.id ? VARIANTS.indexOf(prefetched.current.variant) : -1;
        const hls = new HlsClass(hlsConfig(quality, lastEstimate.current, pre >= 0 ? pre : undefined));
        hlsRef.current = hls;
        let networkRetries = 0;
        hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
          if (quality === "saver") hls.autoLevelCapping = 0;
        });
        hls.on(HlsClass.Events.LEVEL_SWITCHED, (_e, data) => {
          setBitrate(hls.levels[data.level]?.bitrate ?? null);
        });
        hls.on(HlsClass.Events.FRAG_LOADED, () => {
          networkRetries = 0;
          setStalled(false);
        });
        hls.on(HlsClass.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) {
            // Keep trying: slow networks recover. Back off up to 15s.
            setStalled(true);
            const delay = Math.min(15_000, 1000 * 2 ** networkRetries++);
            retryTimer.current = window.setTimeout(() => hls.startLoad(), delay);
          } else if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setError("Playback failed for this song.");
          }
        });
        hls.loadSource(api.streamUrl(song.id));
        hls.attachMedia(audio);
      }
    }
    if (autoPlay) audio.play().catch(() => setPlaying(false));
  }, []);

  /** Start playing queue[i]. */
  const startAt = useCallback(
    (q: Song[], i: number) => {
      setQueue(q);
      setIndex(i);
      if (q[i]) load(q[i], true);
    },
    [load],
  );

  /* ------------------------------ actions ----------------------------- */

  const play = useCallback(() => {
    const { current } = live.current;
    const audio = audioRef.current!;
    if (!current) return;
    if (loadedId.current !== current.id) {
      // Restored session: load lazily on first play to save data.
      load(current, true, sessionStore.get().time || 0);
      return;
    }
    audio.play().catch(() => {});
  }, [load]);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused || loadedId.current !== live.current.current?.id) play();
    else pause();
  }, [play, pause]);

  const appendRelated = useCallback(async () => {
    const { current, queue } = live.current;
    if (!current) return false;
    try {
      const { related } = await api.song(current.id);
      const seen = new Set(queue.map((s) => s.id));
      let fresh = related.filter((s) => !seen.has(s.id));
      if (!fresh.length) {
        const { items } = await api.songs({ sort: "popular", limit: 30 });
        fresh = shuffled(items.filter((s) => !seen.has(s.id))).slice(0, 10);
      }
      if (!fresh.length) return false;
      const nextQueue = [...queue, ...fresh];
      startAt(nextQueue, queue.length);
      return true;
    } catch {
      return false;
    }
  }, [startAt]);

  const next = useCallback(
    (fromEnded = false) => {
      const { queue, index, repeat, autoplay } = live.current;
      if (!queue.length) return;
      // Offline: skip ahead to the next song that is downloaded.
      if (!navigator.onLine) {
        const after = queue.findIndex((s, k) => k > index && isDownloaded(s.id));
        const wrap = repeat === "all" ? queue.findIndex((s) => isDownloaded(s.id)) : -1;
        const j = after >= 0 ? after : wrap;
        if (j >= 0) return startAt(queue, j);
        return;
      }
      if (index + 1 < queue.length) return startAt(queue, index + 1);
      if (repeat === "all") return startAt(queue, 0);
      if (autoplay && fromEnded) {
        appendRelated();
        return;
      }
      if (!fromEnded) startAt(queue, 0);
    },
    [startAt, appendRelated],
  );

  const prev = useCallback(() => {
    const a = audioRef.current!;
    const { queue, index } = live.current;
    if (a.currentTime > 3 || index === 0) {
      a.currentTime = 0;
      return;
    }
    startAt(queue, index - 1);
  }, [startAt]);

  const seek = useCallback((t: number) => {
    const a = audioRef.current!;
    const d = progressStore.get().duration || a.duration || 0;
    const clamped = Math.max(0, Math.min(d ? d - 0.25 : t, t));
    if (loadedId.current !== live.current.current?.id) {
      sessionStore.set((s) => ({ ...s, time: clamped }));
      setProgress({ time: clamped });
      return;
    }
    a.currentTime = clamped;
    listened.current.lastTime = clamped;
    setProgress({ time: clamped });
  }, []);

  const actions: PlayerActions = useMemo(
    () => ({
      playList(songs, i = 0) {
        if (!songs.length) return;
        unshuffledRef.current = null;
        setShuffle(false);
        startAt(songs, Math.max(0, Math.min(i, songs.length - 1)));
      },
      playSong(song) {
        const { queue, index } = live.current;
        const at = queue.findIndex((s) => s.id === song.id);
        if (at >= 0) return startAt(queue, at);
        const q = [...queue.slice(0, index + 1), song, ...queue.slice(index + 1)];
        startAt(q, queue.length ? index + 1 : 0);
      },
      playNext(song) {
        const { queue: q, index } = live.current;
        if (!q.length) return startAt([song], 0);
        if (q[index]?.id === song.id) return;
        const rest = q.filter((s, i) => i <= index || s.id !== song.id);
        setQueue([...rest.slice(0, index + 1), song, ...rest.slice(index + 1)]);
      },
      addToQueue(song) {
        const { queue: q } = live.current;
        if (!q.length) return startAt([song], 0);
        if (!q.some((s) => s.id === song.id)) setQueue([...q, song]);
      },
      removeAt(i) {
        const { queue, index } = live.current;
        if (i === index) {
          const q = queue.filter((_, k) => k !== i);
          if (!q.length) {
            audioRef.current?.pause();
            destroyEngine();
            loadedId.current = null;
            setQueue([]);
            setIndex(0);
            return;
          }
          startAt(q, Math.min(i, q.length - 1));
          return;
        }
        setQueue(queue.filter((_, k) => k !== i));
        if (i < index) setIndex(index - 1);
      },
      moveInQueue(from, to) {
        const { queue, index } = live.current;
        if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
        const q = queue.slice();
        const [item] = q.splice(from, 1);
        q.splice(to, 0, item);
        setQueue(q);
        const cur = queue[index];
        setIndex(q.indexOf(cur));
      },
      clearUpcoming() {
        const { queue, index } = live.current;
        setQueue(queue.slice(0, index + 1));
      },
      jumpTo(i) {
        startAt(live.current.queue, i);
      },
      toggle,
      play,
      pause,
      next: () => next(false),
      prev,
      seek,
      seekBy(delta) {
        seek((audioRef.current?.currentTime ?? 0) + delta);
      },
      setVolume(v) {
        settingsStore.set((s) => ({ ...s, volume: Math.max(0, Math.min(1, v)), muted: false }));
      },
      toggleMute() {
        settingsStore.set((s) => ({ ...s, muted: !s.muted }));
      },
      toggleShuffle() {
        const { queue, index } = live.current;
        if (!unshuffledRef.current) {
          unshuffledRef.current = queue;
          setQueue([...queue.slice(0, index + 1), ...shuffled(queue.slice(index + 1))]);
          setShuffle(true);
        } else {
          const cur = queue[index];
          const ids = new Set(queue.map((q) => q.id));
          const orig = unshuffledRef.current.filter((s) => ids.has(s.id));
          setQueue(orig);
          setIndex(Math.max(0, orig.findIndex((s) => s.id === cur?.id)));
          unshuffledRef.current = null;
          setShuffle(false);
        }
      },
      cycleRepeat() {
        setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));
      },
      setAutoplay,
      setQuality(q) {
        settingsStore.set((s) => ({ ...s, quality: q }));
        // Re-attach the stream at the same position with the new setting.
        const { current } = live.current;
        const a = audioRef.current;
        if (current && a && loadedId.current === current.id) {
          const wasPlaying = !a.paused;
          load(current, wasPlaying, a.currentTime);
        }
      },
      setSleep(m) {
        if (m === "off") setSleepState({ mode: "off" });
        else if (m === "end") setSleepState({ mode: "end" });
        else setSleepState({ mode: "time", endsAt: Date.now() + m * 60_000 });
      },
    }),
    [startAt, load, toggle, play, pause, next, prev, seek],
  );

  /* --------------------------- audio events --------------------------- */

  useEffect(() => {
    const a = audioRef.current!;
    let lastSave = 0;
    const onTime = () => {
      const t = a.currentTime;
      setProgress({ time: t });
      // Count real listening time (ignore seeks) for play stats.
      const l = listened.current;
      const delta = t - l.lastTime;
      if (delta > 0 && delta < 2) l.seconds += delta;
      l.lastTime = t;
      const d = a.duration || progressStore.get().duration;
      if (!l.reported && l.id && l.seconds >= Math.min(30, (d || 60) / 2)) {
        l.reported = true;
        api.reportPlay(l.id).catch(() => {});
        pushHistory(l.id);
      }
      const now = Date.now();
      if (now - lastSave > 4000) {
        lastSave = now;
        sessionStore.set((s) => ({ ...s, time: t }));
        if ("mediaSession" in navigator && d && isFinite(d)) {
          try {
            navigator.mediaSession.setPositionState({ duration: d, position: Math.min(t, d), playbackRate: a.playbackRate });
          } catch {
            /* ignore */
          }
        }
      }
    };
    const onDuration = () => isFinite(a.duration) && setProgress({ duration: a.duration });
    const onProgress = () => {
      const b = a.buffered;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= a.currentTime + 0.5 && b.end(i) >= a.currentTime) {
          setProgress({ buffered: b.end(i) });
          return;
        }
      }
    };
    const onMeta = () => {
      if (pendingSeek.current != null) {
        a.currentTime = pendingSeek.current;
        pendingSeek.current = null;
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => {
      setBuffering(false);
      setStalled(false);
    };
    const onEnded = () => {
      const { repeat, sleep } = live.current;
      if (sleep.mode === "end") {
        setSleepState({ mode: "off" });
        return;
      }
      if (repeat === "one") {
        a.currentTime = 0;
        a.play().catch(() => {});
        return;
      }
      next(true);
    };
    const onError = () => {
      if (!hlsRef.current && a.error && loadedId.current) setError("Couldn't load this song. Check your connection.");
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("durationchange", onDuration);
    a.addEventListener("progress", onProgress);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("playing", onPlaying);
    a.addEventListener("canplay", onPlaying);
    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("durationchange", onDuration);
      a.removeEventListener("progress", onProgress);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("playing", onPlaying);
      a.removeEventListener("canplay", onPlaying);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
    };
  }, [next]);

  /* ------------------------- volume / settings ------------------------ */

  const settings = settingsStore.use();
  useEffect(() => {
    const a = audioRef.current!;
    a.volume = settings.volume;
    a.muted = settings.muted;
  }, [settings.volume, settings.muted]);

  useEffect(() => {
    // First visit on a slow / data-saver connection → default to saver.
    if (!localStorage.getItem("mpc.settings")) {
      const q = suggestedQuality();
      if (q) settingsStore.set((s) => ({ ...s, quality: q }));
    }
  }, []);

  /* ------------------- resume when the network returns ---------------- */

  useEffect(() => {
    const onOnline = () => {
      if (hlsRef.current) hlsRef.current.startLoad();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  /* --------------------------- sleep timer ---------------------------- */

  useEffect(() => {
    if (sleep.mode !== "time") return;
    const t = window.setInterval(() => {
      if (Date.now() >= sleep.endsAt) {
        audioRef.current?.pause();
        setSleepState({ mode: "off" });
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [sleep]);

  /* ------------------------ session persistence ----------------------- */

  useEffect(() => {
    const s = sessionStore.get();
    if (!s.ids.length) return;
    // Offline (or server unreachable): rebuild the queue from downloaded songs.
    const fromDownloads = () => {
      const d = downloadsStore.get();
      return { items: s.ids.map((id) => d[id]?.song).filter((x): x is Song => !!x) };
    };
    (navigator.onLine ? api.songsByIds(s.ids).catch(fromDownloads) : Promise.resolve(fromDownloads()))
      .then(({ items }) => {
        if (!items.length || live.current.queue.length) return;
        const cur = s.ids[s.index];
        const i = Math.max(0, items.findIndex((x) => x.id === cur));
        setQueue(items);
        setIndex(i);
        setProgress({ time: items[i].id === cur ? s.time : 0, duration: items[i].duration ?? 0 });
        if (items[i].id !== cur) sessionStore.set((x) => ({ ...x, time: 0 }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!queue.length) return;
    sessionStore.set((s) => ({
      ids: queue.slice(0, 200).map((q) => q.id),
      index,
      time: s.ids[s.index] === queue[index]?.id ? s.time : 0,
    }));
  }, [queue, index]);

  /* ---------------- pre-load the next song (HTTP cache) ----------------- */

  useEffect(() => {
    const prefetchNext = async (forId: string, next: Song, variant: (typeof VARIANTS)[number], signal: AbortSignal) => {
      const get = (u: string) => fetch(u, { signal, credentials: "include" });
      await (await get(api.streamUrl(next.id))).text();
      const playlistUrl = api.streamUrl(next.id, variant);
      const text = await (await get(playlistUrl)).text();
      const uris = [
        text.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1],
        ...text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")),
      ].filter((u): u is string => !!u);
      // One at a time so it never competes with the song that is playing.
      for (const u of uris) {
        const r = await get(new URL(u, new URL(playlistUrl, location.href)).href);
        await r.arrayBuffer();
      }
      if (loadedId.current === forId) prefetched.current = { id: next.id, variant };
    };

    const unsubscribe = progressStore.subscribe(() => {
      const { buffered, duration } = progressStore.get();
      const hls = hlsRef.current;
      const { queue, index, current } = live.current;
      if (!hls || !current || !duration || buffered < duration - 2) return;
      if (prefetchCtl.current?.forId === current.id) return; // already started for this song
      const next = queue[index + 1];
      if (!next || isDownloaded(next.id) || !navigator.onLine || saveData()) return;
      const variant = variantForBitrate(hls.levels[hls.currentLevel]?.bitrate) ?? "48k";
      prefetchCtl.current?.ctl.abort();
      const ctl = new AbortController();
      prefetchCtl.current = { forId: current.id, ctl };
      prefetchNext(current.id, next, variant, ctl.signal).catch(() => {});
    });
    return () => {
      unsubscribe();
    };
  }, []);

  /* --------------------------- media session -------------------------- */

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (!current) {
      ms.metadata = null;
      return;
    }
    ms.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artists.map((a) => a.name).join(", "),
      album: current.album?.title ?? "",
      artwork: current.cover
        ? [
            { src: absUrl(current.cover.sm), sizes: "160x160", type: "image/jpeg" },
            { src: absUrl(current.cover.lg), sizes: "600x600", type: "image/jpeg" },
          ]
        : [],
    });
    document.title = `${current.title} · ${current.artist.name}`;
  }, [current]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => actions.play()],
      ["pause", () => actions.pause()],
      ["previoustrack", () => actions.prev()],
      ["nexttrack", () => actions.next()],
      ["seekbackward", (d) => actions.seekBy(-(d.seekOffset ?? 10))],
      ["seekforward", (d) => actions.seekBy(d.seekOffset ?? 10)],
      ["seekto", (d) => d.seekTime != null && actions.seek(d.seekTime)],
    ];
    for (const [action, h] of handlers) {
      try {
        ms.setActionHandler(action, h);
      } catch {
        /* unsupported action */
      }
    }
  }, [actions]);

  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  /* ------------------------ keyboard shortcuts ------------------------ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " && !el.closest("button, a")) {
        e.preventDefault();
        actions.toggle();
      } else if (e.key === "ArrowRight" && e.shiftKey) actions.next();
      else if (e.key === "ArrowLeft" && e.shiftKey) actions.prev();
      else if (e.key === "ArrowRight") actions.seekBy(10);
      else if (e.key === "ArrowLeft") actions.seekBy(-10);
      else if (e.key === "m") actions.toggleMute();
      else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);

  useEffect(() => () => destroyEngine(), []);

  const value = useMemo(
    () => ({
      queue,
      index,
      current,
      playing,
      buffering,
      stalled,
      error,
      shuffle,
      repeat,
      autoplay,
      sleep,
      bitrate,
      offlineSource,
      ...actions,
    }),
    [queue, index, current, playing, buffering, stalled, error, shuffle, repeat, autoplay, sleep, bitrate, offlineSource, actions],
  );

  return (
    <PlayerCtx.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="none" playsInline />
    </PlayerCtx.Provider>
  );
}
