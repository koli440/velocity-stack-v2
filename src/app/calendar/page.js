'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { fetchActivitiesInRange } from '../../lib/calendar'
import { fetchAthleteProfile } from '../../lib/coaching'
import ActivityCalendar from '../../components/ActivityCalendar'
import Icon from '../../components/Icon'

// A coach reads the athlete through the masked shared_activities view.
const fetchAthleteEvents = (args) => fetchActivitiesInRange(supabase, { ...args, shared: true })

// Calendar of the signed-in rider's activities, or (/calendar?rider=<id>) of an athlete the
// signed-in user actively coaches. Access is enforced by the database (is_coach_of); the
// full coach dashboard is a later step.
export default function CalendarPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [athlete, setAthlete] = useState(null)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return router.push('/login')
      const riderId = new URLSearchParams(window.location.search).get('rider')
      if (riderId && riderId !== session.user.id) {
        const { athlete: a } = await fetchAthleteProfile(supabase, riderId)
        if (cancelled) return
        if (a) setAthlete(a)
        else setDenied(true)
      }
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <div className="w-full space-y-4">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
        <Icon name="calendar" /> Calendar{athlete ? ` · ${athlete.display_name}` : ''}
      </h1>
      {!ready && <p className="text-xs text-slate-400">Loading…</p>}
      {ready && denied && (
        <p className="text-sm text-slate-500">
          You do not coach this rider. <Link href="/settings#coaching" className="underline">Manage coaching</Link>
        </p>
      )}
      {ready && !denied && (athlete
        ? <ActivityCalendar riderId={athlete.id} fetchEvents={fetchAthleteEvents} />
        : <ActivityCalendar />)}
    </div>
  )
}
