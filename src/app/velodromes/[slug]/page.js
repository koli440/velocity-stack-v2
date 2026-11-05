import Link from 'next/link'
import Icon from '../../../components/Icon'
import { notFound } from 'next/navigation'
import { SITE_URL, trackTitle, fitDescription } from '../../../lib/seo'
import { isIndexableTrack } from '../../../lib/trackSlug'
import { disciplineFitsTrack } from '../../../lib/lookups'
import { trackJsonLd, trackDescription, jsonLdString } from '../../../lib/geo'
import { loadPublicTracks, loadCountryNames, loadDisciplines } from '../../../lib/server/publicTracks'

export const revalidate = 60

export async function generateStaticParams() {
  return (await loadPublicTracks()).map((t) => ({ slug: t.slug }))
}

async function find(slug) {
  const tracks = await loadPublicTracks()
  return tracks.find((t) => t.slug === slug) || null
}

export async function generateMetadata({ params }) {
  const { slug } = await params
  const t = await find(slug)
  if (!t) return { title: 'Velodrome not found', robots: { index: false, follow: false } }
  const countries = await loadCountryNames()
  const country = countries[t.country_code] || t.country_code
  const title = trackTitle(t.name, country)
  const description = fitDescription(trackDescription(t, country))
  const path = `/velodromes/${t.slug}`
  return {
    title,
    description,
    alternates: { canonical: path },
    ...(isIndexableTrack(t) ? {} : { robots: { index: false, follow: true } }),
    openGraph: { type: 'website', title, description, url: path },
  }
}

const Row = ({ label, children }) => (
  <div>
    <dt className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</dt>
    <dd className="text-base font-semibold text-slate-900 dark:text-white mt-0.5">{children}</dd>
  </div>
)

export default async function TrackPage({ params }) {
  const { slug } = await params
  const t = await find(slug)
  if (!t) notFound()
  const [countries, disciplines] = await Promise.all([loadCountryNames(), loadDisciplines()])
  const country = countries[t.country_code] || t.country_code
  const fitting = disciplines.filter((d) => disciplineFitsTrack(d, Number(t.length_m)))
  const indexable = isIndexableTrack(t)

  return (
    <article className="max-w-3xl mx-auto space-y-6">
      {indexable && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(trackJsonLd(t, country, fitting)) }} />
      )}
      <nav className="text-sm">
        <Link href="/velodromes" className="inline-flex items-center gap-1 min-h-[44px] font-semibold text-emerald-800 dark:text-brand-neon hover:underline">
          <Icon name="chevronLeft" size={16} /> Velodromes
        </Link>
      </nav>
      <header className="space-y-3">
        <h1 className="text-2xl sm:text-3xl font-black leading-tight text-slate-900 dark:text-white">{t.name} velodrome: length, surface and location</h1>
        <div className="flex flex-wrap gap-2 text-sm font-semibold">
          <span className={`px-2.5 py-1 rounded-lg ${t.is_indoor ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'}`}>{t.is_indoor ? 'Indoor' : 'Outdoor'}</span>
          {t.surface && <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">{t.surface}</span>}
          {t.length_m ? <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">{Number(t.length_m)} m</span> : null}
          {country && <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200"><Icon name="pin" size={14} /> {country}</span>}
        </div>
        <p className="text-base text-slate-700 dark:text-slate-300">{trackDescription(t, country)}</p>
      </header>
      <dl className="glass-dense grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-4 sm:p-5 [&_dd]:break-words">
        <Row label="Track length">{t.length_m ? `${Number(t.length_m)} m` : 'Unknown'}</Row>
        <Row label="Surface">{t.surface || 'Unknown'}</Row>
        <Row label="Type">{t.is_indoor ? 'Indoor' : 'Outdoor'}</Row>
        <Row label="Country">{country || 'Unknown'}</Row>
        {t.location && <Row label="Location">{t.location}</Row>}
        {t.elevation_m != null && <Row label="Elevation">{Number(t.elevation_m)} m</Row>}
        {t.latitude != null && t.longitude != null && (
          <Row label="Coordinates">{Number(t.latitude).toFixed(4)}, {Number(t.longitude).toFixed(4)}</Row>
        )}
      </dl>
      {t.notes && <p className="text-sm text-slate-700 dark:text-slate-300">{t.notes}</p>}
      {fitting.length > 0 && (
        <section>
          <h2 className="text-xl font-black text-slate-900 dark:text-white mb-2">Disciplines that fit this track</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">Events whose distance rules allow a {Number(t.length_m)} m track.</p>
          <ul className="flex flex-wrap gap-2">
            {fitting.map((d) => (
              <li key={d.id} className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">{d.name}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 text-sm">
        {[['website_url', 'Website'], ['pricing_url', 'Pricing'], ['booking_url', 'Book a session']].map(([k, label]) =>
          t[k] ? <a key={k} href={t[k]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border border-emerald-600/50 font-semibold text-emerald-800 dark:text-brand-neon hover:bg-emerald-500/10">{label} <Icon name="chevronRight" size={14} /></a> : null,
        )}
      </div>
      <p className="text-sm text-slate-700 dark:text-slate-300 break-words">
        Analyse your own rides on this track with <Link href="/how-it-works" className="font-semibold text-emerald-800 dark:text-brand-neon hover:underline">VelocityStack</Link>.
        Canonical page: {SITE_URL}/velodromes/{t.slug}
      </p>
    </article>
  )
}
