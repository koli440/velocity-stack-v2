import { notFound } from 'next/navigation'
import LicenceBadge from '../../../components/LicenceBadge'
import FoundingBadge from '../../../components/FoundingBadge'
import { loadCoachCard } from '../../../lib/server/coachCardStore'
import { accentOf, cardDescription, cardPath, priceLabel, safeCoachMediaUrl } from '../../../lib/coachCard'
import { safeAvatarUrl } from '../../../lib/recap'
import ReportCoachCard from '../../../components/ReportCoachCard'
import Link from 'next/link'
import Icon from '../../../components/Icon'
import ApplyToCoachButton from '../../../components/ApplyToCoachButton'

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
  const banner = safeCoachMediaUrl(card.banner_url)
  const logo = safeCoachMediaUrl(card.logo_url)
  return (
    <article className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4" data-testid="coach-card">
      <div className={`${'glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder'} overflow-hidden`}>
      {banner && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner} alt="" className="h-32 sm:h-44 w-full object-cover" data-testid="coach-banner" />
      )}
      <div className={`h-2 ${accent.bar}`} />
      <div className="p-4 sm:p-6 space-y-4">
        <header className="flex flex-col items-center text-center sm:flex-row sm:text-left gap-4">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className={`h-24 w-24 shrink-0 rounded-full object-cover border-4 ${accent.ring}`} />
          ) : (
            <div className={`h-24 w-24 shrink-0 rounded-full border-4 ${accent.ring} bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-3xl font-black text-slate-700 dark:text-slate-200`}>
              {card.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-black text-slate-900 dark:text-white break-words">{card.name}</h1>
            <LicenceBadge licence={card.licence} />
            <FoundingBadge founding={card.founding} />
            {card.headline && <p className={`text-base font-bold ${accent.text}`}>{card.headline}</p>}
            {card.location && <p className="text-sm text-slate-600 dark:text-slate-300">{card.location}</p>}
          </div>
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={`${card.name} logo`} className="h-16 w-16 sm:ml-auto shrink-0 rounded-xl object-contain bg-white border border-slate-200 dark:border-slate-700 p-1" data-testid="coach-logo" />
          )}
        </header>
        {(card.disciplines.length > 0 || card.languages.length > 0) && (
          <ul className="flex flex-wrap justify-center sm:justify-start gap-2">
            {[...card.disciplines, ...card.languages].map((t) => (
              <li key={t} className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600">{t}</li>
            ))}
          </ul>
        )}
        {card.bio && <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800 dark:text-slate-200 break-words">{card.bio}</p>}
        {card.packages.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Coaching packages</h2>
            <ul className="space-y-2">
              {card.packages.map((p) => (
                <li key={p.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-bold text-slate-900 dark:text-white break-words">{p.title}</span>
                    <span className={`text-base font-extrabold ${accent.text}`}>{priceLabel(p)}</span>
                  </div>
                  {p.description && <p className="text-sm text-slate-700 dark:text-slate-300 break-words">{p.description}</p>}
                  {card.accepting_athletes && <Link href={`/c/${card.slug}/apply?package=${p.id}`} className="inline-block text-sm font-bold underline text-orange-700 dark:text-orange-400">Apply with this package</Link>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4 space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Icon name={card.accepting_athletes && !card.waitlist ? 'check' : 'users'} className="shrink-0" />
          {!card.accepting_athletes ? 'Not accepting new athletes right now.' : card.waitlist ? 'Currently full: new athletes join the waitlist.' : 'Accepting new athletes.'}
        </p>
        {card.accepting_athletes && <ApplyToCoachButton slug={card.slug} />}
        </div>
      </div>
      </div>
      <div className="px-1"><ReportCoachCard slug={card.slug} /></div>
    </article>
  )
}
