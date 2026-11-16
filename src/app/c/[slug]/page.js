import { notFound } from 'next/navigation'
import { loadCoachCard } from '../../../lib/server/coachCardStore'
import { accentOf, cardDescription, cardPath, priceLabel } from '../../../lib/coachCard'
import { safeAvatarUrl } from '../../../lib/recap'
import ReportCoachCard from '../../../components/ReportCoachCard'

// Never cached: unpublishing must take effect immediately.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }) {
  const card = await loadCoachCard(params.slug)
  if (!card) return { title: 'Coach not found', robots: { index: false, follow: false } }
  const title = `${card.name} · Coach on VelocityStack`
  const description = cardDescription(card)
  return {
    title,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: null },
    openGraph: { type: 'profile', siteName: 'VelocityStack', title, description, url: cardPath(card.slug) },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function CoachCardPage({ params }) {
  const card = await loadCoachCard(params.slug)
  if (!card) notFound()
  const accent = accentOf(card.accent)
  const avatar = safeAvatarUrl(card.avatar_url)
  return (
    <article className="max-w-2xl mx-auto rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden" data-testid="coach-card">
      <div className={`h-2 ${accent.bar}`} />
      <div className="p-5 space-y-4">
        <header className="flex items-center gap-4">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className={`h-20 w-20 rounded-full object-cover border-4 ${accent.ring}`} />
          ) : (
            <div className={`h-20 w-20 rounded-full border-4 ${accent.ring} flex items-center justify-center text-2xl font-black text-slate-500`}>
              {card.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">{card.name}</h1>
            {card.headline && <p className={`font-bold ${accent.text}`}>{card.headline}</p>}
            {card.location && <p className="text-sm text-slate-500">{card.location}</p>}
          </div>
        </header>
        {(card.disciplines.length > 0 || card.languages.length > 0) && (
          <ul className="flex flex-wrap gap-2">
            {[...card.disciplines, ...card.languages].map((t) => (
              <li key={t} className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">{t}</li>
            ))}
          </ul>
        )}
        {card.bio && <p className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{card.bio}</p>}
        {card.packages.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Coaching packages</h2>
            <ul className="space-y-2">
              {card.packages.map((p) => (
                <li key={p.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                  <div className="flex justify-between gap-2">
                    <span className="font-bold text-slate-900 dark:text-white">{p.title}</span>
                    <span className={`text-sm font-bold ${accent.text}`}>{priceLabel(p)}</span>
                  </div>
                  {p.description && <p className="text-sm text-slate-600 dark:text-slate-400">{p.description}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {!card.accepting_athletes ? 'Not accepting new athletes right now.' : card.waitlist ? 'Currently full: new athletes join the waitlist.' : 'Accepting new athletes.'}
        </p>
        <ReportCoachCard slug={card.slug} />
      </div>
    </article>
  )
}
