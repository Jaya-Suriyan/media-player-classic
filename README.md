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
- Buffers the whole song ahead (a song is only 2–6 MB), then pre-loads the next song in the queue, so dead zones don't interrupt playback and the next track starts instantly. Pre-loading is skipped when the device has data saver turned on.
- Retries automatically with back-off on weak networks, and resumes when the connection returns.
- **Offline downloads:** download songs, albums or all of an artist's songs. Each song is saved as a single file (48, 96 or 160 kbps, set in Library → Downloads) and plays with no internet on any browser, including iPhone. When offline, the app opens on your downloads, skips songs that aren't downloaded, and restores your queue from downloaded songs. The server builds the single file from existing stream segments without re-encoding (about 0.1 s), once per song and quality.
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

## Storage: 1 Local · 2 Cloudflare R2 · 3 Amazon S3

Choose in **Admin → Storage**. No config files to edit.

1. **Local:** files on this server's disk (`DATA_DIR/media`), streamed by the API. This is the default.
2. **Cloudflare R2:** enter Account ID, bucket, R2 API token (Object Read & Write) and optionally the bucket's public URL (r2.dev or a custom domain) to stream through Cloudflare's CDN with free bandwidth.
3. **Amazon S3:** region, bucket and access key, plus an optional CloudFront/public URL. Also works with S3-compatible services (Wasabi, Backblaze B2, MinIO) via the Endpoint field.

- **Test connection** uploads, reads, fetches (as the player would) and deletes a small test file, and reports each step.
- **Allow this site** adds the bucket CORS rule browsers need to stream from it. If the key isn't allowed to change bucket settings, the page explains where to add the rule by hand.
- Each song remembers where its files are, so storages can be mixed and the upload target can change at any time. The Upload page also has a **Save to** choice for each batch.
- **Move songs** copies a storage's songs to another one (original, streams, downloads, cover), switches them over and then deletes the old copies. Songs keep playing while they move.
- Without a public URL the bucket can stay private: the API hands out signed links (6 h).
- Secret keys are stored encrypted in MongoDB using `SETTINGS_SECRET` (falls back to `JWT_SECRET`) and are never sent back to the browser. **If you change that secret, re-enter the storage keys.**
- On first start, any `STORAGE_DRIVER=s3` + `S3_*` values in `.env` are imported automatically (an R2 endpoint becomes option 2).

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
