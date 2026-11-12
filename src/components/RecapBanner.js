'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { bannerYear, bannerDismissKey, recapPath } from '../lib/recap'
import { trackRecapEvent } from '../lib/recapTracking'

// Dashboard promo for the season recap. Shown in the off-season window only; "Dismiss" hides it for that year.
export default function RecapBanner() {
  const [year, setYear] = useState(null)

  useEffect(() => {
    const y = bannerYear()
    if (!y) return
    try {
      if (window.localStorage.getItem(bannerDismissKey(y))) return
    } catch {}
    setYear(y)
  }, [])

  if (!year) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(bannerDismissKey(year), '1')
    } catch {}
    setYear(null)
  }

  return (
    <section aria-label="Season recap" className="rounded-2xl border border-emerald-300 dark:border-brand-neon/40 bg-gradient-to-r from-slate-950 to-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-black uppercase tracking-wide text-white">Your {year} season recap is ready</h2>
        <p className="text-xs text-slate-300">Distance, climbing, streaks and PBs in swipeable cards. Private until you share it.</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Link href={recapPath(year)} onClick={() => trackRecapEvent('recap_cta_click', { year, surface: 'banner' })} className="rounded-lg bg-brand-neon px-3 py-2 text-xs font-black text-slate-900">
          See my recap
        </Link>
        <button type="button" onClick={dismiss} className="text-xs underline text-slate-300">Dismiss</button>
      </div>
    </section>
  )
}
