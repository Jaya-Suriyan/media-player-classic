export type Song = {
  id: string
  title: string
  artist: string
  album: string
  duration?: number
  url: string
}

export const MOCK_SONGS: Song[] = [
  {
    id: '1',
    title: 'SoundHelix Song 1',
    artist: 'SoundHelix',
    album: 'Examples',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
  },
  {
    id: '2',
    title: 'SoundHelix Song 2',
    artist: 'SoundHelix',
    album: 'Examples',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3'
  }
]
