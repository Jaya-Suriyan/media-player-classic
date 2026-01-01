import React from 'react'
import { useParams } from 'react-router-dom'

export default function Album(){
  const { id } = useParams()
  return (
    <div>
      <h2>Album {id}</h2>
      <p className="small">Album page placeholder. Backend integration will list tracks here.</p>
    </div>
  )
}
