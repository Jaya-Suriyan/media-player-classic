import React, { useEffect, useRef, useState } from 'react'
import { MOCK_SONGS, Song } from '../data/mockSongs'

export default function AudioPlayer(){
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [queue] = useState<Song[]>(MOCK_SONGS)
  const [index,setIndex] = useState(0)
  const [playing,setPlaying] = useState(false)
  const [progress,setProgress] = useState(0)
  const [volume,setVolume] = useState(0.9)
  const [lowLatency,setLowLatency] = useState(false)
  const [useWebAudio, setUseWebAudio] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)

  useEffect(()=>{
    if(audioRef.current) audioRef.current.volume = volume
  },[volume])

  useEffect(()=>{
    const a = audioRef.current
    if(!a) return
    const onTime = ()=>{
      if(a.duration) setProgress((a.currentTime / a.duration)*100)
    }
    a.addEventListener('timeupdate', onTime)
    return ()=> a.removeEventListener('timeupdate', onTime)
  },[])

  useEffect(()=>{
    return ()=>{
      audioContextRef.current?.close()
    }
  },[])

  const play = async () =>{
    const song = queue[index]
    if(!song) return
    if(useWebAudio){
      try{
        const ctx = audioContextRef.current ?? new AudioContext()
        audioContextRef.current = ctx
        const resp = await fetch(song.url)
        const ab = await resp.arrayBuffer()
        const decoded = await ctx.decodeAudioData(ab)
        sourceRef.current?.stop()
        const node = ctx.createBufferSource()
        node.buffer = decoded
        node.connect(ctx.destination)
        node.start()
        sourceRef.current = node
        setPlaying(true)
      }catch(e){
        console.error('WebAudio playback failed, falling back',e)
        setUseWebAudio(false)
        audioRef.current!.src = song.url
        audioRef.current!.play()
      }
    } else {
      audioRef.current!.src = song.url
      await audioRef.current!.play()
      setPlaying(true)
    }
  }

  const toggle = ()=>{
    if(playing){
      if(useWebAudio){
        sourceRef.current?.stop()
        setPlaying(false)
      } else {
        audioRef.current?.pause()
        setPlaying(false)
      }
    } else {
      play()
    }
  }

  const next = ()=>{
    setIndex(i=>{
      const ni = (i+1) % queue.length
      if(!useWebAudio && audioRef.current) audioRef.current.src = ''
      return ni
    })
    setTimeout(()=>play(), 50)
  }

  useEffect(()=>{ // auto-play when index changes if currently playing
    if(playing) play()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[index])

  return (
    <div className="card" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
      <div style={{display:'flex',gap:12,alignItems:'center'}}>
        <div style={{width:56,height:56,background:'#111',borderRadius:8}} />
        <div>
          <div style={{fontWeight:700}}>{queue[index].title}</div>
          <div className="small">{queue[index].artist} • {queue[index].album}</div>
        </div>
      </div>

      <div style={{flex:1,marginLeft:18,marginRight:18}}>
        <div className="controls" style={{justifyContent:'center'}}>
          <button className="btn" onClick={()=>setIndex(i=> (i-1+queue.length)%queue.length)}>⏮</button>
          <button className="btn" onClick={toggle}>{playing? '⏸':'▶'}</button>
          <button className="btn" onClick={next}>⏭</button>
          <div style={{width:220,marginLeft:12}}>
            <div className="progress"><i style={{width:`${progress}%`}}/></div>
            <div className="small" style={{textAlign:'right'}}>{Math.round(progress)}%</div>
          </div>
        </div>
      </div>

      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <label className="small">Low-latency</label>
        <input type="checkbox" checked={useWebAudio} onChange={(e)=>setUseWebAudio(e.target.checked)} />
        <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e)=>setVolume(Number(e.target.value))} />
      </div>

      <audio ref={audioRef} preload={lowLatency? 'auto':'metadata'} style={{display:'none'}}/>
    </div>
  )
}
