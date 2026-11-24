# Media Player Classic

A web music streaming app that works on phones and desktops and keeps playing on slow connections.

- **Web app** (`/`): React + Vite. Responsive layout, installable as an app (PWA), lock-screen controls.
- **API** (`/server`): Node + Fastify + MongoDB. Converts uploads to adaptive streams, provides search, and handles admin.
- **Storage**: local disk, AWS S3, Cloudflare R2, or any S3-compatible store (MinIO, Backblaze B2, Wasabi…).

## Quick start (development)

Requirements: Node 22+, MongoDB 7+ running locally (or a MongoDB Atlas URI). ffmpeg is bundled via npm.

```bash
npm install
npm --prefix server install
cp server/.env.example server/.env    # edit JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD

npm run dev:server   # API on http://localhost:3000
npm run dev          # web app on http://localhost:5173 (proxies /api and /media to the API)
```

Open http://localhost:5173/admin and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` to upload music.

## Features

**Listening**
- Adaptive streaming (HLS): every song is converted to 48 / 96 / 160 kbps. Playback starts on the lowest bitrate so it begins quickly, then moves up when the network allows.
- Buffers about a minute ahead, retries automatically with back-off on weak networks, and resumes when the connection returns.
- Quality setting: Auto, Data saver (always 48 kbps, about 22 MB per hour) or High. Devices with data saver turned on, or on a 2G connection, default to Data saver.
- Queue: play next, add to queue, drag to reorder, shuffle, repeat one or all. When the queue ends, similar songs keep playing (can be turned off).
- Sleep timer, lyrics, liked songs, recently played, share links.
- Lock-screen and headphone controls (Media Session API); background playback on iOS.
- Restores your queue and position after a reload without downloading anything until you press play.
- Keyboard: `Space` play/pause, `←/→` seek 10 s, `Shift+←/→` previous/next, `M` mute, `/` search.

**Search** (finds likely matches, not only exact ones)
- Instant suggestions as you type, then full results for songs, artists and albums.
- All of these find "Lux Papa": `lux papa`, `luxpapa`, `lucks papa`, `lax papa`, `lux paapaa`, `papa lux`, `lux pappa`, `luks`, `lux papa song`.
- Spelling variants in transliterated names: `punnakai`, `punagai` and `ponnagai` all find "Punnagai"; `elumalai` finds "Ezhumalai".
- Searches titles, artists, albums, album artists or composers, genres, artist initials (`spb`, `arr`) and lyrics (`soup song flop song`).
- Extra or unknown words don't hide results (`un punnagai arjun 2002`). Filler words like "song", "mp3" and "tamil" are ignored.
- Ranking: title > artist > album > composer > genre > lyrics, and exact > starts with > sounds alike > contains > typo, plus popularity. When nothing matches exactly, the page says it's showing the closest results.
- Runs on plain MongoDB, about 20–60 ms over 5,000 songs. For hundreds of thousands of songs, consider MongoDB Atlas Search.

**Admin** (`/admin`)
- Drag and drop many files or whole folders, with per-file progress and two uploads in parallel.
- Reads tags automatically: title, artists, album, album artist, track number, year, genre, lyrics and cover art.
- Removes download-site watermarks from tags ("Song - MassTamilan.com" becomes "Song").
- Splits multiple artists ("A, B feat. C") so each artist gets their own page.
- Song table with filtering, sorting and paging; edit a song's details, cover and lyrics; bulk-edit artist, album, genre or year across many songs; bulk delete; re-process audio.
- Library stats and live processing status.

## Streaming design

```
upload ──► store original ──► ffmpeg ──► fMP4 HLS (48k / 96k / 160k, 6 s segments) ──► storage
                                                                                          │
player ──► /api/stream/:id/master.m3u8 ──► /api/stream/:id/<bitrate>/index.m3u8 ──────────┘
           (from the API, a few KB)       (rewritten so segment URLs point straight
                                           at storage: CDN, signed S3/R2 URL, or /media)
```

- Segments are immutable and cached for a year. Every re-process writes to a new folder, so caches never serve stale audio.
- With S3 or R2, audio bytes never pass through the API server, so it stays cheap to run.
- Original uploads are kept, but they are never served to listeners.

## Storage options (`server/.env`)

| Store | Settings |
|---|---|
| Local disk | `STORAGE_DRIVER=local` (files go to `DATA_DIR/media`) |
| AWS S3 | `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`, keys |
| Cloudflare R2 | `STORAGE_DRIVER=s3`, `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `S3_REGION=auto`, keys. Set `S3_PUBLIC_BASE_URL` to the bucket's public/custom domain to serve through Cloudflare's CDN (free egress). |
| MinIO / B2 / Wasabi | `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE=true` (MinIO) |

Without `S3_PUBLIC_BASE_URL` the bucket can stay private: the API generates signed URLs that last 6 hours.

## Bulk import from a folder on the server

Faster than uploading through the browser for large libraries:

```bash
cd server
npm run import -- /path/to/music --album "Optional album" --genre "Optional genre"
```

## Production

```bash
cp server/.env.example .env        # set JWT_SECRET, ADMIN_*, storage settings
docker compose up -d --build       # app on :3000 (serves the web app + API) + MongoDB
```

Or without Docker: `npm run build`, then `npm --prefix server run build` and `npm start`. The API serves the built web app from `/dist`.

Put a CDN or reverse proxy (Cloudflare, nginx) in front for HTTPS.

## API (for the future mobile app)

All endpoints return JSON. Admin endpoints accept the login cookie or `Authorization: Bearer <token>` (the token is returned by `/api/auth/login`).

| Method | Path | |
|---|---|---|
| GET | `/api/home` | new releases, trending, artists, albums, genres |
| GET | `/api/songs?sort=new\|popular\|title&genre=&limit=&offset=` | |
| GET | `/api/songs/batch?ids=a,b,c` | |
| GET | `/api/songs/:id` | song, lyrics, related songs |
| POST | `/api/songs/:id/play` | count a play |
| GET | `/api/artists`, `/api/artists/:id` | |
| GET | `/api/albums`, `/api/albums/:id` | |
| GET | `/api/genres` | |
| GET | `/api/search?q=` / `/api/search/suggest?q=` | |
| GET | `/api/stream/:id/master.m3u8` | adaptive HLS (plays natively on iOS AVPlayer and Android ExoPlayer/Media3) |
| POST | `/api/auth/login` · `/api/auth/logout` · GET `/api/auth/me` | |
| GET | `/api/admin/stats`, `/api/admin/songs` | admin |
| POST | `/api/admin/upload` (multipart) | admin |
| PATCH | `/api/admin/songs/:id` | admin |
| POST | `/api/admin/songs/bulk-update` · `bulk-delete` · `:id/cover` · `:id/retranscode` | admin |

Set `VITE_API_URL` when building the web app if the API runs on a different domain (also add that domain to `CORS_ORIGINS`).
