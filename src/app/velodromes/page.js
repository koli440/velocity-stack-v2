'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import VelodromesView from '../../components/VelodromesView'

export default function VelodromesPage() {
  const [tracks, setTracks] = useState([])
  const [loading, setLoading] = useState(true)

  const reloadTracks = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('tracks')
      .select('*')
      .order('name', { ascending: true })

    if (!error && data) {
      setTracks(data)
    }
    setLoading(false)
  }

  useEffect(() => {
    reloadTracks()
  }, [])

  if (loading) {
    return (
      <div className="py-24 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
        Loading Velodromes Directory...
      </div>
    )
  }

  return (
    <div className="w-full">
      <VelodromesView tracks={tracks} onRefreshTracks={reloadTracks} />
    </div>
  )
}