import { supabase } from '../lib/supabase'
import Dashboard from '../components/Dashboard'
import { DEFAULT_ACTIVITIES_PAGE_SIZE } from '../lib/activityPagination'

export const revalidate = 0

export default async function Home() {
  const { data: tracks } = await supabase.from('tracks').select('*').order('name')
  // Dynamic loading of activities (issue #46): with thousands of activities per user,
  // the dashboard only fetches the first page here; Dashboard loads the rest on demand.
  const { data: activities } = await supabase
    .from('activities')
    .select('*, tracks(name, length_m, surface)')
    .order('activity_date', { ascending: false })
    .order('id', { ascending: false })
    .range(0, DEFAULT_ACTIVITIES_PAGE_SIZE - 1)

  return <Dashboard tracks={tracks || []} initialActivities={activities || []} />
}
