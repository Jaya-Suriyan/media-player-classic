import React, { useState } from 'react'
import { MOCK_SONGS } from '../data/mockSongs'
import { Link } from 'react-router-dom'

export default function Search(){
  const [q,setQ] = useState('')
  const results = MOCK_SONGS.filter(s=> s.title.toLowerCase().includes(q.toLowerCase()) || s.artist.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <h2>Search</h2>
      <input placeholder="Search songs or artists" value={q} onChange={e=>setQ(e.target.value)} style={{width:'100%',padding:8}} />
      <div style={{marginTop:12}}>
        {results.map(r=> (
          <div key={r.id} className="song">
            <div style={{flex:1}}>
              <div style={{fontWeight:700}}>{r.title}</div>
              <div className="small">{r.artist}</div>
            </div>
            <div><Link to={`/song/${r.id}`}>Details</Link></div>
          </div>
        ))}
      </div>
    </div>
  )
}
