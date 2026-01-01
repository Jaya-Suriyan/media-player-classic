import React from 'react'
import { MOCK_SONGS } from '../data/mockSongs'
import { Link } from 'react-router-dom'

export default function Home(){
  return (
    <div>
      <h2>Recommended</h2>
      <div className="grid">
        {MOCK_SONGS.map(s=> (
          <div key={s.id} className="song card">
            <div style={{width:56,height:56,background:'#08101b',borderRadius:6}} />
            <div className="meta">
              <div style={{fontWeight:700}}>{s.title}</div>
              <div className="small">{s.artist}</div>
              <div className="small"><Link to={`/song/${s.id}`}>View</Link></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
