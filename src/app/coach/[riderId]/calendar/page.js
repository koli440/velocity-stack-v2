'use client'

import { supabase } from '../../../../lib/supabase'
import { fetchActivitiesInRange } from '../../../../lib/calendar'
import ActivityCalendar from '../../../../components/ActivityCalendar'
import { useAthlete } from '../../../../components/AthleteContext'

// A coach reads the athlete through the masked shared_activities view.
const fetchAthleteEvents = (args) => fetchActivitiesInRange(supabase, { ...args, shared: true })

export default function AthleteCalendarPage() {
  const { riderId } = useAthlete()
  if (!riderId) return null
  return <ActivityCalendar riderId={riderId} fetchEvents={fetchAthleteEvents} />
}
