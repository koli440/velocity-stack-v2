import Link from 'next/link'
import { loadCoachDirectory } from '../../lib/server/coachCardStore'
import { DISCIPLINE_OPTIONS, accentOf, cardPath, safeCoachMediaUrl } from '../../lib/coachCard'
import { noindex } from '../../lib/seo'
import Icon from '../../components/Icon'

// Local copies: AdminUi is a client module, so its string constants are not usable in a server component.
const CARD = 'glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder'
const FIELD = 'w-full min-h-[44px] lg:min-h-[40px] px-3 rounded-xl text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-600 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'
const BTN = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-[40px] px-4 rounded-xl text-sm font-bold border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500'

export const metadata = noindex('Coaches', 'Coaches on VelocityStack who chose to be listed.')
export const dynamic = 'force-dynamic'

export default async function CoachesPage({ searchParams }) {
  const q = String(searchParams?.q || '').slice(0, 60)
  const discipline = DISCIPLINE_OPTIONS.includes(searchParams?.discipline) ? searchParams.discipline : ''
  const coaches = await loadCoachDirectory({ q, discipline })
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Coaches</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">Coaches on VelocityStack who chose to be listed. Open a coach card to see packages and apply.</p>
      </header>
      <form className={`${CARD} p-3 sm:p-4 flex flex-col sm:flex-row gap-2`} role="search">
        <input name="q" defaultValue={q} placeholder="Name, place or discipline" aria-label="Search coaches" className={`${FIELD} sm:flex-1`} />
        <select name="discipline" defaultValue={discipline} aria-label="Discipline" className={`${FIELD} sm:w-56`}>
          <option value="">All disciplines</option>
          {DISCIPLINE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button className={`${BTN} bg-orange-500 border-orange-500 text-white hover:bg-orange-600`}><Icon name="search" /> Search</button>
      </form>
      {coaches.length === 0 ? (
        <div className={`${CARD} p-5 text-sm text-slate-700 dark:text-slate-200 space-y-2`} data-testid="coach-directory-empty">
          <p className="font-bold text-base text-slate-900 dark:text-white">{q || discipline ? 'No coaches match your search.' : 'No coaches are listed yet.'}</p>
          <p>
            The directory only shows coaches who published their coach card and chose to be listed. Coaches can opt in under{' '}
            <Link href="/settings/coach-card" className="font-bold text-orange-700 dark:text-orange-400 underline">Settings, Coach card</Link>{' '}
            (&quot;List me in the directory&quot;). Already have a coach&apos;s link? Open it directly at <code>/c/&lt;name&gt;</code>.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coaches.map((c) => (
            <li key={c.slug} className="flex">
              <div className={`${CARD} w-full overflow-hidden flex flex-col`}>
                {safeCoachMediaUrl(c.banner_url) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={safeCoachMediaUrl(c.banner_url)} alt="" className="h-24 w-full object-cover" />
                )}
                <div className={`h-1.5 ${accentOf(c.accent).bar}`} />
                <div className="p-4 flex flex-col gap-3 flex-1">
                  <div className="flex items-start gap-3">
                    {safeCoachMediaUrl(c.logo_url) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={safeCoachMediaUrl(c.logo_url)} alt="" className="h-12 w-12 shrink-0 rounded-xl object-contain bg-white border border-slate-200 dark:border-slate-600" />
                    )}
                    <div className="min-w-0">
                      <h2 className="text-base font-black text-slate-900 dark:text-white break-words">{c.name}</h2>
                      {c.location && <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300"><Icon name="pin" className="shrink-0" /> <span className="min-w-0 break-words">{c.location}</span></p>}
                    </div>
                  </div>
                  {c.headline && <p className="text-sm text-slate-700 dark:text-slate-200 line-clamp-3">{c.headline}</p>}
                  {(c.disciplines || []).length > 0 && (
                    <ul className="flex flex-wrap gap-1.5">
                      {c.disciplines.map((d) => <li key={d} className="rounded-full px-2.5 py-0.5 text-xs font-bold border bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600">{d}</li>)}
                    </ul>
                  )}
                  <Link href={cardPath(c.slug)} className={`${BTN} mt-auto bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 hover:border-orange-500`}>
                    View coach <Icon name="chevronRight" />
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
