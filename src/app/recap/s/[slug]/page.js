import { notFound } from 'next/navigation'
import { loadSharedRecap } from '../../../../lib/server/sharedRecap'
import { buildRecapCards, recapSharePath, recapShareText, safeAvatarUrl } from '../../../../lib/recap'
import RecapStory from '../../../../components/RecapStory'
import PublicRecapCta from '../../../../components/PublicRecapCta'

// Never cached: a revoked link must stop working immediately.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }) {
  const shared = await loadSharedRecap(params.slug)
  if (!shared) return { title: 'Recap not found', robots: { index: false, follow: false } }
  const title = recapShareText(shared.year, shared.name)
  const description = 'Season recap on Velocity Stack. Import your rides in 2 minutes and get yours.'
  return {
    title,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: null },
    openGraph: { type: 'website', siteName: 'VelocityStack', title, description, url: recapSharePath(params.slug) },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function SharedRecapPage({ params }) {
  const shared = await loadSharedRecap(params.slug)
  if (!shared) notFound()
  const cards = buildRecapCards(shared.recap, { name: shared.name })
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-black text-center text-slate-900 dark:text-white">
        {shared.name}&apos;s {shared.year} season
      </h1>
      <RecapStory cards={cards} avatarUrl={safeAvatarUrl(shared.avatar_url)} name={shared.name}>
        <PublicRecapCta year={shared.year} />
      </RecapStory>
    </div>
  )
}
