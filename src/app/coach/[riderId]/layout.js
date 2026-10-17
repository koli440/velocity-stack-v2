'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { fetchAthleteProfile } from '../../../lib/coaching'
import { AthleteContext } from '../../../components/AthleteContext'
import { ATHLETE_PAGES, athletePath, bannerText, parseCoachPath } from '../../../lib/coachContext'

// Wraps every athlete page: verifies (via the database) that the viewer actively coaches the
// rider, shows the persistent "Coaching: <Name> - Exit" banner and the athlete tab bar.
export default function AthleteLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()
  const { riderId } = parseCoachPath(`/coach/${params?.riderId}`)
  const [athlete, setAthlete] = useState(null)
  const [state, setState] = useState('loading') // loading | ok | denied

  useEffect(() => {
    if (!riderId) return setState('denied')
    let cancelled = false
    setState('loading')
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return router.push('/login')
      if (session.user.id === riderId) return router.replace('/')
      const { athlete: a } = await fetchAthleteProfile(supabase, riderId)
      if (cancelled) return
      setAthlete(a)
      setState(a ? 'ok' : 'denied')
    })()
    return () => {
      cancelled = true
    }
  }, [riderId, router])

  const tabClass = (active) =>
    `px-3 py-1.5 rounded-xl text-xs font-bold transition ${
      active
        ? 'bg-indigo-600 text-white'
        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
    }`

  if (state === 'denied') {
    return (
      <div className="space-y-2" data-testid="coach-denied">
        <p className="text-sm text-slate-500">
          You are not coaching this rider (or the coaching relationship has ended).
        </p>
        <Link href="/coach" className="text-xs font-bold underline">
          Back to coach dashboard
        </Link>
      </div>
    )
  }

  return (
    <AthleteContext.Provider value={{ riderId, athlete }}>
      <div
        role="status"
        data-testid="coach-banner"
        className="sticky top-16 z-20 -mt-2 flex items-center justify-between gap-3 rounded-2xl bg-indigo-600 text-white px-4 py-2.5 shadow-md"
      >
        <span className="text-sm font-extrabold">{bannerText(athlete?.display_name)}</span>
        <Link href="/" className="text-xs font-bold underline underline-offset-2 hover:text-indigo-100">
          Exit
        </Link>
      </div>
      <nav className="flex flex-wrap gap-1" aria-label="Athlete sections">
        {ATHLETE_PAGES.map((p) => {
          const href = athletePath(riderId, p.sub)
          const active = p.sub ? pathname === href || pathname.startsWith(`${href}/`) : pathname === href
          return (
            <Link key={p.key} href={href} className={tabClass(active)}>
              {p.label}
            </Link>
          )
        })}
      </nav>
      {state === 'ok' ? children : <p className="text-xs text-slate-400">Loading…</p>}
    </AthleteContext.Provider>
  )
}
