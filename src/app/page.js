import { supabase } from '../lib/supabase'
import { fetchTracks } from '../lib/lookups'
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '../lib/seo'
import Dashboard from '../components/Dashboard'
import HomeGate from '../components/HomeGate'
import Landing from '../components/Landing'

export const revalidate = 0

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: 'SportsApplication',
  operatingSystem: 'Any',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
}

export default async function Home() {
  const { data: tracks } = await fetchTracks(supabase)
  // Activities are protected by RLS (own + shared with the signed-in user), so they are
  // loaded client-side by Dashboard once the browser session is known (issues #46, #49).
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, '\\u003c') }} />
      <HomeGate landing={<Landing />}>
        <Dashboard tracks={tracks || []} initialActivities={[]} />
      </HomeGate>
    </>
  )
}
