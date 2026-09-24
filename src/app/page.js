import { supabase } from '../lib/supabase'
import Dashboard from '../components/Dashboard'

export const revalidate = 0

export default async function Home() {
  const { data: tracks } = await supabase.from('tracks').select('*').order('name')
  const { data: activities } = await supabase
    .from('activities')
    .select('*, tracks(name, length_m, surface)')
    .order('created_at', { ascending: false })

  return <Dashboard tracks={tracks || []} initialActivities={activities || []} />
}import { supabase } from '../lib/supabase'
import Dashboard from '../components/Dashboard'

export const revalidate = 0

export default async function Home() {
  const { data: tracks } = await supabase.from('tracks').select('*').order('name')
  const { data: activities } = await supabase
    .from('activities')
    .select('*, tracks(name, length_m, surface)')
    .order('created_at', { ascending: false })

  return <Dashboard tracks={tracks || []} initialActivities={activities || []} />
}
