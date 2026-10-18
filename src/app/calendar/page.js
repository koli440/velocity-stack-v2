'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { athletePath } from '../../lib/coachContext'
import ActivityCalendar from '../../components/ActivityCalendar'
import Icon from '../../components/Icon'

// The signed-in rider's own calendar. The step 2 "/calendar?rider=<id>" form now lives at
// /coach/<id>/calendar; old links are redirected there (access is still enforced by the database).
export default function CalendarPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const riderId = new URLSearchParams(window.location.search).get('rider')
    if (riderId) router.replace(athletePath(riderId, '/calendar'))
    else setReady(true)
  }, [router])

  return (
    <div className="w-full space-y-4">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
        <Icon name="calendar" /> Calendar
      </h1>
      {ready ? <ActivityCalendar /> : <p className="text-xs text-slate-400">Loading…</p>}
    </div>
  )
}
