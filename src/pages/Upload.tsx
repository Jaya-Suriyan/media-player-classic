import React, { useState } from 'react'
import { Song } from '../data/mockSongs'

export default function Upload(){
  const [title,setTitle] = useState('')
  const [artist,setArtist] = useState('')
  const [url,setUrl] = useState('')
  const [saved,setSaved] = useState<Song | null>(null)

  const submit = (e:React.FormEvent)=>{
    e.preventDefault()
    const id = Date.now().toString()
    const song: Song = {id,title,artist,album:'Uploaded',url}
    localStorage.setItem('uploaded-'+id, JSON.stringify(song))
    setSaved(song)
    setTitle('');setArtist('');setUrl('')
  }

  return (
    <div>
      <h2>Upload Song</h2>
      <form className="upload-form" onSubmit={submit}>
        <input placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)} required />
        <input placeholder="Artist" value={artist} onChange={e=>setArtist(e.target.value)} required />
        <input placeholder="Direct URL to mp3" value={url} onChange={e=>setUrl(e.target.value)} required />
        <button type="submit">Upload</button>
      </form>
      {saved && <div className="card" style={{marginTop:12}}>Saved: {saved.title} — {saved.artist}</div>}
    </div>
  )
}
