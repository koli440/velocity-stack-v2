'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { trackRecapEvent, trackRecapCta } from '../lib/recapTracking'

// Last slide of a shared recap: converts visitors. Also records the (consent-gated) public view.
export default function PublicRecapCta({ year }) {
  useEffect(() => {
    trackRecapEvent('recap_view', { year, surface: 'public' })
  }, [year])
  return (
    <div className="space-y-4">
      <p className="text-xs font-black uppercase tracking-widest text-brand-neon">Your turn</p>
      <p className="text-3xl font-black">See your own season recap</p>
      <p className="text-slate-300">Import your rides in 2 minutes: connect Strava, Garmin, Wahoo or Intervals.icu and get your recap.</p>
      <Link
        href="/connections"
        onClick={() => trackRecapCta(year)}
        className="inline-block rounded-xl bg-brand-neon px-5 py-3 text-sm font-black text-slate-900"
      >
        Import your rides
      </Link>
    </div>
  )
}
