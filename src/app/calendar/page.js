'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import ActivityCalendar from '../../components/ActivityCalendar'
import Icon from '../../components/Icon'

// Calendar of the signed-in rider's activities. ActivityCalendar takes `riderId` and `fetchEvents`
// props, so a coach view can later reuse it for an athlete.
export default function CalendarPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return router.push('/login')
      setReady(true)
    })
  }, [router])

  return (
    <div className="w-full space-y-4">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white"><Icon name="calendar" /> Calendar</h1>
      {ready ? <ActivityCalendar /> : <p className="text-xs text-slate-400">Loading…</p>}
    </div>
  )
}
