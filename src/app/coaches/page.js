import Link from 'next/link'
import { loadCoachDirectory } from '../../lib/server/coachCardStore'
import { DISCIPLINE_OPTIONS, accentOf, cardPath, safeCoachMediaUrl } from '../../lib/coachCard'
import { noindex } from '../../lib/seo'

export const metadata = noindex('Coaches', 'Coaches on VelocityStack who chose to be listed.')
export const dynamic = 'force-dynamic'

export default async function CoachesPage({ searchParams }) {
  const q = String(searchParams?.q || '').slice(0, 60)
  const discipline = DISCIPLINE_OPTIONS.includes(searchParams?.discipline) ? searchParams.discipline : ''
  const coaches = await loadCoachDirectory({ q, discipline })
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-black text-slate-900 dark:text-white">Coaches</h1>
      <form className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Name, place or discipline" aria-label="Search coaches" className="flex-1 min-w-40 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm" />
        <select name="discipline" defaultValue={discipline} aria-label="Discipline" className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm">
          <option value="">All disciplines</option>
          {DISCIPLINE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900">Search</button>
      </form>
      {coaches.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-600 dark:text-slate-300 space-y-2" data-testid="coach-directory-empty">
          <p className="font-bold text-slate-900 dark:text-white">{q || discipline ? 'No coaches match your search.' : 'No coaches are listed yet.'}</p>
          <p>
            The directory only shows coaches who published their coach card and chose to be listed. Coaches can opt in under{' '}
            <Link href="/settings/coach-card" className="font-bold underline">Settings, Coach card</Link>{' '}
            (&quot;List me in the directory&quot;). Already have a coach&apos;s link? Open it directly at <code>/c/&lt;name&gt;</code>.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {coaches.map((c) => (
            <li key={c.slug}>
              <Link href={cardPath(c.slug)} className="block rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden hover:border-slate-400">
                {safeCoachMediaUrl(c.banner_url) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={safeCoachMediaUrl(c.banner_url)} alt="" className="h-20 w-full object-cover" />
                )}
                <div className={`h-1.5 ${accentOf(c.accent).bar}`} />
                <div className="p-3 flex items-start gap-3">
                  {safeCoachMediaUrl(c.logo_url) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={safeCoachMediaUrl(c.logo_url)} alt="" className="h-10 w-10 shrink-0 rounded-lg object-contain bg-white border border-slate-200 dark:border-slate-700" />
                  )}
                  <div className="min-w-0">
                  <div className="font-bold text-slate-900 dark:text-white">{c.name}</div>
                  {c.headline && <div className="text-sm text-slate-600 dark:text-slate-400">{c.headline}</div>}
                  <div className="text-xs text-slate-500 mt-1">{[c.location, (c.disciplines || []).join(', ')].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
