export type Song = {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album: string;
  albumId?: string;
  duration?: number;
  cover?: string;
  url: string;
};

export const MOCK_SONGS: Song[] = [
  {
    id: "1",
    title: "Lux-Papa",
    artist: "Arjun",
    artistId: "arjun",
    album: "Elumalai",
    albumId: "elumalai",
    duration: 254,
    cover: "http://localhost:5173/cover/ezhumalai-2002.webp",
    url: "http://localhost:5173/songs/Lux-Papa.mp3",
  },
  {
    id: "2",
    title: "Un-Punnagai",
    artist: "Arjun",
    artistId: "arjun",
    album: "Elumalai",
    albumId: "elumalai",
    duration: 254,
    cover: "http://localhost:5173/cover/ezhumalai-2002.webp",
    url: "http://localhost:5173/songs/Un-Punnagai.mp3",
  },
];
