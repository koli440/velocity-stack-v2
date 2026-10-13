import { supabase } from '../lib/supabase'
import Dashboard from '../components/Dashboard'

export const revalidate = 0

export default async function Home() {
  const { data: tracks } = await supabase.from('tracks').select('*').order('name')
  // Activities are protected by RLS (own + shared with the signed-in user), so they are
  // loaded client-side by Dashboard once the browser session is known (issues #46, #49).
  return <Dashboard tracks={tracks || []} initialActivities={[]} />
}
