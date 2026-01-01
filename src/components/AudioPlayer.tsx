import React, { useEffect, useRef, useState } from "react";
import { MOCK_SONGS, Song } from "../data/mockSongs";

export default function AudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<Song[]>(MOCK_SONGS);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [bufferPercent, setBufferPercent] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [lowLatency, setLowLatency] = useState(false);
  const [useWebAudio, setUseWebAudio] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isDraggingRef = useRef(false);
  const mediaSourceRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const sourceBufferRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      if (a.duration) {
        setDurationSec(a.duration);
        setCurrentTime(a.currentTime);
        setProgress((a.currentTime / a.duration) * 100);
      }
    };
    const onMeta = () => {
      if (a.duration) setDurationSec(a.duration);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
    };
  }, []);

  useEffect(() => {
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  const formatTime = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60)
      .toString()
      .padStart(2, "0");
    return `${m}:${sec}`;
  };

  const seekTo = (ratio: number) => {
    if (useWebAudio) return; // seeking unsupported for WebAudio here
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const t = Math.max(0, Math.min(1, ratio)) * a.duration;
    a.currentTime = t;
    setCurrentTime(t);
    setProgress((t / a.duration) * 100);
  };

  const handleProgressPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLDivElement;
    isDraggingRef.current = true;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      seekTo(x / rect.width);
    };
    const onUp = (ev: PointerEvent) => {
      isDraggingRef.current = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLDivElement;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    seekTo(x / rect.width);
  };

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    const songHandler = (e: any) => {
      const id = e?.detail?.id;
      if (!id) return;
      const i = queue.findIndex((s) => s.id === id);
      if (i >= 0) {
        setIndex(i);
        // small delay to ensure index is applied
        setTimeout(() => play(), 50);
      }
    };

    const albumHandler = (e: any) => {
      const albumId = e?.detail?.albumId;
      if (!albumId) return;
      const startId = e?.detail?.startId;
      const songs = MOCK_SONGS.filter((s) => s.albumId === albumId);
      if (songs.length) {
        setQueue(songs);
        const startIndex = startId
          ? songs.findIndex((s) => s.id === startId)
          : 0;
        setIndex(startIndex >= 0 ? startIndex : 0);
        setTimeout(() => play(), 50);
      }
    };

    const artistHandler = (e: any) => {
      const artistId = e?.detail?.artistId;
      if (!artistId) return;
      const songs = MOCK_SONGS.filter((s) => s.artistId === artistId);
      if (songs.length) {
        setQueue(songs);
        setIndex(0);
        setTimeout(() => play(), 50);
      }
    };

    window.addEventListener("play-song", songHandler as EventListener);
    window.addEventListener("play-album", albumHandler as EventListener);
    window.addEventListener("play-artist", artistHandler as EventListener);
    return () => {
      window.removeEventListener("play-song", songHandler as EventListener);
      window.removeEventListener("play-album", albumHandler as EventListener);
      window.removeEventListener("play-artist", artistHandler as EventListener);
    };
  }, [queue]);

  const cleanupMediaSource = () => {
    try {
      abortControllerRef.current?.abort();
    } catch {}
    try {
      readerRef.current?.cancel?.();
    } catch {}
    try {
      if (sourceBufferRef.current && mediaSourceRef.current) {
        if (!sourceBufferRef.current.updating)
          mediaSourceRef.current.endOfStream();
      }
    } catch {}
    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    readerRef.current = null;
    abortControllerRef.current = null;
  };

  const playWithMediaSource = async (url: string) => {
    cleanupMediaSource();
    if (!("MediaSource" in window)) {
      // fallback to normal audio
      audioRef.current!.src = url;
      await audioRef.current!.play();
      setPlaying(true);
      return;
    }

    try {
      const ms = new (window as any).MediaSource();
      mediaSourceRef.current = ms;
      const audioEl = audioRef.current!;
      audioEl.src = URL.createObjectURL(ms);
      abortControllerRef.current = new AbortController();

      ms.addEventListener("sourceopen", async () => {
        try {
          // try common mime for mp3; may fail in some browsers
          const mime = "audio/mpeg";
          const sb = (ms as any).addSourceBuffer(mime);
          sourceBufferRef.current = sb;

          const res = await fetch(url, {
            signal: abortControllerRef.current!.signal,
          });
          const reader = res.body!.getReader();
          readerRef.current = reader;

          const pump = async () => {
            const { value, done } = await reader.read();
            if (done) {
              try {
                ms.endOfStream();
              } catch {}
              return;
            }
            // append when buffer not updating
            const appendChunk = async (chunk: Uint8Array) => {
              if (!sb) return;
              const tryAppend = () => {
                try {
                  sb.appendBuffer(chunk);
                } catch (e) {
                  // wait for updateend then retry
                  return new Promise<void>((resolve) =>
                    sb.addEventListener(
                      "updateend",
                      () => {
                        try {
                          sb.appendBuffer(chunk);
                        } catch {}
                        resolve();
                      },
                      { once: true }
                    )
                  );
                }
                return Promise.resolve();
              };
              await tryAppend();
            };
            await appendChunk(value);

            // if we have some buffered range and playback not started, start when >0.8s buffered
            if (!playing && audioEl.buffered && audioEl.buffered.length) {
              const b = audioEl.buffered.end(audioEl.buffered.length - 1);
              if (b > 0.8) {
                try {
                  await audioEl.play();
                  setPlaying(true);
                } catch (e) {}
              }
            }

            // update buffer pct if duration known
            if (
              audioEl.duration &&
              audioEl.buffered &&
              audioEl.buffered.length
            ) {
              const end = audioEl.buffered.end(audioEl.buffered.length - 1);
              setBufferPercent(Math.min(100, (end / audioEl.duration) * 100));
            }

            // continue
            setTimeout(() => pump(), 0);
          };
          pump();
        } catch (err) {
          console.error(
            "MediaSource streaming failed, fallback to normal",
            err
          );
          try {
            audioRef.current!.src = url;
            await audioRef.current!.play();
            setPlaying(true);
          } catch (e) {}
        }
      });
    } catch (e) {
      console.error("playWithMediaSource error", e);
      try {
        audioRef.current!.src = url;
        await audioRef.current!.play();
        setPlaying(true);
      } catch (e) {}
    }
  };

  const play = async () => {
    const song = queue[index];
    if (!song) return;
    // if lowLatency mode requested and using audio element playback, try MSE streaming
    if (lowLatency && !useWebAudio) {
      await playWithMediaSource(song.url);
      return;
    }

    // normal existing paths
    if (useWebAudio) {
      try {
        const ctx = audioContextRef.current ?? new AudioContext();
        audioContextRef.current = ctx;
        const resp = await fetch(song.url);
        const ab = await resp.arrayBuffer();
        const decoded = await ctx.decodeAudioData(ab);
        sourceRef.current?.stop();
        const node = ctx.createBufferSource();
        node.buffer = decoded;
        node.connect(ctx.destination);
        node.start();
        sourceRef.current = node;
        setPlaying(true);
      } catch (e) {
        console.error("WebAudio playback failed, falling back", e);
        setUseWebAudio(false);
        audioRef.current!.src = song.url;
        await audioRef.current!.play();
        setPlaying(true);
      }
    } else {
      // cleanup any previous MSE session
      cleanupMediaSource();
      audioRef.current!.src = song.url;
      await audioRef.current!.play();
      setPlaying(true);
    }
  };

  const toggle = () => {
    if (playing) {
      if (useWebAudio) {
        sourceRef.current?.stop();
        setPlaying(false);
      } else {
        audioRef.current?.pause();
        setPlaying(false);
      }
    } else {
      play();
    }
  };

  const next = () => {
    setIndex((i) => {
      const ni = (i + 1) % queue.length;
      if (!useWebAudio && audioRef.current) audioRef.current.src = "";
      return ni;
    });
    setTimeout(() => play(), 50);
  };

  useEffect(() => {
    // auto-play when index changes if currently playing
    if (playing) play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  return (
    <div className="player-inner">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          className="player-art"
          style={{
            borderRadius: 8,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundImage: `url(${queue[index].cover})`,
          }}
        />
        <div>
          <div style={{ fontWeight: 700 }}>{queue[index].title}</div>
          <div className="small">
            {queue[index].artist} • {queue[index].album}
          </div>
        </div>
      </div>

      <div className="player-controls">
        <div className="meta">
          <div className="player-btns">
            <button
              className="btn"
              onClick={() =>
                setIndex((i) => (i - 1 + queue.length) % queue.length)
              }
            >
              ⏮
            </button>
            <button className="btn" onClick={toggle}>
              {playing ? "⏸" : "▶"}
            </button>
            <button className="btn" onClick={next}>
              ⏭
            </button>
          </div>
          <div className="small">
            {formatTime(currentTime)} / {formatTime(durationSec)}
          </div>
        </div>
        <div
          className="progress"
          style={{ width: "100%", position: "relative" }}
          onClick={handleProgressClick}
          onPointerDown={handleProgressPointerDown}
          role="slider"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {" "}
          <div
            className="progress-buffer"
            style={{ width: `${bufferPercent}%` }}
          />{" "}
          <i style={{ width: `${progress}%` }} />
          <div className="progress-handle" style={{ left: `${progress}%` }} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn">♡</button>
        <button className="btn">⤓</button>
        <button
          className="btn"
          onClick={() => setLowLatency((l) => !l)}
          title={lowLatency ? "Disable low-latency" : "Enable low-latency"}
        >
          ⚡
        </button>
        <button
          className="btn"
          onClick={() => setMuted((m) => !m)}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>

      <audio
        ref={audioRef}
        preload={lowLatency ? "auto" : "metadata"}
        style={{ display: "none" }}
      />
    </div>
  );
}
