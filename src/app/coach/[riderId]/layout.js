'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { chatPath } from '../../../lib/coachChat'
import { fetchAthleteProfile } from '../../../lib/coaching'
import { AthleteContext } from '../../../components/AthleteContext'
import Icon from '../../../components/Icon'
import { adminBtn, adminCard } from '../../../components/admin/AdminUi'
import { bannerText, parseCoachPath, rendersBeforeAthleteLoaded } from '../../../lib/coachContext'

// Wraps every athlete page: verifies (via the database) that the viewer actively coaches the
// rider, shows the persistent "Coaching: <Name> - Exit" banner (athlete pages live in the menu).
export default function AthleteLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()
  const { riderId } = parseCoachPath(`/coach/${params?.riderId}`)
  const { subPath } = parseCoachPath(pathname)
  const [athlete, setAthlete] = useState(null)
  const [relationshipId, setRelationshipId] = useState(null)
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
      if (a) {
        const { data: rel } = await supabase.from('coaching_relationships').select('id')
          .eq('coach_id', session.user.id).eq('rider_id', riderId).eq('status', 'active').maybeSingle()
        if (!cancelled) setRelationshipId(rel?.id || null)
      }
      setState(a ? 'ok' : 'denied')
    })()
    return () => {
      cancelled = true
    }
  }, [riderId, router])

  if (state === 'denied') {
    return (
      <div className={`${adminCard} space-y-3 max-w-xl mx-auto`} data-testid="coach-denied">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          You are not coaching this rider (or the coaching relationship has ended).
        </p>
        <Link href="/coach" className={adminBtn.secondary}>
          <Icon name="chevronLeft" /> Back to coach dashboard
        </Link>
      </div>
    )
  }

  return (
    <AthleteContext.Provider value={{ riderId, athlete }}>
      <div
        role="status"
        data-testid="coach-banner"
        className="sticky top-16 z-20 -mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl bg-orange-600 text-white px-4 py-2.5 shadow-md"
      >
        <span className="text-sm font-extrabold">{bannerText(athlete?.display_name)}</span>
        <span className="flex flex-wrap items-center gap-x-2">
          {relationshipId && (
            <Link href={chatPath(relationshipId)} data-testid="message-athlete" className="inline-flex items-center min-h-[44px] lg:min-h-[32px] px-1 text-sm font-bold underline underline-offset-2 hover:text-orange-100">
              Message
            </Link>
          )}
          <Link href="/coach" className="inline-flex items-center min-h-[44px] lg:min-h-[32px] px-1 text-sm font-bold underline underline-offset-2 hover:text-orange-100">
            Coach dashboard
          </Link>
          <Link href="/" className="inline-flex items-center min-h-[44px] lg:min-h-[32px] px-1 text-sm font-bold underline underline-offset-2 hover:text-orange-100">
            Exit
          </Link>
        </span>
      </div>
      {state === 'ok' || (state === 'loading' && rendersBeforeAthleteLoaded(subPath)) ? children : <p className="text-sm text-slate-600 dark:text-slate-300" role="status">Loading…</p>}
    </AthleteContext.Provider>
  )
}
