import React from 'react'
import { useParams } from 'react-router-dom'
import { MOCK_SONGS } from '../data/mockSongs'

export default function SongDetails(){
  const { id } = useParams()
  const song = MOCK_SONGS.find(s=> s.id === id)
  if(!song) return <div>Song not found</div>
  return (
    <div>
      <h2>{song.title}</h2>
      <div className="small">{song.artist} • {song.album}</div>
      <p style={{marginTop:12}}>Details page with metadata, lyrics and suggestions will go here.</p>
    </div>
  )
}
