'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { parseRecapYear, buildRecapCards } from '../../../lib/recap'
import { trackRecapEvent } from '../../../lib/recapTracking'
import RecapStory from '../../../components/RecapStory'
import RecapShare from '../../../components/RecapShare'

// The signed-in rider's own season recap (the app shell redirects signed-out visitors to /login).
export default function RecapPage() {
  const year = parseRecapYear(useParams().year)
  const [recap, setRecap] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!year) return undefined
    let live = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      const [{ data, error: err }, { data: p }] = await Promise.all([
        supabase.rpc('season_recap', { p_year: year }),
        supabase.from('profiles').select('nickname, first_name').eq('id', session.user.id).maybeSingle(),
      ])
      if (!live) return
      if (err || !data) return setError('Could not load your recap.')
      setName((p?.nickname || p?.first_name || '').trim())
      setRecap(data)
      trackRecapEvent('recap_view', { year, surface: 'own' })
    })()
    return () => { live = false }
  }, [year])

  const cards = useMemo(() => buildRecapCards(recap, { name }), [recap, name])

  if (!year) return <p className="text-sm text-slate-500">No recap for that year. <Link href="/" className="underline">Back to dashboard</Link></p>
  if (error) return <p role="alert" className="text-sm text-red-500">{error}</p>
  if (!recap) return <p className="text-sm text-slate-500">Building your {year} recap…</p>

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-slate-900 dark:text-white text-center">Your {year} season recap</h1>
      <RecapStory cards={cards}>
        <RecapShare year={year} recap={recap} name={name} />
      </RecapStory>
    </div>
  )
}
